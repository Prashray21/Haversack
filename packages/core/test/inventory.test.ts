import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inventoryClaudeCode } from "../src/inventory/claude-code.js";
import { AppliedItemsLedger } from "../src/install/apply.js";
import { buildMcpItem, buildSkillItem } from "../src/library/item.js";
import { planMcpInstall, planSkillInstall, claudeCodePaths } from "../src/install/claude-code.js";
import { applyPlan } from "../src/install/apply.js";

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `haversack-inv-${prefix}-`));
  tempRoots.push(dir);
  return dir;
}
const BENIGN = "---\ndescription: x\n---\nBody.\n";

describe("inventory (P3 support, read-only)", () => {
  it("lists skills and MCP servers for both scopes, marking ours via the ledger", async () => {
    const home = makeTemp("home");
    const paths = claudeCodePaths({ home });
    // A skill we install and a skill someone else created.
    const oursDir = path.join(home, ".claude", "skills", "deploy");
    mkdirSync(oursDir, { recursive: true });
    writeFileSync(path.join(oursDir, "SKILL.md"), "OLD", "utf8"); // pre-existing → a real update write
    const foreignDir = path.join(home, ".claude", "skills", "not-ours");
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(path.join(foreignDir, "SKILL.md"), BENIGN, "utf8");

    const dataDir = path.join(home, "app-data");
    mkdirSync(dataDir, { recursive: true });
    const ledger = new AppliedItemsLedger(path.join(dataDir, "applied-items.json"));
    const item = buildSkillItem({ name: "deploy", files: [{ path: "SKILL.md", text: BENIGN }] });
    const step = await planSkillInstall(item, "user", paths);
    await applyPlan([step], { ledger });

    const inventory = await inventoryClaudeCode(paths, { ledgerPath: path.join(dataDir, "applied-items.json") });
    const skills = inventory.skills.filter((entry) => entry.scope === "user");
    const ours = skills.find((entry) => entry.name === "deploy");
    const foreign = skills.find((entry) => entry.name === "not-ours");
    expect(ours).toMatchObject({ kind: "skill", ours: true, itemHash: item.contentHash });
    expect(foreign).toMatchObject({ kind: "skill", ours: false });
    // Foreign items still expose a content hash for display — identical content hashes identically.
    expect(foreign?.itemHash).toBe(item.contentHash);

    // An MCP entry in the user config, ours only after install.
    writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { manual: { type: "http", url: "https://x.example" } } }),
      "utf8",
    );
    const mcpItem = buildMcpItem({ name: "gh", transport: "stdio", command: "npx", args: ["-y", "p"] });
    const mcpStep = await planMcpInstall(mcpItem, "user", paths);
    const calls: string[][] = [];
    await applyPlan([mcpStep], {
      ledger,
      spawn: async (argv) => {
        calls.push(argv);
        // Simulate the CLI writing the entry (test double for `claude mcp add-json`).
        const configPath = path.join(home, ".claude.json");
        const parsed = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(configPath, "utf8")));
        parsed.mcpServers = parsed.mcpServers ?? {};
        parsed.mcpServers.gh = JSON.parse(argv[4] as string);
        writeFileSync(configPath, JSON.stringify(parsed), "utf8");
        return { stdout: "Added", stderr: "" };
      },
    });
    const after = await inventoryClaudeCode(paths, { ledgerPath: path.join(dataDir, "applied-items.json") });
    expect(after.mcp.find((entry) => entry.name === "manual")).toMatchObject({ ours: false });
    expect(after.mcp.find((entry) => entry.name === "gh")).toMatchObject({ ours: true, itemHash: mcpItem.contentHash });
  });

  it("reads project scope, tolerates a corrupt config as an error entry, and never follows symlinks", async () => {
    const home = makeTemp("home2");
    const project = makeTemp("proj");
    const paths = claudeCodePaths({ home, projectRoot: project });
    const projSkill = path.join(project, ".claude", "skills", "proj-skill");
    mkdirSync(projSkill, { recursive: true });
    writeFileSync(path.join(projSkill, "SKILL.md"), BENIGN, "utf8");

    const outside = makeTemp("outside");
    const secretFile = path.join(outside, "s.txt");
    writeFileSync(secretFile, "TOPSECRETVALUE");
    mkdirSync(path.join(home, ".claude", "skills"), { recursive: true }); // parent must exist for the link
    try {
      symlinkSync(outside, path.join(home, ".claude", "skills", "junk"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      // Unprivileged machines without link support: skip that assertion's setup.
      expect((error as NodeJS.ErrnoException).code).toBe("EPERM");
    }

    writeFileSync(path.join(project, ".mcp.json"), "{ not json", "utf8");
    const inventory = await inventoryClaudeCode(paths);
    expect(inventory.skills.find((entry) => entry.name === "proj-skill")).toMatchObject({
      scope: "project",
      ours: false,
    });
    expect(inventory.configErrors.length).toBe(1);
    expect(inventory.configErrors[0]).toContain(".mcp.json");
    // The symlink target was never read — nothing about its content can appear.
    expect(JSON.stringify(inventory)).not.toContain("TOPSECRETVALUE");
    const junk = inventory.skills.find((entry) => entry.name === "junk");
    if (junk !== undefined) expect(junk.symlink).toBe(true);
  });
});
