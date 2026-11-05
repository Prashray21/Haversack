import { describe, expect, it } from "vitest";
import {
  attachGeneratedHeader,
  buildGeneratedHeader,
  hasGeneratedHeader,
  HTML_COMMENT,
} from "../src/adapters/header.js";
import { GENERATED_HEADER_MARKER } from "../src/constants.js";

describe("buildGeneratedHeader", () => {
  it("embeds the marker, adapter id and version", () => {
    const header = buildGeneratedHeader("claude-code", 1, HTML_COMMENT);
    expect(header).toContain(GENERATED_HEADER_MARKER);
    expect(header).toContain("adapter claude-code v1");
    expect(header).toContain("runtime spec 1");
    expect(header.startsWith("<!-- ")).toBe(true);
    expect(header.endsWith("-->")).toBe(true);
  });
});

describe("attachGeneratedHeader", () => {
  it("prepends by default", () => {
    const out = attachGeneratedHeader("# Body\n", {
      adapterId: "claude-code",
      adapterVersion: 1,
    });
    expect(out.startsWith(`<!-- ${GENERATED_HEADER_MARKER}`)).toBe(true);
    expect(out.endsWith("# Body\n")).toBe(true);
    expect(hasGeneratedHeader(out)).toBe(true);
  });

  it("places the header after frontmatter when requested (Cursor .mdc)", () => {
    const mdc = "---\ndescription: Team rules\nglobs:\nalwaysApply: true\n---\n\n# Rule body\n";
    const out = attachGeneratedHeader(mdc, {
      adapterId: "cursor",
      adapterVersion: 1,
      placement: "after-frontmatter",
    });

    expect(out.startsWith("---\ndescription: Team rules\nglobs:\nalwaysApply: true\n---\n")).toBe(
      true,
    );
    expect(out).toContain(GENERATED_HEADER_MARKER);
    // header must come after the closing fence and before the body
    expect(out.indexOf(GENERATED_HEADER_MARKER)).toBeGreaterThan(
      out.indexOf("alwaysApply: true"),
    );
    expect(out.indexOf(GENERATED_HEADER_MARKER)).toBeLessThan(out.indexOf("# Rule body"));
  });

  it("falls back to prepend when there is no frontmatter", () => {
    const out = attachGeneratedHeader("# Just markdown\n", {
      adapterId: "cursor",
      adapterVersion: 1,
      placement: "after-frontmatter",
    });
    expect(out.startsWith(`<!-- ${GENERATED_HEADER_MARKER}`)).toBe(true);
  });

  it("detects unheadered content", () => {
    expect(hasGeneratedHeader("# Human-written file\n")).toBe(false);
  });
});
