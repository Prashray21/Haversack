import { createTwoFilesPatch } from "diff";
import { readFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  LEGACY_CURSOR_MDC_PATH,
  LEGACY_MANIFEST_REL_PATH,
  MANIFEST_REL_PATH,
  SIZE_WARN_BYTES,
  LoadError,
  assessGeneratedFile,
  compileIgnorePatterns,
  findOrphans,
  hasGeneratedHeader,
  hashContent,
  loadProject,
  normalizeText,
  readManifest,
  scanText,
  specVersionOf,
  targetIdSchema,
  tryGetAdapter,
  writeManifest,
  writeTextFileAtomic,
  type DriftState,
  type GeneratedFile,
  type Manifest,
  type ManifestFileEntry,
  type ProjectConfig,
  type SourceFile,
  type TargetAdapter,
  type TargetId,
} from "@haversackhq/core";
import { CLI_VERSION } from "../version.js";

export interface SyncOptions {
  cwd: string;
  yes: boolean;
  verify: boolean;
  target?: string;
  force: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Injectable for tests; defaults to a readline prompt. */
  prompt?: (question: string) => Promise<string>;
}

interface PlannedFile {
  path: string;
  adapterId: string;
  adapterVersion: number;
  /** New (generated) content. */
  content: string;
  /** LF-normalized disk content, or undefined when the file does not exist. */
  current: string | undefined;
  state: DriftState;
}

interface SecretReport {
  file: string;
  ruleId: string;
  line: number;
  snippet: string;
}

/**
 * `haversack sync` (F1.2, F1.3, D5, D6, D8, D10, ADR 002 migration):
 *   load → generate → secret gate → assess drift → show diff → write + manifest.
 * Exit codes: 0 ok, 1 changes/drift detected, 2 config error, 3 secret found.
 */
