import { readdir, readFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONFIG_FILE,
  SPEC_VERSION,
  specVersionOf,
  LoadError,
  loadProject,
  normalizeText,
  projectConfigSchema,
  scanText,
  tryGetAdapter,
  writeTextFileAtomic,
  type ProjectConfig,
} from "@haversackhq/core";

export interface InitOptions {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface IngestCandidate {
  /** Repo-relative path of the existing file. */
  source: string;
  /** Where it migrates to: context files feed memory, rules files instruct. */
  kind: "context" | "rules";
  /** Repo-relative destination path. */
  destination: string;
  content: string;
}

interface ExistingToolFile {
  source: string;
  destination: string;
  kind: "context" | "rules";
}

/**
 * Where init looks for existing AI-tool config files (F5.1, D11). CLAUDE.md is
 * project memory → context; AGENTS.md and .cursor/rules are agent
 * instructions → rules. `.cursor/rules` is scanned non-recursively for
 * `.md`/`.mdc` files (its documented layout).
 */
const EXISTING_TOOL_FILES: readonly ExistingToolFile[] = [
  { source: "CLAUDE.md", destination: "context/existing-claude.md", kind: "context" },
  { source: "AGENTS.md", destination: "rules/existing-agents.md", kind: "rules" },
];

const CURSOR_RULES_DIR = ".cursor/rules";
const CURSOR_EXTENSIONS = new Set([".md", ".mdc"]);

/** Max ingested file size — same cap as definition sources. */
const MAX_INGEST_BYTES = 128 * 1024;

/**
 * `haversack init` (F5.1, D11): scans the repo for existing AI-tool config
 * files, migrates them into context/ and rules/, and writes a DRAFT
 * project.yaml for human review.
 *
 * Guarantees:
 *  - never overwrites an existing file (a repo with a project.yaml refuses);
 *  - ingested content passes the secret gate before anything is written
 *    (exit 3, redacted);
 *  - the draft is schema-valid by construction (validated before writing).
 */
export async function runInit(options: InitOptions): Promise<number> {
  const { stdout, stderr } = options;

  // Never overwrite an existing definition (D11).
  try {
    const loaded = await loadProject({ cwd: options.cwd });
    void loaded;
    stderr(`✘ ${DEFAULT_CONFIG_FILE} already exists in this repo.`);
    stderr("  init does not modify existing definitions — edit it directly, or delete it first if you truly want a fresh draft.");
    return 2;
  } catch (error) {
    if (!(error instanceof LoadError)) throw error;
    // LoadError with "not found" is the expected fresh-repo case; any other
    // load failure means a broken file we must not bulldoze.
    if (!error.report.includes("not found")) {
      stderr(`✘ ${error.report}`);
      stderr("  init refuses to run while the existing project.yaml fails to load — fix or remove it first.");
      return 2;
    }
  }

  // 1) Scan for existing tool config files.
  const candidates: IngestCandidate[] = [];
  for (const entry of EXISTING_TOOL_FILES) {
    const content = await readIfExists(options.cwd, entry.source, MAX_INGEST_BYTES);
    if (content !== undefined) {
      candidates.push({ source: entry.source, destination: entry.destination, kind: entry.kind, content });
    }
  }
  const cursorRules = await readCursorRules(options.cwd);
  for (const file of cursorRules) {
    candidates.push(file);
  }

  // 2) Secret gate (D8) on ingested content BEFORE anything is written.
  const secretReports: Array<{ file: string; line: number; ruleId: string; snippet: string }> = [];
  for (const candidate of candidates) {
    for (const finding of scanText(candidate.content)) {
      secretReports.push({ file: candidate.source, line: finding.line, ruleId: finding.ruleId, snippet: finding.snippet });
    }
  }
  if (secretReports.length > 0) {
    stderr("✘ secret detected in existing config files — nothing was written (D8)");
    for (const finding of secretReports) {
      stderr(`  ${finding.file}:${finding.line} — ${finding.ruleId}`);
      stderr(`    ${finding.snippet}`);
    }
    stderr("  redact or remove the secret, then re-run init (a haversack:allow-secret marker skips a line; the legacy runtime: marker is honored too).");
    return 3;
  }

  // 3) Destination collisions are never overwritten.
  for (const candidate of candidates) {
    if (await fileExists(options.cwd, candidate.destination)) {
      stderr(`✘ ${candidate.destination} already exists — init never overwrites files. Move or rename it, then re-run.`);
      return 2;
    }
  }

  // 4) Draft the definition (DRAFT marker, human review required).
  const contextPaths = candidates.filter((c) => c.kind === "context").map((c) => c.destination);
  const rulesPaths = candidates.filter((c) => c.kind === "rules").map((c) => c.destination);
  const projectName =
    path
      .basename(path.resolve(options.cwd))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "my-project";

  const config: ProjectConfig = projectConfigSchema.parse({
    haversack: SPEC_VERSION,
    project: projectName,
    context: contextPaths,
    rules: rulesPaths,
    targets: ["claude-code"],
    checks: [],
  });

  // 5) Write the migrated content, then resolve conflicts with generated
  // output (F5.1: ingest "rather than leaving them to conflict with
  // generated files"). A source whose path is a generated output of the
  // draft's targets is MOVED (verified copy first, then the original is
  // removed) — leaving it would block `haversack sync` at the drift gate.
  // Sources with no generated counterpart yet (e.g. .cursor/rules before the
  // cursor adapter exists) are copied; their originals keep working for the
  // tools that still read them.
  const generatedPaths = draftGeneratedPaths(config);
  for (const candidate of candidates) {
    await writeTextFileAtomic(options.cwd, candidate.destination, candidate.content);
    if (generatedPaths.has(candidate.source)) {
      const copied = await readIfExists(options.cwd, candidate.destination, MAX_INGEST_BYTES);
      if (copied !== undefined && copied === candidate.content) {
        try {
          await rm(path.join(options.cwd, candidate.source), { force: true });
          stdout(`moved ${candidate.source} → ${candidate.destination} (original removed: it conflicts with the generated ${candidate.source})`);
          continue;
        } catch {
          stderr(`⚠ could not remove ${candidate.source} after copying — remove it manually; sync will refuse to overwrite it until then`);
        }
      } else {
        stderr(`⚠ could not verify the copy of ${candidate.source} — original left in place; remove it manually before running sync`);
      }
    } else {
      stdout(`copied ${candidate.source} → ${candidate.destination}`);
    }
  }

  const draft = renderDraft(config, candidates.map((candidate) => candidate.source));
  await writeTextFileAtomic(options.cwd, DEFAULT_CONFIG_FILE, draft);
  stdout(`wrote ${DEFAULT_CONFIG_FILE} (DRAFT — review before syncing)`);

  // 6) Next steps.
  stdout("");
  stdout("next steps:");
  stdout(`  1. review ${DEFAULT_CONFIG_FILE} — the project name, targets, and file layout are a starting point`);
  stdout("  2. add real checks (static, and llm once the judge exists)");
  stdout("  3. run `haversack sync` to compile the definition into tool configs");
  return 0;
}

/* ── scanning ───────────────────────────────────────────────── */

async function readIfExists(root: string, relPath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(root, relPath), "utf8");
    if (raw.length > maxBytes) {
      throw new Error(`larger than ${Math.round(maxBytes / 1024)} KB cap`);
    }
    return normalizeText(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return undefined;
    throw error;
  }
}

