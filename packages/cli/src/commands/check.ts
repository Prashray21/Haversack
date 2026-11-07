import { execFileSync } from "node:child_process";
import {
  CHECK_MAX_FILE_BYTES,
  CHECK_TIME_BUDGET_MS,
  LoadError,
  compileIgnorePatterns,
  currentMonthUtc,
  fetchTransport,
  hashCheckBody,
  loadProject,
  matchesPath,
  readLedger,
  readRepoTextFile,
  recordSpend,
  runJudge,
  runStaticChecks,
  scanFiles,
  specVersionOf,
  type BudgetLedger,
  type CheckedFile,
  type CheckResult,
  type DiffFile,
  type FileSecretFinding,
  type LlmCheck,
  type LlmTransport,
  type ProjectConfig,
} from "@haversackhq/core";

export interface CheckOptions {
  cwd: string;
  /** Evaluate only the added lines of `git diff <base>` (D2 semantics). */
  base?: string;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Injectable for tests; defaults to the real fetch transport. */
  llmTransport?: LlmTransport;
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
  banner(`project: ${config.project} (spec version ${specVersionOf(config)})`);
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
      if (text.content.includes("\0")) {
        // Binary content: regex rules are meaningless on it and can match
        // garbage. Skip it — never evaluated, never silently scanned.
        stderr(`⚠ skipped ${relPath} — binary file (NUL byte)`);
        continue;
      }
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

  const results: CheckResult[] = runStaticChecks(staticChecks, files, {
    timeBudgetMs: CHECK_TIME_BUDGET_MS,
  });
  results.push(...(await runLlmChecks(llmChecks, { config, cwd: options.cwd, base: options.base, changedLines, transport: options.llmTransport ?? fetchTransport() })));

  if (options.json) {
    stdout(JSON.stringify({ project: config.project, mode, results, secrets }, null, 2));
  } else {
    renderHuman(results, secrets, mode, stdout, stderr);
  }
  if (secrets.length > 0) return 3;
  if (results.some((result) => result.status === "fail" && result.severity === "block")) return 1;
  return 0;
}

/* ── LLM-judged checks (F2.2, F2.6, D4) ─────────────────────── */

interface LlmRunContext {
  config: ProjectConfig;
  cwd: string;
  base: string | undefined;
  changedLines: Map<string, number[]> | undefined;
  transport: LlmTransport;
}

/**
 * LLM-judged checks run ONLY on a diff (`--base`): F2.6 requires changed
 * files, and whole-file mode has no diff to judge. Each check runs only on
 * changed files matching its `paths`. Every gate that fails yields `skipped`
 * with a reason — never a pass (D13).
 */
