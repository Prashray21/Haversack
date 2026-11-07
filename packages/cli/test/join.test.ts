import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runJoin } from "../src/commands/join.js";
import { DEFAULT_CONFIG_FILE, MANIFEST_REL_PATH } from "@haversackhq/core";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l), out, err };
}

function join(cwd: string, io: ReturnType<typeof capture>, now?: () => number) {
  return runJoin({ cwd, ...(now ? { now } : {}), ...io });
}

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/**
 * Fresh-clone fixture: a committed repo exactly as a new teammate would see
 * it — project.yaml + sources tracked, no generated artifacts, no manifest.
 */
async function makeFreshRepo(files: Record<string, string>): Promise<string> {
  dir = path.join(tmpdir(), `runtime-join-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const git = (args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@local", "-c", "user.name=t", ...args], {
      cwd: dir,
      windowsHide: true,
    });
  git(["init", "-b", "main"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
  return dir;
}

const YAML = `runtime: 1
project: onboarding
targets: [claude-code, cursor]
rules:
  - rules/coding.md
integrations:
  github: { scopes: [read] }
`;

describe("haversack join", () => {
  it("fresh clone: syncs registered targets, verifies, reports missing + inert integrations (exit 0)", async () => {
    const repo = await makeFreshRepo({ "project.yaml": YAML, "rules/coding.md": "Be terse.\n" });
    const io = capture();
    const code = await join(repo, io);

    expect(code, io.out.join("\n")).toBe(0);
    const out = io.out.join("\n");
    expect(out).toContain("join: setting up 'onboarding'");
    expect(out).toContain("wrote CLAUDE.md");
    expect(out).toContain("wrote .cursor/rules/haversack.mdc");
    expect(out).toContain("setup report:");
    expect(out).toContain("✓ targets synced: claude-code, cursor");
    expect(out).toContain("validated but inert in the MVP");
    expect(out).toContain("✓ verified: all generated files are in sync");
    expect(out).toMatch(/done in \d+\.\ds/);
    // the generated artifact + manifest exist after join
    expect(await readFile(path.join(repo, "CLAUDE.md"), "utf8")).toContain("Be terse.");
    expect(await readFile(path.join(repo, MANIFEST_REL_PATH), "utf8")).toContain("CLAUDE.md");
  });

  it("a second join is idempotent: everything already in sync (exit 0)", async () => {
    const repo = await makeFreshRepo({ "project.yaml": YAML, "rules/coding.md": "Be terse.\n" });
    const first = capture();
    expect(await join(repo, first)).toBe(0);

    const second = capture();
    const code = await join(repo, second);
    expect(code, second.err.join("\n")).toBe(0);
    expect(second.out.join("\n")).toContain("everything in sync (2 file(s) managed)");
    expect(second.out.join("\n")).toContain("✓ verified: all generated files are in sync");
  });

  it("reports elapsed time from the injectable clock (F5.3 measurability)", async () => {
    const repo = await makeFreshRepo({ "project.yaml": YAML, "rules/coding.md": "x\n" });
    let ticks = 0;
    const now = () => {
      ticks += 2500;
      return ticks;
    };
    const io = capture();
    const code = await join(repo, io, now);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("done in 2.5s");
  });

  it("a repo without project.yaml exits 2 with guidance (exit 2)", async () => {
    const repo = await makeFreshRepo({ "README.md": "nothing here\n" });
    const io = capture();
    const code = await join(repo, io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("not found");
    expect(io.err.join("\n")).toContain("haversack join needs a committed project.yaml");
  });

  it("a repo whose referenced file is missing exits 2 without writing anything", async () => {
    const repo = await makeFreshRepo({ "project.yaml": YAML }); // rules/coding.md missing
    const io = capture();
    const code = await join(repo, io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("rules/coding.md does not exist");
    expect(io.err.join("\n")).toContain("haversack join needs a committed project.yaml");
  });

  it("a secret in a source file stops join before any write (exit 3)", async () => {
    const fixtureToken = `ghp_${"E".repeat(36)}`; // runtime:allow-secret — scanner fixture
    const repo = await makeFreshRepo({
      "project.yaml": YAML,
      "rules/coding.md": `never commit ${fixtureToken}\n`,
    });
    const io = capture();
    const code = await join(repo, io);
    expect(code).toBe(3);
    expect(io.err.join("\n")).toContain("✘ secret detected — nothing was written");
    expect(io.err.join("\n")).toContain("[REDACTED]");
    expect(io.err.join("\n")).not.toContain(fixtureToken);
  });
});
