import type { CheckedFile, CheckFinding, CheckResult } from "./types.js";
import { matchesPath } from "./glob.js";
import type { StaticCheck } from "../schema/project.js";

/**
 * Runs the deterministic checks (F2.1). Pure: no fs, no git, no network —
 * callers (CLI, GitHub App) supply the file list and the changed-line scope.
 *
 * Semantics (D2, D13): each check applies to files matching its `path` globs
 * and not matching `exclude` (exclude wins). When a file carries
 * `changedLines`, only those lines are evaluated; otherwise every line is.
 * A check with no files in scope is `skipped` (no_matching_files) — a scope
 * that never matched anything must not report a vacuous pass.
 */
export function runStaticChecks(checks: StaticCheck[], files: CheckedFile[]): CheckResult[] {
  return checks.map((check) => runStaticCheck(check, files));
}

function runStaticCheck(check: StaticCheck, files: CheckedFile[]): CheckResult {
  const includes = Array.isArray(check.path) ? check.path : [check.path];
  const scoped = files.filter((file) => matchesPath(file.path, includes, check.exclude));

  if (scoped.length === 0) {
    return {
      checkId: check.id,
      status: "skipped",
      severity: check.severity,
      findings: [],
      skippedReason: "no_matching_files",
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(check.pattern, check.flags.join(""));
  } catch {
    // The parser validates patterns; this is defense in depth. Never a pass.
    return {
      checkId: check.id,
      status: "skipped",
      severity: check.severity,
      findings: [],
      skippedReason: "invalid_pattern",
    };
  }

  const findings: CheckFinding[] = [];
  for (const file of scoped) {
    const lines = file.content.split("\n");
    const targets = file.changedLines ?? lines.map((_, index) => index + 1);
    for (const lineNumber of targets) {
      const line = lines[lineNumber - 1];
      if (line === undefined) continue;
      if (regex.test(line)) {
        findings.push({
          checkId: check.id,
          severity: check.severity,
          file: file.path,
          line: lineNumber,
          message: check.message,
          fix: check.fix,
        });
      }
    }
  }

  return {
    checkId: check.id,
    status: findings.length > 0 ? "fail" : "pass",
    severity: check.severity,
    findings,
  };
}
