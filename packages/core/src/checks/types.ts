import type { Severity } from "../schema/project.js";

/**
 * Check result contract (F2, D4). Enforced by the check engine — the CLI
 * `check` command and the GitHub App. A `skipped` result NEVER counts as a
 * pass: it renders as neutral on GitHub with an explanatory annotation.
 */
export type CheckStatus = "pass" | "fail" | "skipped";

export type SkippedReason =
  /** model_policy.budget exhausted (D4) */
  | "budget_exhausted"
  /** nothing in scope to evaluate */
  | "no_matching_files"
  /** the judge could not run (configuration or network) */
  | "llm_unavailable"
  /** the check body failed to compile (schema-validated, defensive) */
  | "invalid_pattern"
  /** the check exceeded its cooperative time budget (possible catastrophic pattern) */
  | "time_budget_exceeded";

export interface CheckFinding {
  checkId: string;
  severity: Severity;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line number in the diffed file. */
  line: number;
  message: string;
  fix?: string;
}

/** Token/cost accounting for one judge-backed check (D4, §11). */
export interface CheckUsage {
  /** The model that actually served the judge call, as recorded by the provider. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** USD cost computed from the configured prices; undefined when prices are unset. */
  usd: number | undefined;
}

/** One evaluation outcome for one check. */
export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  severity: Severity;
  findings: CheckFinding[];
  skippedReason?: SkippedReason;
  /** Human-readable detail for skipped results (why, exactly). */
  detail?: string;
  /** sha256 over the canonical check body — recorded in every run result (F2.2). */
  bodySha256?: string;
  /** Token/cost accounting; present only when the judge ran. */
  usage?: CheckUsage;
}

/**
 * A file in scope for checking. Content is LF-normalized. When
 * `changedLines` is provided, only those 1-based lines are evaluated (D2:
 * static checks match added diff lines); when omitted, every line is
 * checked (local whole-file mode).
 */
export interface CheckedFile {
  path: string;
  content: string;
  changedLines?: number[];
}
