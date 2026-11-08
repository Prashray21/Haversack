import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildMcpItem, buildSkillItem } from "../src/library/item.js";
import { planMcpInstall, planSkillInstall, claudeCodePaths } from "../src/install/claude-code.js";

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `haversack-plan-${prefix}-`));
  tempRoots.push(dir);
  return dir;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const BENIGN = "---\ndescription: Deploy to staging\n---\nRun the deploy steps.\n";

function makeSkillItem() {
  return buildSkillItem({
    name: "deploy-staging",
    files: [
      { path: "SKILL.md", text: BENIGN },
      { path: "docs/reference.md", text: "reference text" },
    ],
  });
}

function makeHome(): { home: string; project: string } {
  const home = makeTemp("home");
  const project = makeTemp("proj");
  return { home, project };
}

describe("install planner + claude-code adapter (P2.3)", () => {
  it("plans a skill into <home>/.claude/skills/<name> with exact before/after per file; unchanged files are excluded", async () => {
    const { home } = makeHome();
    const paths = claudeCodePaths({ home });
    // Pre-existing file: SKILL.md already on disk with DIFFERENT content.
    const existingDir = path.join(home, ".claude", "skills", "deploy-staging");
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(path.join(existingDir, "SKILL.md"), "OLD CONTENT", "utf8");

    const step = await planSkillInstall(makeSkillItem(), "user", paths);
    expect(step.kind).toBe("skill");
    expect(step.action).toBe("update"); // something already exists
    expect(step.targetRoot).toBe(path.join(home, ".claude", "skills"));
    const writes = step.writes;
    expect(writes.map((w) => w.relPath).sort()).toEqual(["SKILL.md", "docs/reference.md"]);
    const skillMd = writes.find((w) => w.relPath === "SKILL.md");
    expect(skillMd?.before).toEqual({ sha256: sha256("OLD CONTENT") });
    expect(skillMd?.afterSha256).toBe(sha256(BENIGN));
    const ref = writes.find((w) => w.relPath === "docs/reference.md");
    expect(ref?.before).toBe("absent");
  });

  it("a skill whose files are all already identical yields a step with no writes", async () => {
    const { home } = makeHome();
    const paths = claudeCodePaths({ home });
    const existingDir = path.join(home, ".claude", "skills", "deploy-staging");
    mkdirSync(path.join(existingDir, "docs"), { recursive: true });
    writeFileSync(path.join(existingDir, "SKILL.md"), BENIGN, "utf8");
    writeFileSync(path.join(existingDir, "docs", "reference.md"), "reference text", "utf8");
    const step = await planSkillInstall(makeSkillItem(), "user", paths);
    expect(step.writes).toEqual([]);
  });

  it("plans a project-scope skill into <project>/.claude/skills", async () => {
    const { project } = makeHome();
    const paths = claudeCodePaths({ projectRoot: project, home: makeTemp("unused-home") });
    const step = await planSkillInstall(makeSkillItem(), "project", paths);
    expect(step.targetRoot).toBe(path.join(project, ".claude", "skills"));
    expect(step.writes.every((w) => w.absPath.startsWith(step.targetRoot))).toBe(true);
  });

  it("builds the exact `claude mcp add-json` argv; project scope expands placeholders, never inlines secrets", async () => {
    const { project } = makeHome();
    const paths = claudeCodePaths({ projectRoot: project, home: makeTemp("unused-home") });
    const item = buildMcpItem({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/gh-mcp"],
      env: { GITHUB_TOKEN: { placeholder: "TEAM_GITHUB_TOKEN" } },
    });
    const step = await planMcpInstall(item, "project", paths, {
      secretValues: { TEAM_GITHUB_TOKEN: "ghp_SECRET123" },
    });
    expect(step.cliArgv).toEqual([
      "claude",
      "mcp",
      "add-json",
      "github",
      JSON.stringify({
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/gh-mcp"],
        env: { GITHUB_TOKEN: "${TEAM_GITHUB_TOKEN}" },
      }),
      "--scope",
      "project",
    ]);
    expect(step.configPath).toBe(path.join(project, ".mcp.json"));
    expect(step.secretsInline).toBe(false);
    expect(step.cliArgv.join(" ")).not.toContain("ghp_SECRET123"); // literal never reaches project scope
    expect(step.prevState).toBe("absent");
  });

  it("user scope may inline supplied secret values into ~/.claude.json entry; missing values stay placeholders", async () => {
    const { home } = makeHome();
    const paths = claudeCodePaths({ home });
    const item = buildMcpItem({
      name: "github",
      transport: "stdio",
      command: "npx",
      env: { GITHUB_TOKEN: { placeholder: "TEAM_GITHUB_TOKEN" }, OTHER: { placeholder: "OTHER_VAR" } },
    });
    const step = await planMcpInstall(item, "user", paths, {
      secretValues: { TEAM_GITHUB_TOKEN: "ghp_SECRET123" },
    });
    const entry = JSON.parse(step.entryJson) as { env: Record<string, string> };
    expect(entry.env.GITHUB_TOKEN).toBe("ghp_SECRET123");
    expect(entry.env.OTHER).toBe("${OTHER_VAR}"); // no value supplied → placeholder expansion
    expect(step.secretsInline).toBe(true);
    expect(step.configPath).toBe(path.join(home, ".claude.json"));
    expect(step.cliArgv.at(-1)).toBe("user");
  });

  it("captures prevState from an existing config and refuses an unreadable one", async () => {
    const { home, project } = makeHome();
    const projectPaths = claudeCodePaths({ projectRoot: project, home });
    const existing = { mcpServers: { github: { type: "http", url: "https://old.example" } }, other: 1 };
    writeFileSync(path.join(project, ".mcp.json"), JSON.stringify(existing), "utf8");
    const item = buildMcpItem({ name: "github", transport: "http", url: "https://new.example" });
    const step = await planMcpInstall(item, "project", projectPaths);
    expect(step.prevState).toEqual({ entryJson: JSON.stringify({ type: "http", url: "https://old.example" }) });
    expect(step.action).toBe("update");

    const corruptPaths = claudeCodePaths({ home: makeTemp("corrupt") });
    writeFileSync(path.join(corruptPaths.home, ".claude.json"), "{ this is not json", "utf8");
    await expect(planMcpInstall(item, "user", corruptPaths)).rejects.toMatchObject({
      code: "config_unreadable",
    });
  });

  it("re-validates names at plan time — a tampered item cannot reach a reserved destination", async () => {
    const { home } = makeHome();
    const paths = claudeCodePaths({ home });
    const item = makeSkillItem();
    const tampered = { ...item, name: "synced" } as typeof item;
    await expect(planSkillInstall(tampered, "user", paths)).rejects.toMatchObject({
      code: "reserved_name",
    });
    const mcp = buildMcpItem({ name: "ok", transport: "http", url: "https://x.example" });
    const tamperedMcp = { ...mcp, name: "workspace" } as typeof mcp;
    await expect(planMcpInstall(tamperedMcp, "user", paths)).rejects.toMatchObject({
      code: "reserved_name",
    });
  });
});
