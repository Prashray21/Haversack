import { z } from "zod";
import { sha256Hex } from "../parse/files.js";
import { stableStringify } from "../drift/manifest.js";

/**
 * Library-item model (P2.1 of the build program; design in ADR 003 §3/§4).
 *
 * A library item is what the team shares: a `skill` (a directory of text
 * files) or an `mcp` definition (command/url + env). Secret VALUES never
 * appear here — env/header values carry a placeholder NAME only; the real
 * value is entered on the applying machine and stored with Windows-protected
 * storage (PRD L6). `contentHash` pins the exact content so a plan the human
 * approved is the content apply writes (PRD §7).
 */

export type LibraryItemErrorCode =
  | "invalid_name"
  | "reserved_name"
  | "invalid_path"
  | "duplicate_path"
  | "missing_skill_md"
  | "invalid_env_value"
  | "missing_command"
  | "missing_url"
  | "invalid_url"
  | "invalid_item";

export class LibraryItemError extends Error {
  constructor(
    public readonly code: LibraryItemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LibraryItemError";
  }
}

export interface SkillFile {
  /** Repo-relative POSIX path inside the skill directory ("SKILL.md", "scripts/run.sh"). */
  path: string;
  /** Text content. Binary content is rejected at ingest (P2.2), never modeled. */
  text: string;
  sha256: string;
}

export interface SourceInfo {
  type: "folder" | "zip" | "git";
  url?: string;
  /** Pinned commit for git sources. */
  commit?: string;
}

export interface SkillItem {
  kind: "skill";
  name: string;
  description?: string;
  files: SkillFile[];
  contentHash: string;
  source?: SourceInfo;
}

/** An env/header value: the NAME of the placeholder, never a real value. */
export interface McpEnvValue {
  placeholder: string;
}

export interface McpItem {
  kind: "mcp";
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, McpEnvValue>;
  headers?: Record<string, McpEnvValue>;
  contentHash: string;
  source?: SourceInfo;
}

export type LibraryItem = SkillItem | McpItem;

/* ── names ──────────────────────────────────────────────────────────── */

/** Claude Code refuses names with control/zero-width/bidi characters, `<`,
 *  `>`, or non-plain-space blanks (ADR 003 §1.1). Our allowlist excludes all
 *  of those by construction and is stricter than the target allows. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Reserved by Claude Code: `~/.claude/skills/synced/` is claude.ai-managed
 *  (any capitalization) and `anthropic-skills` is the synced-skill namespace
 *  (ADR 003 §1.1, §1.3). */
const RESERVED_SKILL_NAMES = new Set(["synced", "anthropic-skills"]);

/** Reserved MCP built-in server names (ADR 003 §1.2). */
const RESERVED_MCP_NAMES = new Set([
  "workspace",
  "claude-in-chrome",
  "computer-use",
  "claude preview",
  "claude browser",
]);

export function validateSkillName(name: string): string {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new LibraryItemError("invalid_name", `invalid skill name: ${JSON.stringify(name)}`);
  }
  if (RESERVED_SKILL_NAMES.has(name.toLowerCase())) {
    throw new LibraryItemError("reserved_name", `skill name is reserved by Claude Code: ${name}`);
  }
  return name;
}

export function validateMcpName(name: string): string {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new LibraryItemError("invalid_name", `invalid MCP server name: ${JSON.stringify(name)}`);
  }
  if (RESERVED_MCP_NAMES.has(name.toLowerCase())) {
    throw new LibraryItemError("reserved_name", `MCP server name is reserved: ${name}`);
  }
  return name;
}

/* ── skill file paths ───────────────────────────────────────────────── */

/** Max length for a path inside a skill item. */
export const MAX_SKILL_FILE_PATH_LENGTH = 256;

/** Validates a path INSIDE a skill item and returns it unchanged. Rejects
 *  absolute paths, Windows drive/UNC forms, backslashes, `..` and `.` and
 *  empty segments, NUL/control characters — the same class of escape the
 *  path-escape protections guard against (docs/BUGS.md BUG-001). */
export function validateSkillFilePath(path: string): string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_SKILL_FILE_PATH_LENGTH) {
    throw new LibraryItemError("invalid_path", `invalid skill file path: ${JSON.stringify(path)}`);
  }
  if (path.includes("\\")) {
    throw new LibraryItemError("invalid_path", `backslash in skill file path: ${JSON.stringify(path)}`);
  }
  if (path.startsWith("/")) {
    throw new LibraryItemError("invalid_path", `absolute skill file path: ${JSON.stringify(path)}`);
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new LibraryItemError("invalid_path", `drive-absolute skill file path: ${JSON.stringify(path)}`);
  }
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      throw new LibraryItemError("invalid_path", `control character in skill file path: ${JSON.stringify(path)}`);
    }
  }
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new LibraryItemError(
        "invalid_path",
        `unsafe segment in skill file path: ${JSON.stringify(path)}`,
      );
    }
  }
  return path;
}

/* ── env placeholders ───────────────────────────────────────────────── */

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PLACEHOLDER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const mcpEnvValueSchema = z.strictObject({
  placeholder: z.string().regex(PLACEHOLDER_PATTERN),
});

/** Validates one env/headers map. Values must be `{ placeholder }` — a bare
 *  string (a real value) or any extra key fails, so a secret literal cannot
 *  ride into a library item (PRD §7). */
