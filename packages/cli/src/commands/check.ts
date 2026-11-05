import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  CHECK_MAX_FILE_BYTES,
  LoadError,
  compileIgnorePatterns,
  loadProject,
  readRepoTextFile,
  runStaticChecks,
  scanFiles,
  type CheckedFile,
  type CheckResult,
  type FileSecretFinding,
} from "@runtime/core";

export interface CheckOptions {
  cwd: string;
  /** Evaluate only the added lines of `git diff <base>` (D2 semantics). */
  base?: string;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * `runtime check` (F2.7, D13): runs the deterministic checks the GitHub App
 * will run on PRs, locally, before pushing. Whole-file mode by default;
 * `--base <ref>` restricts evaluation to the added lines of the diff.
 * LLM-judged checks report `skipped` — never a pass.
 * Exit codes (D6): 0 clean, 1 block-severity failure, 2 config error, 3 secret.
 */
export async function runCheck(options: CheckOptions): Promise<number> {
  const { stdout, stderr } = options;

  try {
    return await checkInner(options);
  } catch (error) {
    if (error instanceof CheckUsageError) {
      stderr(`✘ ${error.message}`);
      return 2;
    }
    throw error;
  }
}

async function checkInner(options: CheckOptions): Promise<number> {
  const { stdout, stderr } = options;

  let loaded;
  try {
    loaded = await loadProject({ cwd: options.cwd });
  } catch (error) {
    if (error instanceof LoadError) {
      stderr(error.report);
      return 2;
    }
    throw error;
  }
  const { config, warnings } = loaded;

  // In --json mode stdout carries exactly one JSON document; preamble goes to stderr.
  const banner = options.json ? stderr : stdout;
  banner(`project: ${config.project} (runtime spec ${config.runtime})`);
  for (const warning of warnings) banner(`⚠ ${warning.message}`);

  const staticChecks = config.checks.filter((check) => check.type === "static");
  const llmChecks = config.checks.filter((check) => check.type === "llm");

  let changedLines: Map<string, number[]> | undefined;
  let mode = "whole files (all tracked)";
  if (options.base !== undefined) {
    assertGitRef(options.cwd, options.base);
    changedLines = diffAddedLines(options.cwd, options.base);
    mode = `added diff lines vs ${options.base}`;
  }
  banner(`mode: ${mode}`);

  // Scope: git-tracked files (respects .gitignore); contents LF-normalized.
  const tracked = gitListFiles(options.cwd);
  const files: CheckedFile[] = [];
  for (const relPath of tracked) {
    if (changedLines && !changedLines.has(relPath)) continue;
    try {
      const text = await readRepoTextFile(options.cwd, relPath, CHECK_MAX_FILE_BYTES);
      files.push({
        path: relPath,
        content: text.content,
        changedLines: changedLines?.get(relPath),
      });
    } catch {
      stderr(`⚠ skipped ${relPath} — unreadable or over ${Math.round(CHECK_MAX_FILE_BYTES / 1024)} KB`);
    }
  }

  // Secret gate (D8): same scope, same ignore list, findings redacted.
  const ignore = compileIgnorePatterns(config.secrets.ignore.map((entry) => entry.pattern));
  const secrets: FileSecretFinding[] = scanFiles(files, ignore);

  const results: CheckResult[] = runStaticChecks(staticChecks, files);
  for (const check of llmChecks) {
    results.push({
      checkId: check.id,
      status: "skipped",
      severity: check.severity,
      findings: [],
      skippedReason: "llm_unavailable",
    });
  }

  if (options.json) {
    stdout(JSON.stringify({ project: config.project, mode, results, secrets }, null, 2));
  } else {
    renderHuman(results, secrets, mode, stdout, stderr);
  }
  if (secrets.length > 0) return 3;
  if (results.some((result) => result.status === "fail" && result.severity === "block")) return 1;
  return 0;
}

/* ── rendering ──────────────────────────────────────────────── */

const ICON = { fail: "✘", pass: "✓", skipped: "-" } as const;

function renderHuman(
  results: CheckResult[],
  secrets: FileSecretFinding[],
  mode: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): void {
  stdout("");
  for (const result of results) {
    const label = `${result.checkId} (${result.severity})`;
    if (result.status === "skipped") {
      stdout(`${ICON.skipped} ${label} — skipped (${describeSkipped(result)})`);
      continue;
    }
    if (result.status === "fail") {
      stdout(`${ICON.fail} ${label} — ${result.findings.length} finding(s)`);
      for (const finding of result.findings) {
        stdout(`    ${finding.file}:${finding.line} — ${finding.message}`);
        if (finding.fix) stdout(`      fix: ${finding.fix}`);
      }
    } else {
      stdout(`${ICON.pass} ${label} — no findings`);
    }
  }

  if (secrets.length > 0) {
    stderr("");
    stderr("✘ secret detected — findings block this check run (D8)");
    for (const finding of secrets) {
      stderr(`    ${finding.file}:${finding.line} — ${finding.ruleId}`);
      stderr(`      ${finding.snippet}`);
    }
    stderr(
      "  if it is not a real secret: secrets.ignore in project.yaml, or a `runtime:allow-secret` line marker",
    );
  }

  const failed = results.filter((result) => result.status === "fail");
  const blocked = failed.filter((result) => result.severity === "block");
  stdout("");
  stdout(
    `check: ${results.filter((result) => result.status === "pass").length} passed · ${failed.length} failed · ` +
      `${results.filter((result) => result.status === "skipped").length} skipped · mode: ${mode}`,
  );
  if (secrets.length > 0) stderr("result: SECRETS FOUND (exit 3)");
  else if (blocked.length > 0) stderr(`result: ${blocked.length} BLOCK check(s) failed (exit 1)`);
  else stdout("result: no blocking failures (exit 0)");
}

function describeSkipped(result: CheckResult): string {
  switch (result.skippedReason) {
    case "no_matching_files":
      return "no files in scope";
    case "llm_unavailable":
      return "llm checks not available yet — never counts as a pass";
    case "budget_exhausted":
      return "budget exhausted (D4)";
    case "invalid_pattern":
      return "pattern failed to compile";
    default:
      return "unknown reason";
  }
}

/* ── git plumbing ───────────────────────────────────────────── */

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
  });
}

