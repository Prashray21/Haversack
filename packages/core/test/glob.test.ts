import { describe, expect, it } from "vitest";
import { compileGlobs, matchesPath, toPosixPath } from "../src/checks/glob.js";

describe("toPosixPath", () => {
  it("normalizes Windows separators before matching", () => {
    expect(toPosixPath("src\\lib\\a.ts")).toBe("src/lib/a.ts");
    expect(toPosixPath("src/lib/a.ts")).toBe("src/lib/a.ts");
  });
});

describe("compileGlobs", () => {
  it("matches repo-root-relative globs", () => {
    const isMatch = compileGlobs(["src/**"]);
    expect(isMatch("src/lib/a.ts")).toBe(true);
    expect(isMatch("src/a.ts")).toBe(true);
    expect(isMatch("app/a.ts")).toBe(false);
  });

  it("matches multiple include patterns", () => {
    const isMatch = compileGlobs(["src/**", "app/**"]);
    expect(isMatch("src/a.ts")).toBe(true);
    expect(isMatch("app/a.ts")).toBe(true);
    expect(isMatch("docs/a.md")).toBe(false);
  });

  it("matches dot-directories (dot: true)", () => {
    const isMatch = compileGlobs([".github/**"]);
    expect(isMatch(".github/workflows/ci.yml")).toBe(true);

    const everything = compileGlobs(["**"]);
    expect(everything(".github/workflows/ci.yml")).toBe(true);
    expect(everything(".hidden/file.txt")).toBe(true);
  });

  it("returns a predicate that rejects everything for an empty pattern list", () => {
    expect(compileGlobs([])("anything.ts")).toBe(false);
  });
});

describe("matchesPath (exclude-over-include precedence)", () => {
  const includes = ["src/**"];

  it("excludes win even when the path matches an include pattern", () => {
    expect(
      matchesPath("src/generated/x.ts", includes, ["src/generated/**"]),
    ).toBe(false);
    expect(matchesPath("src/handwritten/x.ts", includes, ["src/generated/**"])).toBe(true);
  });

  it("multiple excludes: any hit excludes", () => {
    expect(matchesPath("src/a.test.ts", includes, ["**/*.test.ts", "src/tmp/**"])).toBe(false);
    expect(matchesPath("src/a.spec.ts", includes, ["**/*.test.ts", "src/tmp/**"])).toBe(true);
  });

  it("a path matching no include pattern is excluded regardless", () => {
    expect(matchesPath("docs/x.md", includes, [])).toBe(false);
  });
});
