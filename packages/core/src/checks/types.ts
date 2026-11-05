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
  | "llm_unavailable";

export interface CheckFinding {
  checkId: string;
  severity: "block" | "warn" | "info";
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line number in the diffed file. */
  line: number;
  message: string;
  fix?: string;
}
