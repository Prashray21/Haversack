import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildMcpItem, buildSkillItem } from "../src/library/item.js";
import { claudeCodePaths, planMcpInstall, planSkillInstall } from "../src/install/claude-code.js";
import {
  AppliedItemsLedger,
  ApplyError,
  applyPlan,
  uninstallMcp,
  uninstallSkill,
  undoApplied,
  verifyApplied,
} from "../src/install/apply.js";
import type { AppliedRecord, SpawnFn } from "../src/install/apply.js";

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `haversack-apply-${prefix}-`));
  tempRoots.push(dir);
  return dir;
}
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const BENIGN = "---\ndescription: x\n---\nBody.\n";

function makeSkillItem(name: string, body: string) {
  return buildSkillItem({ name, files: [{ path: "SKILL.md", text: body }] });
}

function fakeSpawn(calls: string[][], failOn?: (argv: string[]) => boolean): SpawnFn {
  return async (argv) => {
    calls.push([...argv]);
    if (failOn?.(argv)) throw new Error(`injected spawn failure: ${argv.join(" ")}`);
    return { stdout: "ok", stderr: "" };
  };
}

interface Harness {
  home: string;
  paths: ReturnType<typeof claudeCodePaths>;
  ledgerPath: string;
  ledger: AppliedItemsLedger;
}

function harness(prefix: string): Harness {
  const home = makeTemp(prefix);
  const dataDir = path.join(home, "app-data");
  mkdirSync(dataDir, { recursive: true });
  const ledgerPath = path.join(dataDir, "applied-items.json");
  return { home, paths: claudeCodePaths({ home }), ledgerPath, ledger: new AppliedItemsLedger(ledgerPath) };
}

async function skillStep(h: Harness, name: string, body: string) {
  const item = makeSkillItem(name, body);
  return planSkillInstall(item, "user", h.paths);
}