async function runLlmChecks(checks: LlmCheck[], context: LlmRunContext): Promise<CheckResult[]> {
  const { config, cwd, base, changedLines } = context;
  const results: CheckResult[] = [];

  for (const check of checks) {
    const bodySha256 = hashCheckBody(check);

    if (base === undefined || changedLines === undefined) {
      results.push({
        checkId: check.id,
        status: "skipped",
        severity: check.severity,
        findings: [],
        skippedReason: "llm_unavailable",
        detail: "llm checks evaluate a diff — re-run with `haversack check --base <ref>` (F2.6 cost control: changed files only)",
        bodySha256,
      });
      continue;
    }

    // Scope: changed files matching the check's paths, with their added lines.
    const diffFiles: DiffFile[] = [];
    for (const [filePath, lines] of changedLines) {
      const includes = check.paths;
      if (!matchesPath(filePath, includes, [])) continue;
      const content = await readDiffFileContent(cwd, filePath);
      if (content === undefined) continue;
      const allLines = content.split("\n");
      diffFiles.push({
        path: filePath,
        addedLines: lines
          .filter((line) => line >= 1 && line <= allLines.length)
          .map((line) => ({ line, text: allLines[line - 1] ?? "" })),
      });
    }
    if (diffFiles.length === 0) {
      results.push({
        checkId: check.id,
        status: "skipped",
        severity: check.severity,
        findings: [],
        skippedReason: "no_matching_files",
        detail: "no changed files match this check's paths",
        bodySha256,
      });
      continue;
    }

    // Configuration gates — every one yields a specific skipped reason.
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      results.push(skippedLlm(check, bodySha256, "OPENAI_API_KEY is not set (the key comes from the environment only)"));
      continue;
    }
    const model = config.model_policy.model;
    if (model === undefined) {
      results.push(skippedLlm(check, bodySha256, "model_policy.model is not set in project.yaml"));
      continue;
    }
    const prices = config.model_policy.budget;
    if (prices?.usd_per_1m_input === undefined || prices?.usd_per_1m_output === undefined) {
      results.push(skippedLlm(check, bodySha256, "model_policy.budget.usd_per_1m_input / usd_per_1m_output are not set — without prices there is no budget accounting (D4)"));
      continue;
    }

    // Budget: remaining month spend from the machine-local ledger (D4).
    const month = currentMonthUtc();
    const ledger: BudgetLedger | undefined = await readLedger(cwd);
    const monthSpend = ledger?.months[month];
    const usdPerMonthCents = prices.usd_per_month !== undefined ? Math.round(prices.usd_per_month * 100) : undefined;
    const remainingMonthCents =
      monthSpend !== undefined && usdPerMonthCents !== undefined ? usdPerMonthCents - monthSpend.usdCents : 1;

    const outcome = await runJudge(check, diffFiles, {
      transport: context.transport,
      config: { model, apiKey },
      budget: {
        remainingMonthCents,
        usdPerRunCents: prices.usd_per_run !== undefined ? Math.round(prices.usd_per_run * 100) : undefined,
      },
      prices: { usdPer1mInput: prices.usd_per_1m_input, usdPer1mOutput: prices.usd_per_1m_output },
    });

    // Record actual spend (even for skipped-by-cap outcomes: it was consumed).
    if (outcome.usage.inputTokens > 0 || outcome.usage.outputTokens > 0) {
      await recordSpend(cwd, {
        project: config.project,
        month,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        usdCents: outcome.usage.usdCents,
      });
    }

    if (outcome.status === "skipped") {
      results.push({
        checkId: check.id,
        status: "skipped",
        severity: check.severity,
        findings: [],
        skippedReason: outcome.skippedReason,
        detail: outcome.detail,
        bodySha256,
        usage: {
          model: outcome.usage.model,
          inputTokens: outcome.usage.inputTokens,
          outputTokens: outcome.usage.outputTokens,
          usd: outcome.usage.usdCents / 100,
        },
      });
      continue;
    }

    results.push({
      checkId: check.id,
      status: outcome.status,
      severity: check.severity,
      findings: outcome.findings,
      bodySha256,
      usage: {
        model: outcome.usage.model,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        usd: outcome.usage.usdCents / 100,
      },
    });
  }

  return results;
}

function skippedLlm(check: LlmCheck, bodySha256: string, detail: string): CheckResult {
  return {
    checkId: check.id,
    status: "skipped",
    severity: check.severity,
    findings: [],
    skippedReason: "llm_unavailable",
    detail,
    bodySha256,
  };
}

/** Reads the current on-disk content of a changed file (added lines are indexed into it). */
async function readDiffFileContent(cwd: string, relPath: string): Promise<string | undefined> {
  try {
    const text = await readRepoTextFile(cwd, relPath, CHECK_MAX_FILE_BYTES);
    return text.content;
  } catch {
    return undefined; // deleted or unreadable files have no added lines to show
  }
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
    const usageSuffix = result.usage
      ? ` · ${result.usage.model} ${result.usage.inputTokens}+${result.usage.outputTokens} tok` +
        (result.usage.usd !== undefined ? ` $${result.usage.usd.toFixed(4)}` : "")
      : "";
    if (result.status === "skipped") {
      stdout(`${ICON.skipped} ${label} — skipped (${result.detail ?? describeSkipped(result)})${usageSuffix}`);
      continue;
    }
    if (result.status === "fail") {
      stdout(`${ICON.fail} ${label} — ${result.findings.length} finding(s)${usageSuffix}`);
      for (const finding of result.findings) {
        stdout(`    ${finding.file}:${finding.line} — ${finding.message}`);
        if (finding.fix) stdout(`      fix: ${finding.fix}`);
      }
    } else {
      stdout(`${ICON.pass} ${label} — no findings${usageSuffix}`);
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
      "  if it is not a real secret: secrets.ignore in project.yaml, or a `haversack:allow-secret` line marker (the legacy `runtime:` marker is honored too)",
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
    case "time_budget_exceeded":
      return "check exceeded its time budget (a pattern may be catastrophically slow) — skipped, never a pass";
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
    // `--show-cdup` prints "" exactly when cwd is the repo root — immune to
    // 8.3 short paths, case, and slash-direction differences (Windows CI).
    const cdup = git(cwd, ["rev-parse", "--show-cdup"]).trim();
    if (cdup !== "") {
      throw new CheckUsageError("haversack check must run from the repository root");
    }
    out = git(cwd, ["ls-files", "-z"]);
  } catch (error) {
    if (error instanceof CheckUsageError) throw error;
    throw new CheckUsageError("haversack check needs a git repository (it scans tracked files)");
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
