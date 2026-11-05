import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSync } from "../src/commands/sync.js";

// The checked-in example project doubles as a living fixture: if it stops
// parsing, this test fails.
const SAMPLE_DIR = path.resolve(import.meta.dirname, "../../../examples/sample-project");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    out,
    err,
  };
}

describe("runtime sync (config loader)", () => {
  it("prints a summary for the sample project and exits 0", async () => {
    const io = capture();
    const code = await runSync({
      cwd: SAMPLE_DIR,
      yes: true,
      verify: false,
      force: false,
      ...io,
    });

    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("project: acme-storefront (runtime spec 1)");
    expect(io.out.join("\n")).toContain("targets: claude-code, cursor, copilot");
    expect(io.out.join("\n")).toContain("3 (2 static, 1 llm)");
  });

  it("surfaces the integrations warning (D7)", async () => {
    const io = capture();
    await runSync({ cwd: SAMPLE_DIR, yes: true, verify: false, force: false, ...io });
    expect(io.out.join("\n")).toContain("integrations are validated but not enforced");
  });

  it("exits 2 with the position-mapped report on a bad config", async () => {
    const io = capture();
    const code = await runSync({
      cwd: path.resolve(import.meta.dirname, "./fixtures/bad-spec"),
      yes: true,
      verify: false,
      force: false,
      ...io,
    });

    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("spec version 2");
    expect(io.err.join("\n")).toContain("supports spec version 1");
  });

  it("exits 2 when there is no project.yaml", async () => {
    const io = capture();
    const code = await runSync({
      cwd: path.resolve(import.meta.dirname, "./fixtures/empty"),
      yes: true,
      verify: false,
      force: false,
      ...io,
    });

    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("project.yaml not found");
  });
});