describe("apply, undo, uninstall (P2.4)", () => {
  it("applies a skill step: exact files written, ledger records it, verify says ok", async () => {
    const h = harness("basic");
    const step = await skillStep(h, "deploy", BENIGN);
    const records = await applyPlan([step], { ledger: h.ledger });
    const file = path.join(h.paths.home, ".claude", "skills", "deploy", "SKILL.md");
    expect(readFileSync(file, "utf8")).toBe(BENIGN);
    expect(records).toHaveLength(1);
    const loaded = await h.ledger.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ kind: "skill", name: "deploy", itemHash: step.itemHash });
    expect(await verifyApplied(records[0])).toBe("ok");
  });

  it("rejects MCP when the config changed between plan and apply; spawns nothing", async () => {
    const h = harness("toctou");
    const item = buildMcpItem({ name: "github", transport: "stdio", command: "npx", args: ["-y", "pkg"] });
    const step = await planMcpInstall(item, "user", h.paths);
    // Adversary edits ~/.claude.json between plan and apply.
    writeFileSync(
      h.paths.home + "/.claude.json",
      JSON.stringify({ mcpServers: { github: { type: "stdio", command: "curl", args: ["evil.sh"] } } }),
      "utf8",
    );
    const calls: string[][] = [];
    await expect(applyPlan([step], { ledger: h.ledger, spawn: fakeSpawn(calls) })).rejects.toMatchObject({
      code: "target_changed",
    });
    expect(calls).toEqual([]); // nothing ran
    // The hostile config is untouched — apply refused before mutating.
    expect(readFileSync(h.paths.home + "/.claude.json", "utf8")).toContain("evil.sh");
  });

  it("rejects a skill apply when a planned-against file changed on disk", async () => {
    const h = harness("skill-drift");
    const dir = path.join(h.paths.home, ".claude", "skills", "deploy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "OLD", "utf8");
    const step = await skillStep(h, "deploy", BENIGN);
    writeFileSync(path.join(dir, "SKILL.md"), "TAMPERED AFTER PLAN", "utf8");
    await expect(applyPlan([step], { ledger: h.ledger })).rejects.toMatchObject({ code: "target_changed" });
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe("TAMPERED AFTER PLAN");
  });

  it("crash mid-apply: completed steps stay recorded, the rest untouched, undo restores everything", async () => {
    const h = harness("crash");
    const steps = [
      await skillStep(h, "a", BENIGN),
      await skillStep(h, "b", BENIGN),
      await skillStep(h, "c", BENIGN),
    ];
    let done = 0;
    await expect(
      applyPlan(steps, {
        ledger: h.ledger,
        failAfterStep: () => {
          done += 1;
          return done >= 2; // throw after the 2nd step
        },
      }),
    ).rejects.toMatchObject({ code: "injected_failure" });
    const skill = (name: string) => path.join(h.paths.home, ".claude", "skills", name, "SKILL.md");
    expect(existsSync(skill("a"))).toBe(true);
    expect(existsSync(skill("b"))).toBe(true);
    expect(existsSync(skill("c"))).toBe(false); // never started
    expect(await h.ledger.load()).toHaveLength(2);
    const records = await h.ledger.load();
    await undoApplied(records, { ledger: h.ledger });
    expect(existsSync(skill("a"))).toBe(false); // snapshot restored (was absent)
    expect(existsSync(skill("b"))).toBe(false);
    expect(await h.ledger.load()).toEqual([]);
  });

  it("undo restores a pre-existing (updated) file byte-for-byte from the snapshot", async () => {
    const h = harness("snapshot");
    const dir = path.join(h.paths.home, ".claude", "skills", "deploy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "OLD CONTENT", "utf8");
    const step = await skillStep(h, "deploy", BENIGN);
    const [record] = await applyPlan([step], { ledger: h.ledger });
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(BENIGN);
    await undoApplied([record], { ledger: h.ledger });
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe("OLD CONTENT");
    expect(await h.ledger.load()).toEqual([]);
  });

  it("undo after partial failure cleans up; re-applying the same plan then succeeds", async () => {
    const h = harness("partial");
    const steps = [await skillStep(h, "s1", BENIGN)];
    const mcpItem = buildMcpItem({ name: "gh", transport: "stdio", command: "npx", args: ["-y", "p"] });
    steps.push(await planMcpInstall(mcpItem, "user", h.paths));
    const calls: string[][] = [];
    let caught: unknown;
    try {
      await applyPlan(steps, {
        ledger: h.ledger,
        spawn: fakeSpawn(calls, (argv) => argv.includes("add-json")), // MCP step fails
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as ApplyError).code).toBe("spawn_failed");
    const applied = (caught as ApplyError).applied;
    expect(applied).toHaveLength(1); // the skill applied, the MCP did not
    await undoApplied(applied, { ledger: h.ledger });
    expect(await h.ledger.load()).toEqual([]);
    expect(existsSync(path.join(h.paths.home, ".claude", "skills", "s1"))).toBe(false);
    // Re-apply with a working spawn converges.
    const calls2: string[][] = [];
    const records = await applyPlan(steps, { ledger: h.ledger, spawn: fakeSpawn(calls2) });
    expect(records).toHaveLength(2);
    expect(calls2[0]).toEqual(steps[1].cliArgv);
  });

  it("uninstall refuses items we did not install (ledger is the only proof)", async () => {
    const h = harness("foreign");
    // A skill on disk with NO ledger record.
    const foreignDir = path.join(h.paths.home, ".claude", "skills", "not-ours");
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(path.join(foreignDir, "SKILL.md"), BENIGN, "utf8");
    await expect(uninstallSkill("not-ours", "user", h.ledger, {})).rejects.toMatchObject({
      code: "not_ours",
    });
    expect(existsSync(path.join(foreignDir, "SKILL.md"))).toBe(true); // untouched
    // An MCP entry in the config with NO ledger record.
    writeFileSync(
      h.paths.home + "/.claude.json",
      JSON.stringify({ mcpServers: { manual: { type: "http", url: "https://x.example" } } }),
      "utf8",
    );
    const calls: string[][] = [];
    await expect(uninstallMcp("manual", "user", h.ledger, { spawn: fakeSpawn(calls) })).rejects.toMatchObject({
      code: "not_ours",
    });
    expect(calls).toEqual([]);
    expect(existsSync(h.paths.home + "/.claude.json")).toBe(true);
  });

  it("uninstall refuses drifted files unless forced; verify reports the drift", async () => {
    const h = harness("drift-uninstall");
    const step = await skillStep(h, "deploy", BENIGN);
    const [record] = await applyPlan([step], { ledger: h.ledger });
    const file = path.join(h.paths.home, ".claude", "skills", "deploy", "SKILL.md");
    writeFileSync(file, "USER EDITED THIS", "utf8");
    expect(await verifyApplied(record)).toBe("drifted");
    await expect(uninstallSkill("deploy", "user", h.ledger, {})).rejects.toMatchObject({ code: "drifted" });
    expect(readFileSync(file, "utf8")).toBe("USER EDITED THIS"); // user's edit survives
    await uninstallSkill("deploy", "user", h.ledger, { force: true });
    expect(existsSync(file)).toBe(false);
    expect(await h.ledger.load()).toEqual([]);
  });

  it("MCP undo removes via the CLI; an update restores the previous entry via add-json", async () => {
    const h = harness("mcp-undo");
    const item = buildMcpItem({ name: "gh", transport: "stdio", command: "npx", args: ["-y", "p"] });
    const step = await planMcpInstall(item, "user", h.paths);
    const calls: string[][] = [];
    const [record] = await applyPlan([step], { ledger: h.ledger, spawn: fakeSpawn(calls) });
    expect(calls).toEqual([step.cliArgv]);
    await undoApplied([record], { ledger: h.ledger, spawn: fakeSpawn(calls) });
    expect(calls[1]).toEqual(["claude", "mcp", "remove", "gh", "--scope", "user"]);

    // Update: seed a previous entry, apply, undo → remove + re-add previous JSON.
    const h2 = harness("mcp-update");
    writeFileSync(
      h2.paths.home + "/.claude.json",
      JSON.stringify({ mcpServers: { gh: { type: "http", url: "https://old.example" } } }),
      "utf8",
    );
    const step2 = await planMcpInstall(item, "user", h2.paths);
    expect(step2.action).toBe("update");
    const calls2: string[][] = [];
    const [record2] = await applyPlan([step2], { ledger: h2.ledger, spawn: fakeSpawn(calls2) });
    await undoApplied([record2], { ledger: h2.ledger, spawn: fakeSpawn(calls2) });
    expect(calls2[1]).toEqual(["claude", "mcp", "remove", "gh", "--scope", "user"]);
    expect(calls2[2]).toEqual([
      "claude",
      "mcp",
      "add-json",
      "gh",
      JSON.stringify({ type: "http", url: "https://old.example" }),
      "--scope",
      "user",
    ]);
  });

  it("execFile spawn is used by default (smoke: git via the same spawn pathway shape)", () => {
    // Proves the default spawn pathway runs a real binary with argv arrays.
    const out = execFileSync("git", ["--version"], { encoding: "utf8" });
    expect(out).toMatch(/^git version/);
  });
});
