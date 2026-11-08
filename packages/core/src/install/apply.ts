import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextFileAtomic } from "../parse/write.js";
import { sha256Hex } from "../parse/files.js";
import { validateSkillFilePath } from "../library/item.js";
import type { McpPlanStep, PlanStep, SkillPlanStep, InstallScope } from "./claude-code.js";

const execFile = promisify(execFileCallback);

/**
 * Apply, undo, verify, uninstall (P2.4; contracts in ADR 003 §3).
 *
 * Safety properties (each enforced here and tested in
 * packages/core/test/install-apply.test.ts):
 * - Plan→apply equality: every step re-verifies the exact target state it
 *   planned against before mutating; a mismatch is `target_changed` and
 *   nothing is written (adversarial test: "MCP command definitions that
 *   change between plan and apply (rejected)").
 * - Per-file atomic writes (temp+rename, docs/BUGS.md BUG-005) — a crash
 *   mid-step leaves whole files, and re-applying the same plan converges.
 * - The applied-items ledger is the ONLY proof of "we installed this";
 *   uninstall and undo touch ledger records only (adversarial test:
 *   "uninstall refuses to touch items we didn't install").
 * - Undo restores from the pre-apply snapshot (before-bytes for updates,
 *   deletion for adds) and refuses to clobber files whose hash no longer
 *   matches what we wrote — user edits survive (drift refusal).
 */

export type SpawnFn = (argv: string[]) => Promise<{ stdout: string; stderr: string }>;

export const defaultSpawn: SpawnFn = async (argv) => {
  const [file, ...args] = argv;
  if (file === undefined || file.length === 0) {
    throw new Error("empty argv");
  }
  const { stdout, stderr } = await execFile(file, args, {
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
};

export type ApplyErrorCode =
  | "target_changed"
  | "injected_failure"
  | "spawn_failed"
  | "io_error"
  | "not_ours"
  | "drifted"
  | "ledger_error"
  | "config_unreadable";

export class ApplyError extends Error {
  constructor(
    public readonly code: ApplyErrorCode,
    message: string,
    public readonly applied: AppliedRecord[] = [],
  ) {
    super(message);
    this.name = "ApplyError";
  }
}

/* ── applied-items ledger ───────────────────────────────────────────── */

export interface AppliedSkillRecord {
  kind: "skill";
  name: string;
  scope: InstallScope;
  itemHash: string;
  targetRoot: string;
  installedAt: string;
  files: Array<{ relPath: string; absPath: string; sha256: string }>;
  /** Files that existed before apply — the undo snapshot. */
  snapshot: Array<{ relPath: string; bytes: string }>;
}

export interface AppliedMcpRecord {
  kind: "mcp";
  name: string;
  scope: InstallScope;
  itemHash: string;
  configPath: string;
  entryJson: string;
  /** The entry this install replaced, for undo; null when it was absent. */
  prevEntryJson: string | null;
  cliArgv: string[];
  installedAt: string;
}

export type AppliedRecord = AppliedSkillRecord | AppliedMcpRecord;

function isRecordArray(value: unknown): value is AppliedRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        ((entry as AppliedRecord).kind === "skill" || (entry as AppliedRecord).kind === "mcp"),
    )
  );
}

