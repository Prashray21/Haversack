import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUDGET_REL_PATH,
  LEGACY_BUDGET_REL_PATH,
  currentMonthUtc,
  readLedger,
  recordSpend,
} from "../src/llm/ledger.js";

const dirs: string[] = [];
async function makeRepo(): Promise<string> {
  const dir = path.join(tmpdir(), `haversack-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("budget ledger migration (ADR 002)", () => {
  it("reads a legacy .runtime/budget.json and migrates it verbatim on the next spend", async () => {
    const dir = await makeRepo();
    const legacy = { project: "demo", months: { "2026-10": { inputTokens: 10, outputTokens: 5, usdCents: 7 } } };
    await mkdir(path.dirname(path.join(dir, LEGACY_BUDGET_REL_PATH)), { recursive: true });
    await writeFile(path.join(dir, LEGACY_BUDGET_REL_PATH), JSON.stringify(legacy));

    const read = await readLedger(dir);
    expect(read?.months["2026-10"]?.usdCents).toBe(7);

    await recordSpend(dir, {
      project: "demo",
      month: currentMonthUtc(),
      inputTokens: 1,
      outputTokens: 1,
      usdCents: 2,
    });

    const migrated = JSON.parse(await readFile(path.join(dir, BUDGET_REL_PATH), "utf8"));
    expect(migrated.project).toBe("demo");
    expect(migrated.months["2026-10"]?.usdCents).toBe(7);
    await expect(readFile(path.join(dir, LEGACY_BUDGET_REL_PATH), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes the new .haversack path when no legacy ledger exists", async () => {
    const dir = await makeRepo();
    await recordSpend(dir, { project: "p", month: "2026-11", inputTokens: 0, outputTokens: 0, usdCents: 1 });
    const raw = JSON.parse(await readFile(path.join(dir, BUDGET_REL_PATH), "utf8"));
    expect(raw.project).toBe("p");
    await expect(readFile(path.join(dir, LEGACY_BUDGET_REL_PATH), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
