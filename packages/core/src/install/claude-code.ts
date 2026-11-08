import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../parse/files.js";
import { validateMcpName, validateSkillName, type McpItem, type SkillItem } from "../library/item.js";

/**
 * Install planner + first-target adapter (P2.3; interface in ADR 003 §3).
 *
 * Planning is a PREVIEW: it reads target state, computes exact destinations,
 * exact JSON, and the exact `claude mcp` argv — and never writes or spawns.
 * The desktop app renders a plan as the diff the person approves; apply
 * (P2.4) executes only approved steps and re-verifies the target state each
 * step planned against.
 *
 * Facts this encodes are cited in ADR 003 §1–§2 (official Claude Code docs,
 * fetched 2026-11-08): skills at `<home>/.claude/skills/<name>/` or
 * `<project>/.claude/skills/<name>/`; MCP entries via `claude mcp add-json
 * <name> '<json>' --scope user|project` writing `~/.claude.json`
 * (top-level `mcpServers`) or `<project>/.mcp.json`; native `${VAR}` /
 * `${VAR:-default}` expansion in `command`, `args`, `env`, `url`, `headers`.
 */

export type InstallScope = "user" | "project";

export class InstallPlanError extends Error {
  constructor(
    public readonly code: "config_unreadable" | "missing_scope_root" | "invalid_item",
    message: string,
  ) {
    super(message);
    this.name = "InstallPlanError";
  }
}

export interface ClaudeCodePaths {
  home: string;
  projectRoot: string;
}

/** Computes the concrete target paths for Claude Code on this machine
 *  (ADR 003 §2 table). `projectRoot ?? home` means a project-scope plan
 *  without an explicit project lands under home — callers must pass a real
 *  project root for project scope. */
export function claudeCodePaths(opts: { home: string; projectRoot?: string }): ClaudeCodePaths {
  return { home: path.resolve(opts.home), projectRoot: path.resolve(opts.projectRoot ?? opts.home) };
}

function skillsRoot(paths: ClaudeCodePaths, scope: InstallScope): string {
  return scope === "user"
    ? path.join(paths.home, ".claude", "skills")
    : path.join(paths.projectRoot, ".claude", "skills");
}

function mcpConfigPath(paths: ClaudeCodePaths, scope: InstallScope): string {
  return scope === "user"
    ? path.join(paths.home, ".claude.json")
    : path.join(paths.projectRoot, ".mcp.json");
}

/* ── plan types ─────────────────────────────────────────────────────── */

export interface SkillPlanWrite {
  relPath: string;
  absPath: string;
  before: "absent" | { sha256: string };
  afterSha256: string;
  /** Exact bytes apply will write (carried so apply never re-reads the item). */
  bytes: string;
}

export interface SkillPlanStep {
  kind: "skill";
  action: "add" | "update";
  scope: InstallScope;
  name: string;
  itemHash: string;
  targetRoot: string;
  writes: SkillPlanWrite[];
}

export interface McpPlanStep {
  kind: "mcp";
  action: "add" | "update";
  scope: InstallScope;
  name: string;
  itemHash: string;
  /** The exact JSON entry (the inner object — NOT the mcpServers wrapper). */
  entryJson: string;
  configPath: string;
  /** Exact argv apply will spawn: ["claude","mcp","add-json",name,<json>,"--scope",scope]. */
  cliArgv: string[];
  /** The entry state this plan was computed against; apply re-checks it. */
  prevState: "absent" | { entryJson: string };
  /** True when a real secret value was inlined (user scope only, ADR 003 §2). */
  secretsInline: boolean;
}

export type PlanStep = SkillPlanStep | McpPlanStep;

/* ── skill planning ─────────────────────────────────────────────────── */

export async function planSkillInstall(
  item: SkillItem,
  scope: InstallScope,
  paths: ClaudeCodePaths,
): Promise<SkillPlanStep> {
  // Defense-in-depth: re-validate the name at plan time (the item validated
  // it at build; a tampered in-memory item must not reach a destination).
  validateSkillName(item.name);
  const targetRoot = skillsRoot(paths, scope);
  const dir = path.join(targetRoot, item.name);
  const writes: SkillPlanWrite[] = [];
  let anyExists = false;
  for (const file of item.files) {
    const absPath = path.join(dir, file.path);
    let before: "absent" | { sha256: string } = "absent";
    try {
      before = { sha256: sha256Hex(await fs.readFile(absPath, "utf8")) };
      anyExists = true;
    } catch {
      // absent
    }
    if (before !== "absent" && before.sha256 === file.sha256) continue; // unchanged → not in the diff
    writes.push({ relPath: file.path, absPath, before, afterSha256: file.sha256, bytes: file.text });
  }
  return {
    kind: "skill",
    action: anyExists ? "update" : "add",
    scope,
    name: item.name,
    itemHash: item.contentHash,
    targetRoot,
    writes,
  };
}

/* ── MCP planning ───────────────────────────────────────────────────── */

async function readMcpConfig(configPath: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch {
    return undefined; // no config yet
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new InstallPlanError(
      "config_unreadable",
      `${configPath} is not readable JSON (${error instanceof Error ? error.message : String(error)}) — refusing to plan against it; fix or remove the file first`,
    );
  }
}

async function readExistingEntry(
  configPath: string,
  name: string,
): Promise<{ prev: McpPlanStep["prevState"]; hadConfig: boolean }> {
  const config = await readMcpConfig(configPath);
  const servers = config?.mcpServers;
  if (servers === undefined || servers === null || typeof servers !== "object") {
    return { prev: "absent", hadConfig: config !== undefined };
  }
  const entry = (servers as Record<string, unknown>)[name];
  return entry === undefined ? { prev: "absent", hadConfig: true } : { prev: { entryJson: JSON.stringify(entry) }, hadConfig: true };
}

export interface PlanMcpOptions {
  /** Placeholder → real value, from Windows-protected storage (PRD L6).
   *  Used ONLY for user scope; project scope always expands placeholders. */
  secretValues?: Record<string, string>;
}

export async function planMcpInstall(
  item: McpItem,
  scope: InstallScope,
  paths: ClaudeCodePaths,
  opts: PlanMcpOptions = {},
): Promise<McpPlanStep> {
  validateMcpName(item.name);
  const configPath = mcpConfigPath(paths, scope);
  const { prev } = await readExistingEntry(configPath, item.name);
  let secretsInline = false;

  const envValue = (placeholder: string): string => {
    if (scope === "project") return `\${${placeholder}}`;
    const value = opts.secretValues?.[placeholder];
    if (value === undefined) return `\${${placeholder}}`;
    secretsInline = true;
    return value;
  };

  const entry: Record<string, unknown> =
    item.transport === "stdio"
      ? {
          type: "stdio",
          command: item.command,
          ...(item.args === undefined ? {} : { args: item.args }),
          ...(item.env === undefined ? {} : { env: Object.fromEntries(Object.entries(item.env).map(([key, value]) => [key, envValue(value.placeholder)])) }),
        }
      : {
          type: "http",
          url: item.url,
          ...(item.headers === undefined
            ? {}
            : { headers: Object.fromEntries(Object.entries(item.headers).map(([key, value]) => [key, envValue(value.placeholder)])) }),
        };
  const entryJson = JSON.stringify(entry);
  return {
    kind: "mcp",
    action: prev === "absent" ? "add" : "update",
    scope,
    name: item.name,
    itemHash: item.contentHash,
    entryJson,
    configPath,
    cliArgv: ["claude", "mcp", "add-json", item.name, entryJson, "--scope", scope],
    prevState: prev,
    secretsInline,
  };
}
