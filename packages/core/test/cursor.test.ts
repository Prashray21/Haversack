import { describe, expect, it } from "vitest";
import { cursorAdapter, CURSOR_MDC_PATH } from "../src/adapters/cursor.js";
import { copilotAdapter, COPILOT_INSTRUCTIONS_PATH } from "../src/adapters/copilot.js";
import { GENERATED_HEADER_MARKER } from "../src/constants.js";
import type { CompiledProject } from "../src/adapters/types.js";

const PROJECT: CompiledProject = {
  config: {
    runtime: 1,
    project: "demo",
    description: "A demo project.",
    context: ["context/product.md"],
    rules: ["rules/coding.md"],
    targets: ["cursor", "copilot"],
    integrations: {},
    checks: [],
    model_policy: { pin: true },
    secrets: { ignore: [] },
  },
  sources: [
    { path: "context/product.md", content: "The product sells widgets.\n", sha256: "x" },
    { path: "rules/coding.md", content: "Be terse.\n", sha256: "y" },
  ],
  definitionHash: "abc",
};

describe("cursor adapter", () => {
  it("generates exactly one file at .cursor/rules/runtime.mdc", () => {
    const files = cursorAdapter.generate(PROJECT);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(CURSOR_MDC_PATH);
  });

  it("frontmatter comes first; the generated header sits after the closing fence (D5)", () => {
    const content = cursorAdapter.generate(PROJECT)[0]?.content ?? "";
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("alwaysApply: true");
    const fenceEnd = content.indexOf("---\n\n");
    const headerPos = content.indexOf(GENERATED_HEADER_MARKER);
    const bodyPos = content.indexOf("# demo");
    expect(headerPos).toBeGreaterThan(fenceEnd); // header AFTER frontmatter
    expect(bodyPos).toBeGreaterThan(headerPos); // body after header
    expect(content).toContain("The product sells widgets.");
    expect(content).toContain("Be terse.");
  });

  it("deterministic bytes (D5)", () => {
    expect(cursorAdapter.generate(PROJECT)).toEqual(cursorAdapter.generate(PROJECT));
  });

  it("inlines sources in project.yaml order and normalizes nothing away", () => {
    const content = cursorAdapter.generate(PROJECT)[0]?.content ?? "";
    expect(content.indexOf("context/product.md")).toBeLessThan(content.indexOf("rules/coding.md"));
  });
});

describe("copilot adapter", () => {
  it("generates exactly one file at .github/copilot-instructions.md", () => {
    const files = copilotAdapter.generate(PROJECT);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(COPILOT_INSTRUCTIONS_PATH);
  });

  it("plain markdown: no frontmatter; header prepended before the body", () => {
    const content = copilotAdapter.generate(PROJECT)[0]?.content ?? "";
    expect(content.startsWith(`<!-- ${GENERATED_HEADER_MARKER}`)).toBe(true); // header first
    expect(content.indexOf(GENERATED_HEADER_MARKER)).toBeLessThan(content.indexOf("# demo"));
    expect(content).not.toMatch(/^---/); // no frontmatter documented for this file
    expect(content).toContain("The product sells widgets.");
    expect(content).toContain("Be terse.");
  });

  it("deterministic bytes (D5)", () => {
    expect(copilotAdapter.generate(PROJECT)).toEqual(copilotAdapter.generate(PROJECT));
  });
});