export async function runSync(options: SyncOptions): Promise<number> {
  const { stdout, stderr } = options;

  // 1) Load the definition.
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
  const { config, sources, warnings } = loaded;

  stdout(`project: ${config.project} (spec version ${specVersionOf(config)})`);
  for (const warning of warnings) stdout(`⚠ ${warning.message}`);

  // 2) Resolve targets and adapters.
  const targets = resolveTargets(config.targets, options.target, stderr);
  if (targets === null) return 2;

  const adapters: TargetAdapter[] = [];
  for (const id of targets) {
    const adapter = tryGetAdapter(id);
    if (!adapter) {
      stdout(`⚠ no adapter registered for '${id}' — skipping (not implemented yet)`);
      continue;
    }
    adapters.push(adapter);
  }

  // 3) Generate (adapters are pure; the same definition always yields the same bytes).
  const compiled = { config, sources, definitionHash: loaded.definitionHash };
  const generated: Array<GeneratedFile & { adapter: TargetAdapter }> = [];
  for (const adapter of adapters) {
    for (const file of adapter.generate(compiled)) {
      generated.push({ ...file, adapter });
    }
  }

  // 4) Size warnings (D10).
  for (const file of generated) {
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > SIZE_WARN_BYTES) {
      stdout(
        `⚠ ${file.path} is ${(bytes / 1024).toFixed(1)} KB (over ${Math.round(SIZE_WARN_BYTES / 1024)} KB) — consider splitting context; import mode lands in v1.1`,
      );
    }
  }

  // 5) Secret gate (D8): the definition file itself + sources + generated
  // output. Findings are always redacted.
  const secretFindings = await collectSecretFindings(
    options.cwd,
    loaded.configPath,
    config,
    sources,
    generated,
  );
  if (secretFindings.length > 0) {
    stderr("✘ secret detected — nothing was written");
    for (const finding of secretFindings) {
      stderr(`  ${finding.file}:${finding.line} — ${finding.ruleId}`);
      stderr(`    ${finding.snippet}`);
    }
    stderr(
      "  fix the source, or if it is not a real secret use a secrets.ignore entry or a `haversack:allow-secret` line marker (the legacy `runtime:allow-secret` marker is still honored)",
    );
    return 3;
  }

  if (generated.length === 0) {
    stdout("nothing to generate (no registered adapter matched the targets)");
    return 0;
  }

  // 6) Manifest + disk state. A manifest from the Project Runtime era
  // (.runtime/manifest.json) is adopted here and replaced by the new one on
  // write (ADR 002 §3.1).
  const { manifest, corrupt, sourcePath: manifestSourcePath } = await readManifest(options.cwd);
  if (corrupt) {
    stderr(
      `⚠ ${manifestSourcePath} is unreadable — managed files will be treated as untracked; fix or delete it and re-run`,
    );
  }
  const manifestIsLegacy = manifest !== undefined && manifestSourcePath === LEGACY_MANIFEST_REL_PATH;
  if (manifestIsLegacy) {
    stdout(`migrating legacy manifest: ${LEGACY_MANIFEST_REL_PATH} → ${MANIFEST_REL_PATH}`);
  }
  const manifestFiles: Record<string, ManifestFileEntry> = manifest?.files ?? {};

  const planned: PlannedFile[] = [];
  for (const file of generated) {
    const current = await readIfExists(options.cwd, file.path);
    const state = assessGeneratedFile({
      generated: file.content,
      onDisk: current,
      manifestEntry: manifestFiles[file.path],
    });
    if (state === "unchanged") continue;
    planned.push({
      path: file.path,
      adapterId: file.adapter.id,
      adapterVersion: file.adapter.version,
      content: file.content,
      current,
      state,
    });
  }

  // Orphans: manifest entries of the adapters that ran, whose paths are no
  // longer generated (e.g. the target was removed from project.yaml — or the
  // cursor rule was renamed runtime.mdc → haversack.mdc, ADR 002 §3.4).
  const generatedPaths = new Set(generated.map((g) => g.path));
  const activeAdapterIds = new Set(adapters.map((a) => a.id));
  const orphanPaths = findOrphans(manifestFiles, generatedPaths).filter((p) => {
    const entry = manifestFiles[p];
    return entry !== undefined && activeAdapterIds.has(entry.adapter as TargetId);
  });

  // Legacy cursor rule (ADR 002 §3.4): the output was renamed
  // .cursor/rules/runtime.mdc → .cursor/rules/haversack.mdc. A tracked,
  // unmodified legacy file flows through the normal orphan deletion; a
  // hand-edited one is never deleted (kept + warned); an untracked file
  // carrying one of our generated headers is removed as ours.
  let legacyCursorCleanup = false;
  if (!generatedPaths.has(LEGACY_CURSOR_MDC_PATH)) {
    const legacyCursorIndex = orphanPaths.indexOf(LEGACY_CURSOR_MDC_PATH);
    const legacyDisk = await readIfExists(options.cwd, LEGACY_CURSOR_MDC_PATH);
    if (legacyDisk !== undefined && legacyCursorIndex < 0 && !manifestFiles[LEGACY_CURSOR_MDC_PATH]) {
      if (hasGeneratedHeader(legacyDisk)) {
        legacyCursorCleanup = true;
      }
    } else if (legacyDisk !== undefined && legacyCursorIndex >= 0 && !options.force) {
      const entry = manifestFiles[LEGACY_CURSOR_MDC_PATH];
      if (entry && hashContent(legacyDisk) !== entry.sha256) {
        orphanPaths.splice(legacyCursorIndex, 1);
        stdout(`⚠ legacy ${LEGACY_CURSOR_MDC_PATH} is hand-edited — not removed; delete it manually or re-run with --force`);
      }
    }
  }

  // 7) Drift gating: hand-edited / untracked files are never overwritten without --force.
  const needsForce = (p: PlannedFile) => p.state === "hand-edited" || p.state === "untracked";
  const blocked = planned.filter((p) => needsForce(p) && !options.force);
  const writable = planned.filter((p) => !blocked.includes(p));

  // 8) Verify mode: report and stop before any write.
  if (options.verify) {
    for (const p of planned) stdout(`  ${p.state.padEnd(12)}${p.path}`);
    for (const p of orphanPaths) stdout(`  ${"orphaned".padEnd(12)}${p} (no longer generated)`);
    if (legacyCursorCleanup) stdout(`  ${"orphaned".padEnd(12)}${LEGACY_CURSOR_MDC_PATH} (renamed to .cursor/rules/haversack.mdc)`);
    for (const b of blocked) stderr(`✘ drift: ${describeBlocked(b)}`);
    const changeCount = planned.length + orphanPaths.length + (legacyCursorCleanup ? 1 : 0);
    if (changeCount > 0) {
      stdout(`verify: ${changeCount} file(s) would change — run 'haversack sync' to update`);
      return 1;
    }
    stdout(`verify: all ${generated.length} generated file(s) in sync`);
    return 0;
  }

  // 9) Write mode: show diffs, then confirm unless -y.
  for (const p of writable) {
    stdout(`${p.state.padEnd(12)}${p.path}`);
    stdout(renderDiff(p));
  }
  for (const orphan of orphanPaths) {
    stdout(`orphaned    ${orphan} — no longer generated; it will be deleted`);
    const disk = await readIfExists(options.cwd, orphan);
    if (disk !== undefined && hashContent(disk) !== manifestFiles[orphan]?.sha256) {
      stderr(`⚠ ${orphan} changed since it was synced — deleting anyway on confirmation`);
    }
  }
  if (legacyCursorCleanup) {
    stdout(`migrated    ${LEGACY_CURSOR_MDC_PATH} — renamed to .cursor/rules/haversack.mdc; it will be deleted`);
  }
  for (const b of blocked) stderr(`✘ drift: ${describeBlocked(b)}`);

  const actionCount = writable.length + orphanPaths.length + (legacyCursorCleanup ? 1 : 0);
  if (actionCount === 0) {
    if (blocked.length > 0) {
      stdout("nothing written — resolve the drift above or re-run with --force");
      return 1;
    }
    stdout(`everything in sync (${generated.length} file(s) managed)`);
    return 0;
  }

  if (!options.yes) {
    const answer = await (options.prompt ?? defaultPrompt)(
      `Write ${actionCount} file(s)? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      stdout("aborted — nothing written");
      return 1;
    }
  }

  // 10) Write files (atomically: temp file + rename), delete orphans, update the manifest.
  try {
    for (const p of writable) {
      await writeTextFileAtomic(options.cwd, p.path, p.content); // LF bytes, no translation (D5)
      stdout(`wrote ${p.path}`);
    }
    for (const orphan of orphanPaths) {
      await rm(path.join(options.cwd, orphan), { force: true });
      stdout(`deleted ${orphan}`);
    }
    if (legacyCursorCleanup) {
      await rm(path.join(options.cwd, LEGACY_CURSOR_MDC_PATH), { force: true });
      stdout(`migrated: removed legacy ${LEGACY_CURSOR_MDC_PATH}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stderr(`✘ write failed: ${detail}`);
    stderr("  files written so far are complete; the manifest was not updated — re-run 'haversack sync' to converge");
    return 1;
  }

  const files: Record<string, ManifestFileEntry> = { ...manifestFiles };
  for (const p of writable) {
    files[p.path] = { adapter: p.adapterId, adapterVersion: p.adapterVersion, sha256: hashContent(p.content) };
  }
  for (const orphan of orphanPaths) {
    delete files[orphan];
  }
  const nextManifest: Manifest = {
    haversack: specVersionOf(config),
    generator: `haversack@${CLI_VERSION}`,
    files,
  };
  await writeManifest(options.cwd, nextManifest);
  stdout(`updated ${MANIFEST_REL_PATH}`);

  if (manifestIsLegacy) {
    // Adoption is complete only once the legacy manifest is gone (ADR 002 §3.1).
    try {
      await rm(path.join(options.cwd, LEGACY_MANIFEST_REL_PATH), { force: true });
      await rmdir(path.dirname(LEGACY_MANIFEST_REL_PATH));
      stdout(`removed legacy ${LEGACY_MANIFEST_REL_PATH}`);
    } catch {
      // Not empty (e.g. the legacy budget.json, which migrates on the next
      // LLM check run) or already gone — harmless either way.
    }
  }

  return blocked.length > 0 ? 1 : 0;
}