function validateEnvMap(
  map: unknown,
  where: string,
): Record<string, McpEnvValue> | undefined {
  if (map === undefined) return undefined;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    throw new LibraryItemError("invalid_env_value", `${where} must be an object`);
  }
  const out: Record<string, McpEnvValue> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new LibraryItemError("invalid_env_value", `${where}: key is not a valid env var name: ${JSON.stringify(key)}`);
    }
    const parsed = mcpEnvValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new LibraryItemError(
        "invalid_env_value",
        `${where}: ${key} must be { placeholder } — real values never enter a library item`,
      );
    }
    out[key] = parsed.data;
  }
  return out;
}

/* ── canonical hashing ──────────────────────────────────────────────── */

function comparePaths(a: string | undefined, b: string | undefined): number {
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

/** sha256 over the canonical FILES ONLY — the hash pins what apply writes.
 *  `name` is deliberately excluded: the same content under two names is the
 *  same content (installed to two destinations); the plan previews the name.
 *  (MCP content hashes DO include the server name — there the name is the
 *  config entry key, i.e. part of the written artifact.) */
function skillContentHash(files: SkillFile[]): string {
  return sha256Hex(
    stableStringify({
      kind: "skill",
      files: files.map((f) => [f.path, f.sha256]).sort((a, b) => comparePaths(a[0], b[0])),
    }),
  );
}

function mcpContentHash(item: {
  name: string;
  transport: string;
  command: string | null;
  args: string[] | null;
  url: string | null;
  env: Record<string, McpEnvValue> | null;
  headers: Record<string, McpEnvValue> | null;
}): string {
  return sha256Hex(
    stableStringify({
      kind: "mcp",
      name: item.name,
      transport: item.transport,
      command: item.command,
      args: item.args,
      url: item.url,
      env: item.env
        ? Object.entries(item.env)
            .map(([key, value]) => [key, value.placeholder] as [string, string])
            .sort((a, b) => comparePaths(a[0], b[0]))
        : null,
      headers: item.headers
        ? Object.entries(item.headers)
            .map(([key, value]) => [key, value.placeholder] as [string, string])
            .sort((a, b) => comparePaths(a[0], b[0]))
        : null,
    }),
  );
}

/* ── constructors ───────────────────────────────────────────────────── */

export interface BuildSkillItemInput {
  name: string;
  description?: string;
  files: Array<{ path: string; text: string }>;
  source?: SourceInfo;
}

export function buildSkillItem(input: BuildSkillItemInput): SkillItem {
  const name = validateSkillName(input.name);
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new LibraryItemError("invalid_item", "a skill item needs at least one file");
  }
  const seen = new Set<string>();
  const files: SkillFile[] = input.files.map((file) => {
    const path = validateSkillFilePath(file.path);
    if (seen.has(path)) {
      throw new LibraryItemError("duplicate_path", `duplicate skill file path: ${path}`);
    }
    seen.add(path);
    if (typeof file.text !== "string") {
      throw new LibraryItemError("invalid_item", `skill file is not text: ${path}`);
    }
    return { path, text: file.text, sha256: sha256Hex(file.text) };
  });
  if (!seen.has("SKILL.md")) {
    throw new LibraryItemError("missing_skill_md", "a skill item needs a SKILL.md at its root");
  }
  const description =
    input.description === undefined ? undefined : String(input.description).slice(0, 1536);
  return {
    kind: "skill",
    name,
    ...(description === undefined ? {} : { description }),
    files,
    contentHash: skillContentHash(files),
    ...(input.source === undefined ? {} : { source: input.source }),
  };
}

export interface BuildMcpItemInput {
  name: string;
  transport: "stdio" | "http";
  command?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
  headers?: unknown;
  source?: SourceInfo;
}

export function buildMcpItem(input: BuildMcpItemInput): McpItem {
  const name = validateMcpName(input.name);
  if (input.transport !== "stdio" && input.transport !== "http") {
    throw new LibraryItemError("invalid_item", `unknown MCP transport: ${String(input.transport)}`);
  }
  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;
  if (input.transport === "stdio") {
    if (typeof input.command !== "string" || input.command.trim().length === 0) {
      throw new LibraryItemError("missing_command", `stdio MCP server ${name} needs a command`);
    }
    command = input.command;
    if (input.args !== undefined) {
      if (
        !Array.isArray(input.args) ||
        input.args.some((arg) => typeof arg !== "string" || arg.includes("\u0000"))
      ) {
        throw new LibraryItemError("invalid_item", `stdio MCP server ${name}: args must be strings`);
      }
      args = input.args as string[];
    }
  } else {
    if (input.url === undefined || input.url === null || input.url === "") {
      throw new LibraryItemError("missing_url", `http MCP server ${name} needs a url`);
    }
    if (typeof input.url !== "string") {
      throw new LibraryItemError("invalid_url", `MCP url must be a string`);
    }
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new LibraryItemError("invalid_url", `MCP url is not a URL: ${JSON.stringify(input.url)}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new LibraryItemError("invalid_url", `MCP url must be http(s): ${JSON.stringify(input.url)}`);
    }
    url = input.url;
  }
  const env = validateEnvMap(input.env, `env of MCP server ${name}`);
  const headers = validateEnvMap(input.headers, `headers of MCP server ${name}`);
  return {
    kind: "mcp",
    name,
    transport: input.transport,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(url === undefined ? {} : { url }),
    ...(env === undefined ? {} : { env }),
    ...(headers === undefined ? {} : { headers }),
    contentHash: mcpContentHash({
      name,
      transport: input.transport,
      command: command ?? null,
      args: args ?? null,
      url: url ?? null,
      env: env ?? null,
      headers: headers ?? null,
    }),
    ...(input.source === undefined ? {} : { source: input.source }),
  };
}
