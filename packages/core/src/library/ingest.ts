import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { scanText } from "../secrets/scan.js";
import {
  buildSkillItem,
  validateSkillFilePath,
  LibraryItemError,
  type SkillItem,
  type SourceInfo,
} from "./item.js";

const execFile = promisify(execFileCallback);

/**
 * Skill ingestion (P2.2 of the build program): folder, zip, git URL with a
 * pinned commit. Every path becomes a validated, hashed entry of a SkillItem;
 * nothing here writes to the user's machine (apply does, in P2.4, only from
 * a planned item).
 *
 * Ingestion is a SECURITY BOUNDARY (PRD §7): hostile archives, symlinked
 * folders, binary payloads, oversize payloads and secret literals are
 * rejected here — they never reach the library or a plan.
 */

export type IngestErrorCode =
  | "unsafe_path"
  | "symlink_entry"
  | "binary_file"
  | "file_too_large"
  | "too_many_files"
  | "total_too_large"
  | "zip_too_large"
  | "secret_found"
  | "missing_skill_md"
  | "invalid_commit"
  | "git_failed"
  | "empty";

export class IngestError extends Error {
  constructor(
    public readonly code: IngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export type IngestFlagCode =
  | "skill_shell_injection"
  | "skill_allowed_tools"
  | "skill_bundled_script"
  | "possible_prompt_injection";

export interface IngestFlag {
  code: IngestFlagCode;
  path: string;
  detail: string;
}

export interface IngestResult {
  item: SkillItem;
  /** Non-blocking risk flags (PRD §7: "prompt-injection text in skill content (flagged)"). */
  flags: IngestFlag[];
}

/* ── caps ───────────────────────────────────────────────────────────── */

/** Max size of one inflated skill file. */
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;
/** Max total inflated size of one skill item. */
export const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024;
/** Max file count of one skill item. */
export const MAX_SKILL_FILES = 200;
/** Max COMPRESSED zip input (inflated caps above are checked after decode). */
export const MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024;
/** git fetch/clone timeout. */
export const GIT_TIMEOUT_MS = 120_000;

/* ── shared content checks ──────────────────────────────────────────── */

interface RawFile {
  path: string;
  bytes: Uint8Array;
}

const EXECUTABLE_EXTENSIONS = new Set([
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".py", ".js", ".mjs", ".cjs", ".ts",
  ".bat", ".cmd", ".exe", ".dll", ".vbs", ".jar",
]);

const INJECTION_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: "override-instructions", regex: /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+instructions\b/i },
  { id: "disregard-rules", regex: /\bdisregard\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|your\s+)?(?:instructions|rules|guardrails)/i },
  { id: "exfiltration", regex: /\bexfiltrat(?:e|es|ed|ion)\b/i },
  { id: "credential-request", regex: /\b(?:send|post|upload|paste)\b[^.\n]{0,60}\b(?:api[ -]?keys?|tokens?|secrets?|passwords?|credentials?)\b/i },
  { id: "env-file-access", regex: /\B\.(?:env|npmrc|netrc|aws)\b/i },
  { id: "fake-system-tags", regex: /<\/?system>|<\/?assistant>/i },
];

/** True when the first bytes look binary: a NUL byte, like the check engine's rule (BUG-004). */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  return sample.includes(0);
}