/* ── helpers ────────────────────────────────────────────────── */

function resolveTargets(
  targets: TargetId[],
  targetFlag: string | undefined,
  stderr: (line: string) => void,
): TargetId[] | null {
  if (targetFlag === undefined) return targets;
  const parsed = targetIdSchema.safeParse(targetFlag);
  if (!parsed.success) {
    stderr(`✘ unknown target '${targetFlag}' — supported: ${targets.join(", ")}`);
    return null;
  }
  if (!targets.includes(parsed.data)) {
    stderr(`✘ target '${parsed.data}' is not in project.yaml targets (${targets.join(", ")})`);
    return null;
  }
  return [parsed.data];
}

async function collectSecretFindings(
  cwd: string,
  configPath: string,
  config: ProjectConfig,
  sources: SourceFile[],
  generated: Array<GeneratedFile & { adapter: TargetAdapter }>,
): Promise<SecretReport[]> {
  const ignore = compileIgnorePatterns(config.secrets.ignore.map((entry) => entry.pattern));
  const reports: SecretReport[] = [];
  for (const source of sources) {
    for (const finding of scanText(source.content, { ignore })) {
      reports.push({ file: source.path, ...finding });
    }
  }
  for (const file of generated) {
    for (const finding of scanText(file.content, { ignore })) {
      reports.push({ file: file.path, ...finding });
    }
  }
  // The definition file is scanned too: a credential pasted into project.yaml
  // (a prompt, a description) must block the sync just like any other source.
  const configRaw = await readConfigRaw(cwd, configPath);
  if (configRaw !== undefined) {
    for (const finding of scanText(configRaw, { ignore })) {
      reports.push({ file: configPath, ...finding });
    }
  }
  return reports;
}

async function readConfigRaw(cwd: string, configPath: string): Promise<string | undefined> {
  try {
    return normalizeText(await readFile(path.join(cwd, configPath), "utf8"));
  } catch {
    return undefined;
  }
}

async function readIfExists(root: string, relPath: string): Promise<string | undefined> {
  try {
    return normalizeText(await readFile(path.join(root, relPath), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOENT: not there. EISDIR: a directory sits at the generated path —
    // nothing readable; the write stage surfaces it as a clear failure (exit 1).
    if (code === "ENOENT" || code === "EISDIR") return undefined;
    throw error;
  }
}

function describeBlocked(p: PlannedFile): string {
  return p.state === "hand-edited"
    ? `${p.path} was hand-edited — skipped (use --force to overwrite)`
    : `${p.path} exists but is not managed by Haversack — skipped (use --force to overwrite)`;
}

function renderDiff(p: PlannedFile): string {
  const patch = createTwoFilesPatch(
    `a/${p.path}`,
    `b/${p.path}`,
    p.current ?? "",
    p.content,
    undefined,
    undefined,
    { context: 2 },
  );
  return patch.trimEnd();
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
