import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "../src/version.js";

describe("CLI_VERSION", () => {
  it("matches packages/cli/package.json (single source of truth, M9)", async () => {
    const pkgPath = path.resolve(import.meta.dirname, "../package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it("is valid semver (stable or prerelease)", () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
