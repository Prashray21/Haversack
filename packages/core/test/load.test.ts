import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoadError, SpecVersionError, loadProject } from "../src/parse/load.js";
import { sha256Hex } from "../src/parse/files.js";

const GOOD_YAML = `runtime: 1
project: demo
targets: [claude-code]
context:
  - context/product.md
rules:
  - rules/coding.md
`;

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = path.join(tmpdir(), `runtime-load-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return dir;
}

let lastDir: string | undefined;
afterEach(async () => {
  if (lastDir) await rm(lastDir, { recursive: true, force: true });
  lastDir = undefined;
});

async function project(files: Record<string, string>): Promise<string> {
  lastDir = await makeProject(files);
  return lastDir;
}

describe("loadProject", () => {
  it("loads a valid project: config, normalized sources, stable definition hash", async () => {
    const dir = await project({
      "project.yaml": GOOD_YAML,
      "context/product.md": "\uFEFFHello\r\nWorld\r\n", // BOM + CRLF
      "rules/coding.md": "Rule one.\r\n",
    });

    const a = await loadProject({ cwd: dir });
    const b = await loadProject({ cwd: dir });

    expect(a.config.project).toBe("demo");
    expect(a.config.targets).toEqual(["claude-code"]);

    expect(a.sources).toHaveLength(2);
    expect(a.sources[0]?.content).toBe("Hello\nWorld\n"); // BOM stripped, CRLF → LF (D5)
    expect(a.sources[0]?.sha256).toBe(sha256Hex("Hello\nWorld\n"));

    expect(a.definitionHash).toBe(b.definitionHash); // deterministic
    expect(a.warnings).toEqual([]);
  });

  it("points at the exact line of a missing context file", async () => {
    const dir = await project({
      "project.yaml": `${GOOD_YAML}`,
      // context/product.md deliberately missing
      "rules/coding.md": "ok\n",
    });

    await expect(loadProject({ cwd: dir })).rejects.toThrow(LoadError);
    try {
      await loadProject({ cwd: dir });
    } catch (error) {
      const report = (error as LoadError).report;
      expect(report).toContain("context/product.md does not exist");
      expect(report).toContain("project.yaml:5"); // the `context:` list entry (line 5)
    }
  });

  it("reports duplicate check ids with both positions", async () => {
    const dir = await project({
      "project.yaml": `runtime: 1
project: demo
targets: [claude-code]
checks:
  - id: dup-rule
    type: static
    pattern: a
    message: m
  - id: dup-rule
    type: static
    pattern: b
    message: m
`,
    });

    try {
      await loadProject({ cwd: dir });
      expect.unreachable("expected LoadError");
    } catch (error) {
      expect(error).toBeInstanceOf(LoadError);
      const report = (error as LoadError).report;
      expect(report).toContain("duplicate check id 'dup-rule'");
      expect(report.match(/project\.yaml:\d+:\d+/g)).toHaveLength(2);
    }
  });

  it("rejects an unknown spec version with SpecVersionError", async () => {
    const dir = await project({
      "project.yaml": `runtime: 2
project: demo
targets: [claude-code]
`,
    });

    try {
      await loadProject({ cwd: dir });
      expect.unreachable("expected SpecVersionError");
    } catch (error) {
      expect(error).toBeInstanceOf(SpecVersionError);
      expect((error as SpecVersionError).report).toContain("spec version 2");
      expect((error as SpecVersionError).report).toContain("supports spec version 1");
    }
  });

  it("suggests did-you-mean for unknown top-level fields", async () => {
    const dir = await project({
      "project.yaml": `runtime: 1
project: demo
targets: [claude-code]
rulez: []
`,
    });

    try {
      await loadProject({ cwd: dir });
      expect.unreachable("expected LoadError");
    } catch (error) {
      expect((error as LoadError).report).toContain("did you mean 'rules'?");
    }
  });

  it("warns that integrations are inert in the MVP (D7)", async () => {
    const dir = await project({
      "project.yaml": `runtime: 1
project: demo
targets: [claude-code]
integrations:
  github: { scopes: [read] }
`,
    });

    const result = await loadProject({ cwd: dir });
    expect(result.warnings.some((w) => w.code === "integrations_inert")).toBe(true);
  });

  it("enforces the per-file size cap on source files", async () => {
    const big = "x".repeat(129 * 1024);
    const dir = await project({
      "project.yaml": GOOD_YAML,
      "context/product.md": big,
      "rules/coding.md": "ok\n",
    });

    try {
      await loadProject({ cwd: dir });
      expect.unreachable("expected LoadError");
    } catch (error) {
      expect((error as LoadError).report).toContain("per-file cap is 128 KB");
    }
  });

  it("fails clearly on an empty or non-mapping project.yaml", async () => {
    const empty = await project({ "project.yaml": "# only a comment\n" });
    await expect(loadProject({ cwd: empty })).rejects.toThrow(/YAML mapping/);

    const list = await project({ "project.yaml": "- a\n- b\n" });
    await expect(loadProject({ cwd: list })).rejects.toThrow(/YAML mapping/);
  });

  it("fails clearly on YAML syntax errors, with a line number", async () => {
    const dir = await project({
      "project.yaml": `runtime: 1
project: [unclosed
targets: [claude-code]
`,
    });

    try {
      await loadProject({ cwd: dir });
      expect.unreachable("expected LoadError");
    } catch (error) {
      const report = (error as LoadError).report;
      expect(report).toContain("YAML parse error");
      expect(report).toMatch(/project\.yaml:\d+:\d+/);
    }
  });
});