function decodeText(raw: RawFile): string {
  if (looksBinary(raw.bytes)) {
    throw new IngestError("binary_file", `binary file rejected: ${raw.path}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes);
  } catch {
    throw new IngestError("binary_file", `not valid UTF-8 (treated as binary): ${raw.path}`);
  }
}

function checkCaps(files: readonly RawFile[]): void {
  if (files.length > MAX_SKILL_FILES) {
    throw new IngestError("too_many_files", `skill has ${files.length} files (max ${MAX_SKILL_FILES})`);
  }
  let total = 0;
  for (const file of files) {
    if (file.bytes.length > MAX_SKILL_FILE_BYTES) {
      throw new IngestError(
        "file_too_large",
        `file exceeds ${MAX_SKILL_FILE_BYTES} bytes: ${file.path} (${file.bytes.length} bytes)`,
      );
    }
    total += file.bytes.length;
    if (total > MAX_SKILL_TOTAL_BYTES) {
      throw new IngestError("total_too_large", `skill exceeds ${MAX_SKILL_TOTAL_BYTES} bytes total`);
    }
  }
}

/** Secret gate (PRD §7): a secret literal in a skill BLOCKS ingestion. The
 *  scanner redacts every snippet, so nothing secret-shaped reaches the
 *  error message, the UI, or logs. */
function blockSecrets(files: ReadonlyArray<{ path: string; text: string }>): void {
  const findings = files.flatMap((file) =>
    scanText(file.text).map((finding) => ({ file: file.path, ...finding })),
  );
  if (findings.length > 0) {
    const lines = findings
      .slice(0, 10)
      .map((finding) => `${finding.file}:${finding.line} ${finding.ruleId} — ${finding.snippet}`);
    throw new IngestError(
      "secret_found",
      `secret literal(s) in skill content — blocked. Redacted findings:\n${lines.join("\n")}`,
    );
  }
}

function scanFlags(files: ReadonlyArray<{ path: string; text: string }>): IngestFlag[] {
  const flags: IngestFlag[] = [];
  for (const file of files) {
    const extension = path.posix.extname(file.path).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(extension) || file.path.startsWith("scripts/")) {
      flags.push({
        code: "skill_bundled_script",
        path: file.path,
        detail: "the skill bundles an executable script — Claude (not this app) may run it",
      });
    }
    if (file.path === "SKILL.md") {
      // Official syntax: `!` fires at line start OR immediately after whitespace.
      if (/(?:^|\s)!\s*`/m.test(file.text)) {
        flags.push({
          code: "skill_shell_injection",
          path: file.path,
          detail: "SKILL.md uses !`command` dynamic-context injection — shell commands run when the skill loads",
        });
      }
      if (/^allowed-tools\s*:/im.test(file.text)) {
        flags.push({
          code: "skill_allowed_tools",
          path: file.path,
          detail: "SKILL.md frontmatter grants tool permissions (allowed-tools) — review before installing",
        });
      }
    }
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.regex.test(file.text)) {
        flags.push({
          code: "possible_prompt_injection",
          path: file.path,
          detail: `content matches injection heuristic "${pattern.id}" — review the diff before installing`,
        });
      }
    }
  }
  return flags;
}

/** Shared tail of every ingest source: caps → binary/decode → secret gate →
 *  item build (name/path validation) → risk flags. */
function finish(
  raw: readonly RawFile[],
  name: string,
  source: SourceInfo,
): IngestResult {
  if (raw.length === 0) {
    throw new IngestError("missing_skill_md", "no SKILL.md found — the source is empty or not a skill");
  }
  checkCaps(raw);
  const decoded = raw.map((file) => ({ path: file.path, text: decodeText(file) }));
  blockSecrets(decoded);
  let item: SkillItem;
  try {
    item = buildSkillItem({ name, files: decoded, source });
  } catch (error) {
    if (error instanceof LibraryItemError) {
      if (error.code === "invalid_path") {
        throw new IngestError("unsafe_path", error.message);
      }
      if (error.code === "missing_skill_md") {
        throw new IngestError("missing_skill_md", error.message);
      }
    }
    throw error;
  }
  return { item, flags: scanFlags(decoded) };
}

/* ── folder ingest ──────────────────────────────────────────────────── */

async function walkSkillDir(root: string, current: string, out: RawFile[]): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    // Symlinks and junctions are rejected BEFORE any read, so their target is
    // never opened (adversarial test: "never reads their target").
    if (entry.isSymbolicLink()) {
      throw new IngestError(
        "symlink_entry",
        `symlink/junction rejected: ${path.relative(root, full) || entry.name}`,
      );
    }
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue; // a clone's git metadata is not skill content
      await walkSkillDir(root, full, out);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      validateSkillFilePath(rel);
      out.push({ path: rel, bytes: await fs.readFile(full) });
    }
  }
}

