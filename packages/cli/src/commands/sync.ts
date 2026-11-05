import { createTwoFilesPatch } from "diff";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  MANIFEST_REL_PATH,
  SIZE_WARN_BYTES,
  LoadError,
  assessGeneratedFile,
  compileIgnorePatterns,
  findOrphans,
  hashContent,
  loadProject,
  normalizeText,
  readManifest,
  scanText,
  targetIdSchema,
  tryGetAdapter,
  writeManifest,
  type DriftState,
  type GeneratedFile,
  type Manifest,
  type ManifestFileEntry,
  type ProjectConfig,
  type SourceFile,
  type TargetAdapter,
  type TargetId,
} from "@runtime/core";
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
 * `runtime sync` (F1.2, F1.3, D5, D6, D8, D10):
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

  stdout(`project: ${config.project} (runtime spec ${config.runtime})`);
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

  // 5) Secret gate (D8): sources + generated output, findings always redacted.
  const secretFindings = collectSecretFindings(config, sources, generated);
  if (secretFindings.length > 0) {
    stderr("✘ secret detected — nothing was written");
    for (const finding of secretFindings) {
      stderr(`  ${finding.file}:${finding.line} — ${finding.ruleId}`);
      stderr(`    ${finding.snippet}`);
    }
    stderr(
      "  fix the source, or if it is not a real secret use a secrets.ignore entry or a `runtime:allow-secret` line marker",
    );
    return 3;
  }

  if (generated.length === 0) {
    stdout("nothing to generate (no registered adapter matched the targets)");
    return 0;
  }

  // 6) Manifest + disk state.
  const { manifest, corrupt } = await readManifest(options.cwd);
  if (corrupt) {
    stderr(
      `⚠ ${MANIFEST_REL_PATH} is unreadable — managed files will be treated as untracked; fix or delete it and re-run`,
    );
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
  // longer generated (e.g. the target was removed from project.yaml).
  const generatedPaths = new Set(generated.map((g) => g.path));
  const activeAdapterIds = new Set(adapters.map((a) => a.id));
  const orphanPaths = findOrphans(manifestFiles, generatedPaths).filter((p) => {
    const entry = manifestFiles[p];
    return entry !== undefined && activeAdapterIds.has(entry.adapter as TargetId);
  });

  // 7) Drift gating: hand-edited / untracked files are never overwritten without --force.
  const needsForce = (p: PlannedFile) => p.state === "hand-edited" || p.state === "untracked";
  const blocked = planned.filter((p) => needsForce(p) && !options.force);
  const writable = planned.filter((p) => !blocked.includes(p));

  // 8) Verify mode: report and stop before any write.
  if (options.verify) {
    for (const p of planned) stdout(`  ${p.state.padEnd(12)}${p.path}`);
    for (const p of orphanPaths) stdout(`  ${"orphaned".padEnd(12)}${p} (no longer generated)`);
    for (const b of blocked) stderr(`✘ drift: ${describeBlocked(b)}`);
    const changeCount = planned.length + orphanPaths.length;
    if (changeCount > 0) {
      stdout(`verify: ${changeCount} file(s) would change — run 'runtime sync' to update`);
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
  for (const b of blocked) stderr(`✘ drift: ${describeBlocked(b)}`);

  const actionCount = writable.length + orphanPaths.length;
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

  // 10) Write files, delete orphans, update the manifest.
  for (const p of writable) {
    const abs = path.join(options.cwd, p.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, p.content, "utf8"); // LF bytes, no translation (D5)
    stdout(`wrote ${p.path}`);
  }
  for (const orphan of orphanPaths) {
    await rm(path.join(options.cwd, orphan), { force: true });
    stdout(`deleted ${orphan}`);
  }

  const files: Record<string, ManifestFileEntry> = { ...manifestFiles };
  for (const p of writable) {
    files[p.path] = { adapter: p.adapterId, adapterVersion: p.adapterVersion, sha256: hashContent(p.content) };
  }
  for (const orphan of orphanPaths) {
    delete files[orphan];
  }
  const nextManifest: Manifest = {
    runtime: config.runtime,
    generator: `runtime@${CLI_VERSION}`,
    files,
  };
  await writeManifest(options.cwd, nextManifest);
  stdout(`updated ${MANIFEST_REL_PATH}`);

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

function collectSecretFindings(
  config: ProjectConfig,
  sources: SourceFile[],
  generated: Array<GeneratedFile & { adapter: TargetAdapter }>,
): SecretReport[] {
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
  return reports;
}

async function readIfExists(root: string, relPath: string): Promise<string | undefined> {
  try {
    return normalizeText(await readFile(path.join(root, relPath), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function describeBlocked(p: PlannedFile): string {
  return p.state === "hand-edited"
    ? `${p.path} was hand-edited — skipped (use --force to overwrite)`
    : `${p.path} exists but is not managed by Runtime — skipped (use --force to overwrite)`;
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