function assertGitRef(cwd: string, ref: string): void {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new CheckUsageError(`--base '${ref}' is not a valid git ref in this repository`);
  }
}

function gitListFiles(cwd: string): string[] {
  let out: string;
  try {
    // Refuse to scan a foreign tree: if cwd is not a repo (or is a subdir of
    // some ancestor repo), scanning would silently target the wrong files.
    // realpathSync resolves 8.3 short paths (GitHub's Windows runners use
    // C:\Users\RUNNER~1\... for temp) and is case-insensitive on win32.
    const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    const cwdReal = realpathSync(path.resolve(cwd));
    const topReal = realpathSync(path.resolve(toplevel));
    const sameRoot =
      process.platform === "win32"
        ? cwdReal.toLowerCase() === topReal.toLowerCase()
        : cwdReal === topReal;
    if (!sameRoot) {
      throw new CheckUsageError("runtime check must run from the repository root");
    }
    out = git(cwd, ["ls-files", "-z"]);
  } catch (error) {
    if (error instanceof CheckUsageError) throw error;
    throw new CheckUsageError("runtime check needs a git repository (it scans tracked files)");
  }
  return out.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Parses `git diff -U0 --no-color <base>` into per-file added-line numbers.
 * Only added lines count (D2); deleted files are dropped.
 */
export function diffAddedLines(cwd: string, base: string): Map<string, number[]> {
  const patch = git(cwd, ["diff", "-U0", "--no-color", base]);
  const result = new Map<string, number[]>();
  let currentFile: string | undefined;
  let nextNewLine = 1;

  for (const rawLine of patch.split("\n")) {
    if (rawLine.startsWith("+++ b/")) {
      currentFile = rawLine.slice(6);
      continue;
    }
    if (rawLine.startsWith("+++ /dev/null")) {
      currentFile = undefined; // the file was deleted
      continue;
    }
    if (rawLine.startsWith("@@")) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
      if (match && currentFile) nextNewLine = Number(match[1]);
      continue;
    }
    if (currentFile !== undefined && rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      const list = result.get(currentFile) ?? [];
      list.push(nextNewLine);
      result.set(currentFile, list);
      nextNewLine++;
    }
  }
  return result;
}

export class CheckUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckUsageError";
  }
}
