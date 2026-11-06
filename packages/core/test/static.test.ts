import { describe, expect, it } from "vitest";
import { runStaticChecks } from "../src/checks/static.js";
import type { CheckedFile } from "../src/checks/types.js";
import { projectConfigSchema } from "../src/schema/project.js";
import type { StaticCheck } from "../src/schema/project.js";

function staticCheck(overrides: Partial<StaticCheck> & { id: string }): StaticCheck {
  const base = {
    type: "static",
    severity: "warn",
    path: "**",
    exclude: [],
    flags: [],
    message: "matched",
  } as const;
  // Construct through the schema where possible; invalid patterns are tested
  // explicitly below (defense-in-depth path).
  return { ...base, ...overrides } as StaticCheck;
}

const CONSOLE_CHECK = staticCheck({
  id: "no-console-log",
  severity: "block",
  path: ["src/**"],
  exclude: ["**/*.test.ts"],
  pattern: "console\\.log\\(",
  flags: [],
  message: "console.log left in production code.",
  fix: "Remove it or use the project logger.",
});

function file(path: string, content: string, changedLines?: number[]): CheckedFile {
  return { path, content, changedLines };
}

describe("runStaticChecks", () => {
  it("fails with a finding when a line matches", () => {
    const [result] = runStaticChecks(
      [CONSOLE_CHECK],
      [file("src/app.ts", "const a = 1;\nconsole.log(a);\n")],
    );
    expect(result?.status).toBe("fail");
    expect(result?.severity).toBe("block");
    expect(result?.findings).toEqual([
      {
        checkId: "no-console-log",
        severity: "block",
        file: "src/app.ts",
        line: 2,
        message: "console.log left in production code.",
        fix: "Remove it or use the project logger.",
      },
    ]);
  });

  it("passes when nothing matches", () => {
    const [result] = runStaticChecks([CONSOLE_CHECK], [file("src/app.ts", "const a = 1;\n")]);
    expect(result?.status).toBe("pass");
    expect(result?.findings).toEqual([]);
  });

  it("honors regex flags", () => {
    const check = staticCheck({ id: "case-insensitive", pattern: "TODO", flags: ["i"], message: "todo" });
    const [result] = runStaticChecks([check], [file("src/a.ts", "// tOdO later\n")]);
    expect(result?.status).toBe("fail");
  });

  it("restricts evaluation to the path globs", () => {
    const [result] = runStaticChecks([CONSOLE_CHECK], [file("app/other.ts", "console.log(1);\n")]);
    expect(result).toMatchObject({ status: "skipped", skippedReason: "no_matching_files" });
  });

  it("exclude wins over include (skip, never a vacuous pass)", () => {
    const [result] = runStaticChecks([CONSOLE_CHECK], [
      file("src/a.test.ts", "console.log(1);\n"),
    ]);
    expect(result).toMatchObject({ status: "skipped", skippedReason: "no_matching_files" });
  });

  it("changedLines: only added lines are evaluated (D2)", () => {
    const content = "clean\nconsole.log(old);\nclean\n";
    // whole-file mode: fails on the old violation
    const [whole] = runStaticChecks([CONSOLE_CHECK], [file("src/a.ts", content)]);
    expect(whole?.status).toBe("fail");

    // diff mode: only line 4 (newly added, clean) is in scope
    const [diff] = runStaticChecks([CONSOLE_CHECK], [file("src/a.ts", content, [4])]);
    expect(diff?.status).toBe("pass");

    // diff mode: a violation on the added line is caught
    const [diffFail] = runStaticChecks([CONSOLE_CHECK], [
      file("src/a.ts", "clean\nconsole.log(old);\nclean\nconsole.log(new);\n", [4]),
    ]);
    expect(diffFail?.status).toBe("fail");
    expect(diffFail?.findings[0]?.line).toBe(4);
  });

  it("multiple checks are independent", () => {
    const todo = staticCheck({ id: "no-todo", severity: "warn", pattern: "TODO", message: "todo" });
    const results = runStaticChecks([CONSOLE_CHECK, todo], [
      file("src/a.ts", "console.log(1);\n// TODO\n"),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: "fail", checkId: "no-console-log" });
    expect(results[1]).toMatchObject({ status: "fail", checkId: "no-todo", severity: "warn" });
  });

  it("a check that exceeds its cooperative time budget is skipped, never a pass (M3)", () => {
    // timeBudgetMs: 0 — the deadline has already passed when the first line is
    // evaluated, so the skip is deterministic regardless of machine speed.
    const [result] = runStaticChecks(
      [CONSOLE_CHECK],
      [file("src/app.ts", "console.log(a);\n".repeat(5000))],
      { timeBudgetMs: 0 },
    );
    expect(result?.status).toBe("skipped");
    expect(result?.skippedReason).toBe("time_budget_exceeded");
    expect(result?.findings).toEqual([]);
  });

  it("the time budget is off by default; long evaluations still complete", () => {
    const [result] = runStaticChecks(
      [CONSOLE_CHECK],
      [file("src/app.ts", "x\n".repeat(50_000) + "console.log(a);\n")],
    );
    expect(result?.status).toBe("fail");
    expect(result?.findings[0]?.line).toBe(50_001);
  });

  it("line anchors match per line", () => {
    const check = staticCheck({ id: "leading-space", pattern: "^ {4}", message: "indent" });
    const [result] = runStaticChecks([check], [file("src/a.ts", "ok\n    indented\n")]);
    expect(result?.status).toBe("fail");
    expect(result?.findings[0]?.line).toBe(2);
  });

  it("an uncompilable pattern is skipped, never a pass (defense in depth)", () => {
    const check = staticCheck({ id: "bad", pattern: "(", message: "m" });
    const [result] = runStaticChecks([check], [file("src/a.ts", "x\n")]);
    expect(result).toMatchObject({ status: "skipped", skippedReason: "invalid_pattern" });
  });

  it("round-trips a schema-parsed config check", () => {
    const config = projectConfigSchema.parse({
      runtime: 1,
      project: "demo",
      targets: ["claude-code"],
      checks: [
        {
          id: "no-service-role",
          type: "static",
          severity: "block",
          pattern: "service_role",
          flags: ["i"],
          message: "service role in client code",
        },
      ],
    });
    const [result] = runStaticChecks(
      config.checks.filter((c): c is StaticCheck => c.type === "static"),
      [file("src/db.ts", "const k = SERVICE_ROLE;\n")],
    );
    expect(result?.status).toBe("fail");
    expect(result?.severity).toBe("block");
  });
});
