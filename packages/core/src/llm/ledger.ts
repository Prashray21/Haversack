import { readFile } from "node:fs/promises";
import path from "node:path";
import { stableStringify } from "../drift/manifest.js";
import { writeTextFileAtomic } from "../parse/write.js";

/**
 * Local budget ledger (D4). One machine-local file per repo — spend is
 * tracked per calendar month (UTC) in integer cents so float drift can never
 * skew a budget decision. The GitHub App keeps the authoritative server-side
 * ledger; this file bounds `runtime check` spend on one machine.
 *
 * Not committed: each machine tracks its own spend (the file is gitignored).
 */
export const BUDGET_REL_PATH = ".runtime/budget.json";

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

export async function readLedger(repoRoot: string): Promise<BudgetLedger | undefined> {
  try {
    const raw = await readFile(path.join(repoRoot, BUDGET_REL_PATH), "utf8");
    const parsed = JSON.parse(raw) as BudgetLedger;
    if (parsed && typeof parsed === "object" && typeof parsed.project === "string" && parsed.months && typeof parsed.months === "object") {
      return parsed;
    }
    return undefined;
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

  const abs = path.join(repoRoot, BUDGET_REL_PATH);
  await writeTextFileAtomic(repoRoot, path.relative(repoRoot, abs), stableStringify(ledger));
  return month.usdCents;
}
