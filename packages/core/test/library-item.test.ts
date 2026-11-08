import { describe, expect, it } from "vitest";
import { buildMcpItem, buildSkillItem, LibraryItemError } from "../src/library/item.js";

function skillFiles(...entries: Array<[string, string]>) {
  return entries.map(([path, text]) => ({ path, text }));
}

describe("library items (P2.1)", () => {
  it("builds a skill item: hashes each file and a stable content hash that ignores file order", () => {
    const a = buildSkillItem({
      name: "deploy-staging",
      files: skillFiles(
        ["SKILL.md", "---\ndescription: Deploy to staging\n---\nRun the deploy."],
        ["scripts/run.sh", "echo hi"],
      ),
    });
    const b = buildSkillItem({
      name: "deploy-staging",
      files: skillFiles(
        ["scripts/run.sh", "echo hi"],
        ["SKILL.md", "---\ndescription: Deploy to staging\n---\nRun the deploy."],
      ),
    });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const sorted = (item: typeof a) => item.files.map((f) => [f.path, f.sha256] as const).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    expect(sorted(a)).toEqual(sorted(b));

    const changed = buildSkillItem({
      name: "deploy-staging",
      files: skillFiles(
        ["SKILL.md", "---\ndescription: Deploy to staging\n---\nRun the deploy NOW."],
        ["scripts/run.sh", "echo hi"],
      ),
    });
    expect(changed.contentHash).not.toBe(a.contentHash);
  });

  it("rejects a reserved skill name (synced / anthropic-skills) in any capitalization", () => {
    for (const name of ["synced", "Synced", "SYNCED", "anthropic-skills", "Anthropic-Skills"]) {
      expect(() => buildSkillItem({ name, files: skillFiles(["SKILL.md", "x"]) })).toThrowError(
        LibraryItemError,
      );
      try {
        buildSkillItem({ name, files: skillFiles(["SKILL.md", "x"]) });
      } catch (error) {
        expect((error as LibraryItemError).code).toBe("reserved_name");
      }
    }
  });

  it("rejects a skill name with disallowed characters: '<', zero-width space, leading space, empty", () => {
    for (const name of ["a<b", "de\u200bploy", " deploy", "", "deploy ", "a:b"]) {
      expect(() => buildSkillItem({ name, files: skillFiles(["SKILL.md", "x"]) })).toThrowError(
        LibraryItemError,
      );
      try {
        buildSkillItem({ name, files: skillFiles(["SKILL.md", "x"]) });
      } catch (error) {
        expect((error as LibraryItemError).code).toBe("invalid_name");
      }
    }
  });

  it("rejects a skill item without SKILL.md", () => {
    expect(() =>
      buildSkillItem({ name: "ok-name", files: skillFiles(["README.md", "x"]) }),
    ).toThrowError(LibraryItemError);
    try {
      buildSkillItem({ name: "ok-name", files: skillFiles(["README.md", "x"]) });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("missing_skill_md");
    }
  });

  it("rejects unsafe skill file paths: absolute, traversal, backslash, NUL, empty segment, duplicate", () => {
    const cases: Array<[string, string]> = [
      ["/etc/passwd", "x"],
      ["C:\\Windows\\evil", "x"],
      ["../escape.md", "x"],
      ["a/../../escape.md", "x"],
      ["dir\\file.md", "x"],
      ["bad\u0000name.md", "x"],
      ["a//b.md", "x"],
      ["dir/", "x"],
    ];
    for (const [path, text] of cases) {
      expect(() =>
        buildSkillItem({ name: "ok-name", files: skillFiles(["SKILL.md", "x"], [path, text]) }),
      ).toThrowError(LibraryItemError);
      try {
        buildSkillItem({ name: "ok-name", files: skillFiles(["SKILL.md", "x"], [path, text]) });
      } catch (error) {
        expect((error as LibraryItemError).code).toBe("invalid_path");
      }
    }
    expect(() =>
      buildSkillItem({
        name: "ok-name",
        files: skillFiles(["SKILL.md", "x"], ["SKILL.md", "y"]),
      }),
    ).toThrowError(LibraryItemError);
    try {
      buildSkillItem({ name: "ok-name", files: skillFiles(["SKILL.md", "x"], ["SKILL.md", "y"]) });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("duplicate_path");
    }
  });

  it("builds an mcp item with placeholder-only env and a stable hash; changing a placeholder changes the hash", () => {
    const a = buildMcpItem({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/gh-mcp"],
      env: { GITHUB_TOKEN: { placeholder: "TEAM_GITHUB_TOKEN" } },
    });
    const b = buildMcpItem({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/gh-mcp"],
      env: { GITHUB_TOKEN: { placeholder: "TEAM_GITHUB_TOKEN" } },
    });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const different = buildMcpItem({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/gh-mcp"],
      env: { GITHUB_TOKEN: { placeholder: "OTHER_TOKEN" } },
    });
    expect(different.contentHash).not.toBe(a.contentHash);
  });

  it("rejects mcp env values that are literals (bare string, or extra keys beside placeholder)", () => {
    expect(() =>
      buildMcpItem({
        name: "github",
        transport: "stdio",
        command: "npx",
        env: { GITHUB_TOKEN: "ghp_realtoken123" } as never,
      }),
    ).toThrowError(LibraryItemError);
    try {
      buildMcpItem({
        name: "github",
        transport: "stdio",
        command: "npx",
        env: { GITHUB_TOKEN: "ghp_realtoken123" } as never,
      });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("invalid_env_value");
    }
    expect(() =>
      buildMcpItem({
        name: "github",
        transport: "stdio",
        command: "npx",
        env: { GITHUB_TOKEN: { placeholder: "X", value: "leak" } as never },
      }),
    ).toThrowError(LibraryItemError);
  });

  it("rejects an mcp name with invalid characters or a reserved name", () => {
    for (const name of ["has space", "a<b", "", "workspace", "computer-use", "claude-in-chrome"]) {
      expect(() => buildMcpItem({ name, transport: "http", url: "https://x.example" })).toThrowError(
        LibraryItemError,
      );
    }
    try {
      buildMcpItem({ name: "workspace", transport: "http", url: "https://x.example" });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("reserved_name");
    }
  });

  it("stdio requires command; http requires a valid http(s) URL", () => {
    expect(() => buildMcpItem({ name: "no-cmd", transport: "stdio" })).toThrowError(
      LibraryItemError,
    );
    try {
      buildMcpItem({ name: "no-cmd", transport: "stdio" });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("missing_command");
    }
    expect(() =>
      buildMcpItem({ name: "bad-url", transport: "http", url: "not a url" }),
    ).toThrowError(LibraryItemError);
    try {
      buildMcpItem({ name: "bad-url", transport: "http", url: "not a url" });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("invalid_url");
    }
    const ok = buildMcpItem({ name: "remote", transport: "http", url: "https://mcp.example.com" });
    expect(ok.url).toBe("https://mcp.example.com");
  });

  it("env and header keys must look like environment variable names", () => {
    expect(() =>
      buildMcpItem({
        name: "k",
        transport: "http",
        url: "https://x.example",
        headers: { "bad key": { placeholder: "V" } },
      }),
    ).toThrowError(LibraryItemError);
    try {
      buildMcpItem({
        name: "k",
        transport: "http",
        url: "https://x.example",
        headers: { "bad key": { placeholder: "V" } },
      });
    } catch (error) {
      expect((error as LibraryItemError).code).toBe("invalid_env_value");
    }
  });
});
