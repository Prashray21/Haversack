import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../parse/files.js";
import { AppliedItemsLedger, type AppliedMcpRecord, type AppliedSkillRecord } from "../install/apply.js";
import { claudeCodePaths, type ClaudeCodePaths, type InstallScope } from "../install/claude-code.js";

/**
 * Read-only inventory for the app's L1 screen (PRD v0.3 L1: "show the skills
 * and MCP servers already configured for the supported target"). Never
 * writes; never follows links; corrupt configs are reported as
 * `configErrors`, not thrown — inventory must always render.
 *
 * "Ours" is decided ONLY by the applied-items ledger (ADR 003 §3 contract 3)
 * matched on kind + name + scope + destination; a same-named foreign item is
 * never marked ours.
 */

export interface InventorySkillEntry {
  kind: "skill";
  name: string;
  scope: InstallScope;
  dir: string;
  /** True when every file hash matches our ledger record. */
  ours: boolean;
  itemHash?: string;
  symlink?: boolean;
}

export interface InventoryMcpEntry {
  kind: "mcp";
  name: string;
  scope: InstallScope;
  configPath: string;
  entry: unknown;
  ours: boolean;
  itemHash?: string;
}

export interface ClaudeCodeInventory {
  skills: InventorySkillEntry[];
  mcp: InventoryMcpEntry[];
  configErrors: string[];
}

export function inventoryClaudeCode(
  paths: ClaudeCodePaths = claudeCodePaths({ home: defaultHome(), projectRoot: process.cwd() }),
  opts: { ledgerPath?: string } = {},
): Promise<ClaudeCodeInventory> {
  return buildInventory(paths, opts.ledgerPath);
}

function defaultHome(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}

async function loadLedgerRecords(
  ledgerPath: string | undefined,
): Promise<{ skills: AppliedSkillRecord[]; mcp: AppliedMcpRecord[] }> {
  if (ledgerPath === undefined) return { skills: [], mcp: [] };
  const ledger = new AppliedItemsLedger(ledgerPath);
  const records = await ledger.load();
  return {
    skills: records.filter((record): record is AppliedSkillRecord => record.kind === "skill"),
    mcp: records.filter((record): record is AppliedMcpRecord => record.kind === "mcp"),
  };
}

async function skillItemHashFromDir(dir: string): Promise<string | undefined> {
  // Recompute the item hash for a directory the way ingest would, to show
  // which skill content is on disk (only meaningful for entries we can read).
  const files: Array<{ path: string; text: string }> = [];
  let stack: Array<{ current: string; rel: string }> = [{ current: dir, rel: "" }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const entries = await fs.readdir(frame.current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow
      const full = path.join(frame.current, entry.name);
      const rel = frame.rel === "" ? entry.name : `${frame.rel}/${entry.name}`;
      if (entry.isDirectory()) stack.push({ current: full, rel });
      else if (entry.isFile() && rel.length <= 256) {
        try {
          files.push({ path: rel, text: await fs.readFile(full, "utf8") });
        } catch {
          return undefined; // unreadable content → cannot hash
        }
      }
    }
  }
  if (!files.some((file) => file.path === "SKILL.md")) return undefined;
  const hashed = files.map((file) => ({ path: file.path, text: file.text, sha256: sha256Hex(file.text) }));
  // Canonical, same order as buildSkillItem: sorted by path.
  hashed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const { stableStringify } = await import("../drift/manifest.js");
  return sha256Hex(
    stableStringify({
      kind: "skill",
      files: hashed.map((file) => [file.path, file.sha256]),
    }),
  );
}

/** True when a ledger record for this skill exists AND its recorded files all
 *  still hash to what we wrote. */
async function skillIsOurs(
  record: AppliedSkillRecord | undefined,
  dir: string,
): Promise<{ ours: boolean; itemHash?: string }> {
  if (record === undefined) return { ours: false };
  let allMatch = record.files.length > 0;
  for (const file of record.files) {
    try {
      const current = sha256Hex(await fs.readFile(file.absPath, "utf8"));
      if (current !== file.sha256) {
        allMatch = false;
        break;
      }
    } catch {
      allMatch = false;
      break;
    }
  }
  return { ours: allMatch, itemHash: allMatch ? record.itemHash : undefined };
}

async function buildInventory(paths: ClaudeCodePaths, ledgerPath?: string): Promise<ClaudeCodeInventory> {
  const { skills: skillRecords, mcp: mcpRecords } = await loadLedgerRecords(ledgerPath);
  const inventory: ClaudeCodeInventory = { skills: [], mcp: [], configErrors: [] };

  for (const scope of ["user", "project"] as const) {
    const root = scope === "user" ? path.join(paths.home, ".claude", "skills") : path.join(paths.projectRoot, ".claude", "skills");
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue; // no skills dir at this scope
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(root, entry.name);
      const record = skillRecords.find((candidate) => candidate.name === entry.name && candidate.scope === scope);
      if (entry.isSymbolicLink()) {
        inventory.skills.push({ kind: "skill", name: entry.name, scope, dir, ours: false, symlink: true });
        continue;
      }
      const oursResult = await skillIsOurs(record, dir);
      inventory.skills.push({
        kind: "skill",
        name: entry.name,
        scope,
        dir,
        ours: oursResult.ours,
        ...(oursResult.itemHash === undefined
          ? { itemHash: record !== undefined ? undefined : await skillItemHashFromDir(dir) }
          : { itemHash: oursResult.itemHash }),
      });
    }

    const configPath =
      scope === "user" ? path.join(paths.home, ".claude.json") : path.join(paths.projectRoot, ".mcp.json");
    let parsed: unknown;
    try {
      const text = await fs.readFile(configPath, "utf8");
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        inventory.configErrors.push(`${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    const servers = (parsed as Record<string, unknown> | null)?.mcpServers;
    if (servers === undefined || servers === null || typeof servers !== "object") continue;
    for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
      const record = mcpRecords.find((candidate) => candidate.name === name && candidate.scope === scope);
      const ours =
        record !== undefined &&
        JSON.stringify(entry) === record.entryJson;
      inventory.mcp.push({
        kind: "mcp",
        name,
        scope,
        configPath,
        entry,
        ours,
        ...(ours && record !== undefined ? { itemHash: record.itemHash } : {}),
      });
    }
  }
  return inventory;
}
