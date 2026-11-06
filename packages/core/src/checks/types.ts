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

/** One evaluation outcome for one check. */
export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  severity: Severity;
  findings: CheckFinding[];
  skippedReason?: SkippedReason;
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