async function fileExists(root: string, relPath: string): Promise<boolean> {
  try {
    return (await stat(path.join(root, relPath))).isFile();
  } catch {
    return false;
  }
}

async function readCursorRules(root: string): Promise<IngestCandidate[]> {
  const dirAbs = path.join(root, CURSOR_RULES_DIR);
  let names: string[];
  try {
    names = await readdir(dirAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const candidates: IngestCandidate[] = [];
  const sorted = names.filter((name) => CURSOR_EXTENSIONS.has(path.extname(name).toLowerCase())).sort();
  for (const name of sorted) {
    const content = await readIfExists(root, `${CURSOR_RULES_DIR}/${name}`, MAX_INGEST_BYTES);
    if (content === undefined) continue;
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    candidates.push({
      source: `${CURSOR_RULES_DIR}/${name}`,
      destination: `rules/existing-cursor-${safeName}`,
      kind: "rules",
      content,
    });
  }
  return candidates;
}

/* ── draft rendering ────────────────────────────────────────── */

/**
 * The paths the draft's targets would generate, used to decide which migrated
 * sources must MOVE rather than be copied (F5.1 conflict rule). Adapters are
 * pure, so generating against an empty source list is safe — only paths matter.
 */
function draftGeneratedPaths(config: ProjectConfig): Set<string> {
  const paths = new Set<string>();
  for (const target of config.targets) {
    const adapter = tryGetAdapter(target);
    if (!adapter) continue;
    for (const file of adapter.generate({
      config,
      sources: [],
      definitionHash: "init-conflict-scan",
    })) {
      paths.add(file.path);
    }
  }
  return paths;
}

function renderDraft(config: ProjectConfig, migratedSources: string[]): string {
  const lines: string[] = [
    "# DRAFT generated by `haversack init` — review every line before relying on it.",
    "# Existing AI config files were migrated (sources listed below); nothing was overwritten.",
    `# Migrated from: ${migratedSources.length > 0 ? migratedSources.join(", ") : "(none found)"}`,
    "",
    `haversack: ${specVersionOf(config)}`,
    `project: ${config.project}`,
    "description: TODO — one line describing this project",
    "",
    // Empty lists must be explicit — a bare `key:` with only comments parses
    // as null and would make the draft fail its own schema validation.
    ...(config.context.length > 0
      ? ["context:", ...config.context.map((p) => `  - ${p}`)]
      : ["# no context files found yet — add yours, e.g. context/architecture.md", "context: []"]),
    "",
    ...(config.rules.length > 0
      ? ["rules:", ...config.rules.map((p) => `  - ${p}`)]
      : ["# no rules files found yet — add yours, e.g. rules/coding.md", "rules: []"]),
    "",
    "targets:",
    "  - claude-code",
    "  # cursor and copilot adapters are not implemented yet — they are added as targets when they ship",
    "",
    "# no checks yet — start with static checks, e.g.:",
    "# - id: no-console-log-in-src",
    "#   type: static",
    "#   severity: warn",
    "#   path: [src/**]",
    "#   pattern: 'console\\.log\\('",
    "#   message: console.log left in production code.",
    "checks: []",
    "",
    "model_policy:",
    "  pin: true",
    "",
  ];
  return `${lines.join("\n")}`;
}