export async function ingestSkillFolder(
  dir: string,
  opts: { name?: string } = {},
): Promise<IngestResult> {
  const root = path.resolve(dir);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new IngestError("empty", `not a directory: ${dir}`);
  }
  const raw: RawFile[] = [];
  await walkSkillDir(root, root, raw);
  const name = opts.name ?? path.basename(root);
  return finish(raw, name, { type: "folder" });
}

/* ── zip ingest ─────────────────────────────────────────────────────── */

export async function ingestSkillZip(
  bytes: Uint8Array,
  name: string,
): Promise<IngestResult> {
  if (bytes.length > MAX_SKILL_ZIP_BYTES) {
    throw new IngestError("zip_too_large", `zip exceeds ${MAX_SKILL_ZIP_BYTES} compressed bytes`);
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new IngestError("zip_too_large", `unreadable zip: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw: RawFile[] = [];
  for (const [entryName, content] of Object.entries(entries)) {
    // Directory entries ("dir/") carry no content — skip, don't reject.
    if (entryName.endsWith("/")) continue;
    // Zip-slip guard: the NAME is validated before anything is decoded or kept.
    try {
      validateSkillFilePath(entryName);
    } catch (error) {
      if (error instanceof LibraryItemError && error.code === "invalid_path") {
        throw new IngestError("unsafe_path", `unsafe zip entry name: ${JSON.stringify(entryName)}`);
      }
      throw error;
    }
    raw.push({ path: entryName, bytes: content });
  }
  return finish(raw, name, { type: "zip" });
}

/* ── git ingest ─────────────────────────────────────────────────────── */

const COMMIT_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;

interface GitRunResult {
  stdout: string;
  stderr: string;
}

async function runGit(args: string[], cwd?: string): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFile("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}` : String(error);
    throw new IngestError("git_failed", `git ${args[0]} failed: ${detail.slice(0, 500)}`);
  }
}

/** Skill from a git URL pinned to a commit: full clone, detached checkout of
 *  the pin, walk of the working tree with the same guards as folder ingest.
 *  The working copy lives in a caller-supplied or OS temp dir and is removed
 *  in a finally block. The pinned commit — not a branch tip — decides the
 *  content, so re-ingesting the same pin yields the same contentHash. */
export async function ingestSkillGit(
  url: string,
  commit: string,
  opts: { name?: string; workDir?: string } = {},
): Promise<IngestResult> {
  if (typeof commit !== "string" || !COMMIT_PATTERN.test(commit)) {
    throw new IngestError("invalid_commit", `commit pin must be a 40/64-char hex sha: ${JSON.stringify(commit)}`);
  }
  if (typeof url !== "string" || url.length === 0) {
    throw new IngestError("git_failed", "empty git URL");
  }
  const workRoot = opts.workDir
    ? path.resolve(opts.workDir)
    : await mkdtemp(path.join(tmpdir(), "haversack-git-"));
  const cloneDir = path.join(workRoot, "clone");
  let ownedTemp = opts.workDir === undefined;
  try {
    await fs.mkdir(workRoot, { recursive: true });
    await runGit(["clone", "--quiet", url, cloneDir]);
    await runGit(["-C", cloneDir, "checkout", "--quiet", "--detach", commit]);
    const raw: RawFile[] = [];
    await walkSkillDir(cloneDir, cloneDir, raw);
    const derivedName =
      opts.name ??
      path
        .basename(url.replace(/\/+$/, ""))
        .replace(/\.git$/, "");
    return finish(raw, derivedName, { type: "git", url, commit });
  } finally {
    if (ownedTemp) {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** sha256 helper re-exported for callers that want to hash the raw zip. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
