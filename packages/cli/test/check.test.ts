import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/commands/check.js";

const BASE_YAML = `runtime: 1
project: demo
targets: [claude-code]
rules:
  - rules/coding.md

checks:
  - id: no-console-log
    type: static
    severity: block
    path: ["src/**"]
    pattern: 'console\\.log\\('
    message: console.log left in production code.
    fix: Remove it or use the project logger.

  - id: no-todo
    type: static
    severity: warn
    path: ["src/**"]
    pattern: 'TODO'
    message: TODO left in code.

  - id: rls-required-on-new-tables
    type: llm
    severity: warn
    paths: ["supabase/migrations/**"]
    prompt: every new table enables row-level security
`;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l), out, err };
}

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function makeRepo(files: Record<string, string>, commitAll: boolean): Promise<string> {
  dir = path.join(tmpdir(), `runtime-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  if (commitAll) {
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
  }
  return dir;
}

function check(cwd: string, io: ReturnType<typeof capture>, opts: { base?: string; json?: boolean } = {}) {
  return runCheck({ cwd, base: opts.base, json: opts.json ?? false, ...io });
}

describe("runtime check — static engine", () => {
  it("whole-file mode: block failure exits 1 with findings; llm checks report skipped", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "Be terse.\n",
        "src/app.ts": "const a = 1;\nconsole.log(a);\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io);
    const text = io.out.join("\n");

    expect(code, io.err.join("\n")).toBe(1);
    expect(text).toContain("✘ no-console-log (block) — 1 finding(s)");
    expect(text).toContain("src/app.ts:2 — console.log left in production code.");
    expect(text).toContain("fix: Remove it or use the project logger.");
    expect(text).toContain("- rls-required-on-new-tables (warn) — skipped (llm checks not available yet");
    expect(io.err.join("\n")).toContain("1 BLOCK check(s) failed (exit 1)");
  });

  it("warn-only violations exit 0", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "// TODO fix\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("✘ no-todo (warn) — 1 finding(s)");
    expect(io.out.join("\n")).toContain("result: no blocking failures (exit 0)");
  });

  it("--base restricts to added lines: an old violation does not fail the run (D2)", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "console.log(old);\n",
      },
      true,
    );
    // working tree removes the old violation and adds a clean line
    await writeFile(path.join(repo, "src/app.ts"), "const clean = 1;\n");

    const io = capture();
    const code = await check(repo, io, { base: "main" });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("mode: added diff lines vs main");
    expect(io.out.join("\n")).toContain("✓ no-console-log (block) — no findings");
  });

  it("--base catches violations on newly added lines", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "const clean = 1;\n",
      },
      true,
    );
    await writeFile(path.join(repo, "src/app.ts"), "const clean = 1;\nconsole.log(new);\n");

    const io = capture();
    const code = await check(repo, io, { base: "main" });
    expect(code).toBe(1);
    expect(io.out.join("\n")).toContain("src/app.ts:2 — console.log left in production code.");
  });

  it("exclude wins: a violation only in an excluded file does not fail", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": `runtime: 1
project: demo
targets: [claude-code]
checks:
  - id: no-console-log
    type: static
    severity: block
    path: ["src/**"]
    exclude: ["**/*.test.ts"]
    pattern: 'console\\.log\\('
    message: console.log left in production code.
`,
        "rules/coding.md": "x\n",
        "src/a.test.ts": "console.log(1);\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("- no-console-log (block) — skipped (no files in scope)");
  });

  it("secrets in scanned files exit 3 with redacted output", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/config.ts": "const password = supersecret12345;\n", // runtime:allow-secret — scanner fixture
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io);
    expect(code).toBe(3);
    const errText = io.err.join("\n");
    expect(errText).toContain("✘ secret detected");
    expect(errText).toContain("src/config.ts:1");
    expect(errText).toContain("[REDACTED]");
    expect(errText).not.toContain("supersecret12345");
  });

  it("--json emits the structured result contract", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "console.log(1);\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io, { json: true });
    expect(code).toBe(1);

    const parsed = JSON.parse(io.out.join("\n")) as {
      project: string;
      results: Array<{ checkId: string; status: string; severity: string; findings: Array<{ line: number }> }>;
      secrets: unknown[];
    };
    expect(parsed.project).toBe("demo");
    const consoleCheck = parsed.results.find((r) => r.checkId === "no-console-log");
    expect(consoleCheck?.status).toBe("fail");
    expect(consoleCheck?.findings[0]?.line).toBe(1);
    expect(parsed.results.find((r) => r.checkId === "rls-required-on-new-tables")?.status).toBe("skipped");
    expect(parsed.secrets).toEqual([]);
  });

  it("exits 2 outside a git repository", async () => {
    const plain = await makeRepo(
      { "project.yaml": BASE_YAML, "rules/coding.md": "x\n" },
      false,
    );
    // remove .git to simulate a non-repo
    await rm(path.join(plain, ".git"), { recursive: true, force: true });
    const io = capture();
    const code = await check(plain, io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("runtime check");
  });

  it("exits 2 for an invalid --base ref", async () => {
    const repo = await makeRepo(
      { "project.yaml": BASE_YAML, "rules/coding.md": "x\n" },
      true,
    );
    const io = capture();
    const code = await check(repo, io, { base: "no-such-branch" });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("not a valid git ref");
  });
});

describe("runtime check — F2.6 cost controls", () => {
  it("static checks run first; the llm check is reported skipped after all static results (F2.6)", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "console.log(1);\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io, { json: true });
    expect(code).toBe(1);

    const parsed = JSON.parse(io.out.join("\n")) as {
      results: Array<{ checkId: string; status: string }>;
    };
    // static results first, in project.yaml order; the llm check is last,
    // skipped — never executed, never counted as a pass
    expect(parsed.results.map((r) => [r.checkId, r.status])).toEqual([
      ["no-console-log", "fail"],
      ["no-todo", "pass"],
      ["rls-required-on-new-tables", "skipped"],
    ]);
  });

  it("a static check only evaluates files matching its path globs (F2.6 path scoping)", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": BASE_YAML,
        "rules/coding.md": "x\n",
        "src/app.ts": "console.log(1);\n",
        "docs/notes.md": "console.log(1);\n",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io, { json: true });
    expect(code).toBe(1);

    const parsed = JSON.parse(io.out.join("\n")) as {
      results: Array<{ checkId: string; status: string; findings: Array<{ file: string }> }>;
    };
    const consoleCheck = parsed.results.find((r) => r.checkId === "no-console-log");
    expect(consoleCheck?.status).toBe("fail");
    // the identical violation in docs/notes.md is outside the check's path — not reported
    expect(consoleCheck?.findings.map((f) => f.file)).toEqual(["src/app.ts"]);
  });

  it("binary files are skipped with a warning, never scanned (M3)", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": `runtime: 1
project: demo
targets: [claude-code]
checks:
  - id: finds-zzzz
    type: static
    severity: block
    path: ["**"]
    exclude: ["project.yaml"]
    pattern: 'ZZZZ'
    message: ZZZZ found.
`,
        "rules/coding.md": "x\n",
        // NUL bytes make this binary; "ZZZZ" would match the pattern if scanned.
        "assets/logo.bin": "Z\u0000Y\u0000ZZZZ\u0000",
      },
      true,
    );
    const io = capture();
    const code = await check(repo, io);
    expect(code).toBe(0);
    expect(io.err.join("\n")).toContain("assets/logo.bin");
    expect(io.err.join("\n")).toContain("binary");
    expect(io.out.join("\n")).toContain("✓ finds-zzzz (block) — no findings");
  });
});