export class AppliedItemsLedger {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AppliedRecord[]> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch {
      return []; // no ledger yet
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ApplyError(
        "ledger_error",
        `applied-items ledger is not valid JSON (${this.filePath}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecordArray(parsed)) {
      throw new ApplyError("ledger_error", `applied-items ledger has an unexpected shape: ${this.filePath}`);
    }
    return parsed;
  }

  async save(records: readonly AppliedRecord[]): Promise<void> {
    await writeTextFileAtomic(path.dirname(this.filePath), path.basename(this.filePath), `${JSON.stringify(records, null, 2)}\n`);
  }

  async add(record: AppliedRecord): Promise<void> {
    const all = await this.load();
    all.push(record);
    await this.save(all);
  }

  async removeWhere(predicate: (record: AppliedRecord) => boolean): Promise<number> {
    const all = await this.load();
    const kept = all.filter((record) => !predicate(record));
    if (kept.length !== all.length) await this.save(kept);
    return all.length - kept.length;
  }
}

/* ── apply ──────────────────────────────────────────────────────────── */

export interface ApplyContext {
  ledger: AppliedItemsLedger;
  spawn?: SpawnFn;
  /** Test hook: throw after the Nth completed step (crash-mid-apply). */
  failAfterStep?: (completedCount: number, step: PlanStep) => boolean;
  now?: () => string;
}

function assertInsideRoot(root: string, abs: string): void {
  const resolvedRoot = path.resolve(root) + path.sep;
  if (!(path.resolve(abs) + path.sep).startsWith(resolvedRoot)) {
    throw new ApplyError("target_changed", `destination escapes the target root: ${abs}`);
  }
}

async function currentHash(absPath: string): Promise<string | null> {
  try {
    return sha256Hex(await fs.readFile(absPath, "utf8"));
  } catch {
    return null; // absent or unreadable-as-text
  }
}

async function applySkillStep(
  step: SkillPlanStep,
  appliedSoFar: AppliedRecord[],
  now: string,
): Promise<AppliedSkillRecord> {
  // 1. Plan→apply equality: every planned write must still see the exact
  //    "before" state the plan captured.
  for (const write of step.writes) {
    validateSkillFilePath(write.relPath);
    assertInsideRoot(step.targetRoot, write.absPath);
    const current = await currentHash(write.absPath);
    if (write.before === "absent") {
      if (current !== null) {
        throw new ApplyError(
          "target_changed",
          `${write.absPath} appeared after planning (planned: absent, now: ${current.slice(0, 12)}…)`,
          appliedSoFar,
        );
      }
    } else if (current !== write.before.sha256) {
      throw new ApplyError(
        "target_changed",
        `${write.absPath} changed after planning (planned: ${write.before.sha256.slice(0, 12)}…, now: ${current === null ? "absent" : current.slice(0, 12) + "…"})`,
        appliedSoFar,
      );
    }
  }
  // 2. Snapshot the files we are about to overwrite (undo needs the bytes).
  const snapshot: Array<{ relPath: string; bytes: string }> = [];
  for (const write of step.writes) {
    if (write.before !== "absent") {
      snapshot.push({ relPath: write.relPath, bytes: await fs.readFile(write.absPath, "utf8") });
    }
  }
  // 3. Atomic per-file writes (temp+rename; BUG-005 machinery).
  const files: AppliedSkillRecord["files"] = [];
  try {
    for (const write of step.writes) {
      await writeTextFileAtomic(step.targetRoot, path.join(step.name, write.relPath), write.bytes);
      files.push({ relPath: write.relPath, absPath: write.absPath, sha256: write.afterSha256 });
    }
  } catch (error) {
    throw new ApplyError(
      "io_error",
      `skill write failed: ${error instanceof Error ? error.message : String(error)}`,
      appliedSoFar,
    );
  }
  return {
    kind: "skill",
    name: step.name,
    scope: step.scope,
    itemHash: step.itemHash,
    targetRoot: step.targetRoot,
    installedAt: now,
    files,
    snapshot,
  };
}

async function readEntryJson(configPath: string, name: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch {
    return null; // no config file
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ApplyError(
      "config_unreadable",
      `${configPath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const servers = (parsed as Record<string, unknown> | null)?.mcpServers;
  if (servers === undefined || servers === null || typeof servers !== "object") return null;
  const entry = (servers as Record<string, unknown>)[name];
  return entry === undefined ? null : JSON.stringify(entry);
}

async function applyMcpStep(
  step: McpPlanStep,
  spawn: SpawnFn,
  appliedSoFar: AppliedRecord[],
  now: string,
): Promise<AppliedMcpRecord> {
  // 1. Plan→apply equality at the entry level.
  const current = await readEntryJson(step.configPath, step.name);
  const planned = step.prevState === "absent" ? null : step.prevState.entryJson;
  if (current !== planned) {
    throw new ApplyError(
      "target_changed",
      `MCP entry "${step.name}" in ${step.configPath} changed between plan and apply (planned: ${planned === null ? "absent" : planned.slice(0, 60) + "…"}, now: ${current === null ? "absent" : current.slice(0, 60) + "…"})`,
      appliedSoFar,
    );
  }
  // 2. Run the official CLI (ADR 003 §2). Spawned argv is exactly what the plan showed.
  try {
    await spawn(step.cliArgv);
  } catch (error) {
    throw new ApplyError(
      "spawn_failed",
      `claude mcp add-json failed: ${error instanceof Error ? error.message : String(error)}`,
      appliedSoFar,
    );
  }
  return {
    kind: "mcp",
    name: step.name,
    scope: step.scope,
    itemHash: step.itemHash,
    configPath: step.configPath,
    entryJson: step.entryJson,
    prevEntryJson: planned,
    cliArgv: step.cliArgv,
    installedAt: now,
  };
}

export async function applyPlan(
  steps: readonly PlanStep[],
  ctx: ApplyContext,
): Promise<AppliedRecord[]> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const now = ctx.now ?? (() => new Date().toISOString());
  const applied: AppliedRecord[] = [];
  try {
    for (const step of steps) {
      if (step.kind === "skill" && step.writes.length === 0) continue; // nothing to change
      const record =
        step.kind === "skill"
          ? await applySkillStep(step, applied, now())
          : await applyMcpStep(step, spawn, applied, now());
      applied.push(record);
      await ctx.ledger.add(record);
      if (ctx.failAfterStep?.(applied.length, step)) {
        throw new ApplyError("injected_failure", `injected failure after step ${applied.length}`, applied);
      }
    }
    return applied;
  } catch (error) {
    if (error instanceof ApplyError) throw error;
    throw new ApplyError(
      "io_error",
      `apply failed: ${error instanceof Error ? error.message : String(error)}`,
      applied,
    );
  }
}

/* ── verify / undo / uninstall ──────────────────────────────────────── */

export async function verifyApplied(record: AppliedRecord): Promise<"ok" | "drifted" | "missing"> {
  if (record.kind === "skill") {
    let sawMissing = false;
    for (const file of record.files) {
      const current = await currentHash(file.absPath);
      if (current === null) {
        sawMissing = true;
        continue;
      }
      if (current !== file.sha256) return "drifted";
    }
    return sawMissing ? "missing" : "ok";
  }
  const current = await readEntryJson(record.configPath, record.name);
  if (current === null) return "missing";
  return current === record.entryJson ? "ok" : "drifted";
}

async function removeFileIfEmptyParent(dir: string, stopAt: string): Promise<void> {
  let current = dir;
  const stop = path.resolve(stopAt);
  while (path.resolve(current) !== stop && path.resolve(current).startsWith(stop)) {
    try {
      await fs.rmdir(current); // fails (not empty) → stop
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

export interface UndoContext {
  ledger: AppliedItemsLedger;
  spawn?: SpawnFn;
}

export interface UndoSummary {
  restoredFiles: number;
  deletedFiles: number;
  skippedDrifted: number;
}

/** Undoes applied records (reverse order). Skill files whose hash no longer
 *  matches what we wrote are LEFT ALONE and reported — undo never clobbers
 *  a user's edits. Ledger records are removed only after their undo succeeds. */
export async function undoApplied(
  records: readonly AppliedRecord[],
  ctx: UndoContext,
): Promise<UndoSummary> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const summary: UndoSummary = { restoredFiles: 0, deletedFiles: 0, skippedDrifted: 0 };
  for (const record of [...records].reverse()) {
    if (record.kind === "skill") {
      for (const file of record.files) {
        const current = await currentHash(file.absPath);
        if (current === null) continue; // already gone
        if (current !== file.sha256) {
          summary.skippedDrifted += 1; // user edited it — never clobber
          continue;
        }
        const before = record.snapshot.find((snap) => snap.relPath === file.relPath);
        if (before === undefined) {
          await fs.rm(file.absPath, { force: true });
          summary.deletedFiles += 1;
        } else {
          await writeTextFileAtomic(record.targetRoot, path.join(record.name, file.relPath), before.bytes);
          summary.restoredFiles += 1;
        }
        await removeFileIfEmptyParent(path.dirname(file.absPath), record.targetRoot);
      }
      await ctx.ledger.removeWhere((entry) => entry === record || sameIdentity(entry, record));
    } else {
      try {
        await spawn(["claude", "mcp", "remove", record.name, "--scope", record.scope]);
      } catch (error) {
        throw new ApplyError(
          "spawn_failed",
          `claude mcp remove failed during undo: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (record.prevEntryJson !== null) {
        try {
          await spawn([
            "claude",
            "mcp",
            "add-json",
            record.name,
            record.prevEntryJson,
            "--scope",
            record.scope,
          ]);
        } catch (error) {
          throw new ApplyError(
            "spawn_failed",
            `claude mcp add-json (restore previous) failed during undo: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await ctx.ledger.removeWhere((entry) => sameIdentity(entry, record));
    }
  }
  return summary;
}

function sameIdentity(a: AppliedRecord, b: AppliedRecord): boolean {
  return a.kind === b.kind && a.name === b.name && a.scope === b.scope;
}

export interface UninstallOptions extends UndoContext {
  /** Delete files even when they drifted from what we installed. */
  force?: boolean;
}

function findRecord(
  records: readonly AppliedRecord[],
  kind: "skill" | "mcp",
  name: string,
  scope: InstallScope,
): AppliedRecord | undefined {
  return records.find((record) => record.kind === kind && record.name === name && record.scope === scope);
}

/** L5/PRD: uninstall removes ONLY what we installed. The ledger record is the
 *  proof; without it, nothing is touched (adversarial test). */
export async function uninstallSkill(
  name: string,
  scope: InstallScope,
  ledger: AppliedItemsLedger,
  opts: UninstallOptions,
): Promise<UndoSummary> {
  const record = findRecord(await ledger.load(), "skill", name, scope);
  if (record === undefined || record.kind !== "skill") {
    throw new ApplyError("not_ours", `no applied-items record for skill "${name}" (${scope}) — refusing to touch it`);
  }
  const state = await verifyApplied(record);
  if (state === "drifted" && opts.force !== true) {
    throw new ApplyError("drifted", `skill "${name}" drifted from what we installed; pass force to delete anyway`);
  }
  const summary: UndoSummary = { restoredFiles: 0, deletedFiles: 0, skippedDrifted: 0 };
  for (const file of record.files) {
    const current = await currentHash(file.absPath);
    if (current === null) continue;
    if (current !== file.sha256 && opts.force !== true) {
      summary.skippedDrifted += 1;
      continue;
    }
    await fs.rm(file.absPath, { force: true });
    summary.deletedFiles += 1;
    await removeFileIfEmptyParent(path.dirname(file.absPath), record.targetRoot);
  }
  await ledger.removeWhere((entry) => sameIdentity(entry, record));
  return summary;
}

export async function uninstallMcp(
  name: string,
  scope: InstallScope,
  ledger: AppliedItemsLedger,
  opts: UninstallOptions,
): Promise<UndoSummary> {
  const record = findRecord(await ledger.load(), "mcp", name, scope);
  if (record === undefined || record.kind !== "mcp") {
    throw new ApplyError("not_ours", `no applied-items record for MCP server "${name}" (${scope}) — refusing to touch it`);
  }
  const state = await verifyApplied(record);
  if (state === "drifted" && opts.force !== true) {
    throw new ApplyError("drifted", `MCP server "${name}" drifted from what we installed; pass force to remove anyway`);
  }
  const spawn = opts.spawn ?? defaultSpawn;
  try {
    await spawn(["claude", "mcp", "remove", name, "--scope", scope]);
  } catch (error) {
    throw new ApplyError(
      "spawn_failed",
      `claude mcp remove failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await ledger.removeWhere((entry) => sameIdentity(entry, record));
  return { restoredFiles: 0, deletedFiles: 1, skippedDrifted: 0 };
}
