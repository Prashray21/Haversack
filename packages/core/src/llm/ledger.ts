import { readFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { stableStringify } from "../drift/manifest.js";
import { writeTextFileAtomic } from "../parse/write.js";

/**
 * Local budget ledger (D4). One machine-local file per repo — spend is
 * tracked per calendar month (UTC) in integer cents so float drift can never
 * skew a budget decision. The GitHub App keeps the authoritative server-side
 * ledger; this file bounds `haversack check` spend on one machine.
 *
 * Not committed: each machine tracks its own spend (the file is gitignored).
 * A ledger from the Project Runtime era (.runtime/budget.json) is read and
 * migrated verbatim on the next spend (ADR 002 §3.7).
 */
export const BUDGET_REL_PATH = ".haversack/budget.json";

/** Legacy ledger location (Project Runtime era) — removed after migration. */
export const LEGACY_BUDGET_REL_PATH = ".runtime/budget.json";

export interface MonthSpend {
  inputTokens: number;
  outputTokens: number;
  /** Integer cents (D4: USD with 2 decimals). */
  usdCents: number;
}

export interface BudgetLedger {
  project: string;
  months: Record<string, MonthSpend>;
}

/** Current UTC calendar month, e.g. "2026-11" (D4). */
export function currentMonthUtc(now: () => Date = () => new Date()): string {
  return now().toISOString().slice(0, 7);
}

function parseLedger(raw: string): BudgetLedger | undefined {
  try {
    const parsed = JSON.parse(raw) as BudgetLedger;
    if (parsed && typeof parsed === "object" && typeof parsed.project === "string" && parsed.months && typeof parsed.months === "object") {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function readLedger(repoRoot: string): Promise<BudgetLedger | undefined> {
  try {
    return parseLedger(await readFile(path.join(repoRoot, BUDGET_REL_PATH), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined; // unreadable = no spend recorded yet
  }
  // Legacy location (ADR 002 §3.7): same shape, read as-is.
  try {
    return parseLedger(await readFile(path.join(repoRoot, LEGACY_BUDGET_REL_PATH), "utf8"));
  } catch {
    return undefined; // missing or unreadable ledger = no spend recorded yet
  }
}

/** Adds spend to the current month and returns the month's total cents. */
export async function recordSpend(
  repoRoot: string,
  options: { project: string; month: string; inputTokens: number; outputTokens: number; usdCents: number },
): Promise<number> {
  const ledger = (await readLedger(repoRoot)) ?? { project: options.project, months: {} };
  if (ledger.project !== options.project) {
    // Different project on the same checkout: start a fresh ledger.
    ledger.project = options.project;
    ledger.months = {};
  }
  const month = ledger.months[options.month] ?? { inputTokens: 0, outputTokens: 0, usdCents: 0 };
  month.inputTokens += options.inputTokens;
  month.outputTokens += options.outputTokens;
  month.usdCents += options.usdCents;
  ledger.months[options.month] = month;

  await writeTextFileAtomic(repoRoot, BUDGET_REL_PATH, stableStringify(ledger));
  // Migration (ADR 002 §3.7): the legacy file is obsolete once the new one exists.
  try {
    await rm(path.join(repoRoot, LEGACY_BUDGET_REL_PATH), { force: true });
    // Remove the legacy dir when empty (the manifest may already have migrated).
    await rmdir(path.join(repoRoot, path.dirname(LEGACY_BUDGET_REL_PATH)));
  } catch {
    // best-effort; a non-empty leftover (other files) is left untouched
  }
  return month.usdCents;
}
