import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/commands/check.js";
import type { LlmTransport } from "@haversackhq/core";

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

function check(cwd: string, io: ReturnType<typeof capture>, opts: { base?: string; json?: boolean; llmTransport?: LlmTransport } = {}) {
  return runCheck({ cwd, base: opts.base, json: opts.json ?? false, llmTransport: opts.llmTransport, ...io });
}

describe("haversack check — static engine", () => {
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
    expect(text).toContain("- rls-required-on-new-tables (warn) — skipped (llm checks evaluate a diff — re-run with `haversack check --base <ref>`");
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
    expect(io.err.join("\n")).toContain("haversack check");
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

describe("haversack check — F2.6 cost controls", () => {
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

/* ── LLM-judged checks end-to-end (mocked transport; F2.2, F2.6, D4) ── */

const LLM_YAML = `runtime: 1
project: demo
targets: [claude-code]
rules: []
checks:
  - id: needs-rls
    type: llm
    severity: block
    paths: ["migrations/**"]
    prompt: every new table enables row-level security
model_policy:
  pin: true
  model: gpt-test-config
  budget:
    usd_per_run: 0.50
    usd_per_month: 1.00
    usd_per_1m_input: 1000
    usd_per_1m_output: 600
`;

function judgeMock(content: unknown) {
  const calls: string[] = [];
  return {
    calls,
    async complete(request: { body: string }) {
      calls.push(request.body);
      return {
        status: 200,
        retryAfterSeconds: undefined,
        body: JSON.stringify({
          model: "gpt-test-served",
          choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  } as unknown as LlmTransport & { calls: string[] };
}

describe("haversack check — llm judged checks (mocked transport)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-fixture-key-not-real-000000"; // runtime:allow-secret — test fixture
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("fail verdict on a diff: block finding, usage recorded, ledger updated, body hash present", async () => {
    const repo = await makeRepo(
      {
        "project.yaml": LLM_YAML,
        "migrations/0001.sql": "create table orders (id bigint);\n",
      },
      true,
    );
    await writeFile(path.join(repo, "migrations", "0001.sql"), "create table orders (id bigint);\ncreate table users (id bigint);\n");
    const io = capture();
    const transport = judgeMock({
      verdict: "fail",
      reasoning: "users table has no RLS",
      findings: [{ file: "migrations/0001.sql", line: 2, message: "no RLS", fix: "alter table users enable row level security" }],
    });
    const code = await check(repo, io, { base: "main", json: true, llmTransport: transport });
    expect(code).toBe(1);

    const parsed = JSON.parse(io.out.join("\n")) as {
      results: Array<{ checkId: string; status: string; bodySha256?: string; usage?: { model: string; inputTokens: number; outputTokens: number; usd: number }; findings: Array<{ file: string; line: number }> }>;
    };
    const llm = parsed.results.find((r) => r.checkId === "needs-rls");
    expect(llm?.status).toBe("fail");
    expect(llm?.findings[0]).toMatchObject({ file: "migrations/0001.sql", line: 2 });
    expect(llm?.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(llm?.usage).toEqual({ model: "gpt-test-served", inputTokens: 100, outputTokens: 20, usd: 0.11 });

    // D4 ledger: 11 cents recorded for the current UTC month.
    const ledger = JSON.parse(await readFile(path.join(repo, ".haversack", "budget.json"), "utf8")) as { months: Record<string, { usdCents: number }> };
    const month = new Date().toISOString().slice(0, 7);
    expect(ledger.months[month]?.usdCents).toBe(11);
  });

  it("a changed file outside the check's paths: skipped no_matching_files, judge never called (F2.6)", async () => {
    const repo = await makeRepo(
      { "project.yaml": LLM_YAML, "docs/notes.md": "x\n" },
      true,
    );
    await writeFile(path.join(repo, "docs", "notes.md"), "x\ny\n");
    const io = capture();
    const transport = judgeMock({ verdict: "pass", reasoning: "ok", findings: [] });
    const code = await check(repo, io, { base: "main", json: true, llmTransport: transport });
    expect(code).toBe(0);
    expect(transport.calls).toHaveLength(0);
    const parsed = JSON.parse(io.out.join("\n")) as { results: Array<{ checkId: string; status: string; skippedReason?: string }> };
    expect(parsed.results.find((r) => r.checkId === "needs-rls")).toMatchObject({ status: "skipped", skippedReason: "no_matching_files" });
  });

  it("month budget exhausted before the call: skipped, judge never called (D4)", async () => {
    const repo = await makeRepo(
      { "project.yaml": LLM_YAML, "migrations/0001.sql": "create table orders (id bigint);\n" },
      true,
    );
    await writeFile(path.join(repo, "migrations", "0001.sql"), "create table orders (id bigint);\ncreate table users (id bigint);\n");
    const month = new Date().toISOString().slice(0, 7);
    await mkdir(path.join(repo, ".haversack"), { recursive: true });
    await writeFile(
      path.join(repo, ".haversack", "budget.json"),
      JSON.stringify({ project: "demo", months: { [month]: { inputTokens: 9_000_000, outputTokens: 0, usdCents: 100 } } }, null, 2),
    );
    const io = capture();
    const transport = judgeMock({ verdict: "pass", reasoning: "ok", findings: [] });
    const code = await check(repo, io, { base: "main", json: true, llmTransport: transport });
    expect(code).toBe(0); // skipped is neutral, never a failure — and never a pass
    expect(transport.calls).toHaveLength(0);
    const parsed = JSON.parse(io.out.join("\n")) as { results: Array<{ checkId: string; status: string; skippedReason?: string; detail?: string }> };
    expect(parsed.results.find((r) => r.checkId === "needs-rls")).toMatchObject({ status: "skipped", skippedReason: "budget_exhausted" });
  });

  it("malformed judge output: skipped llm_unavailable, never a pass", async () => {
    const repo = await makeRepo(
      { "project.yaml": LLM_YAML, "migrations/0001.sql": "x\n" },
      true,
    );
    await writeFile(path.join(repo, "migrations", "0001.sql"), "x\ny\n");
    const io = capture();
    const transport = judgeMock("I will not comply in JSON");
    const code = await check(repo, io, { base: "main", json: true, llmTransport: transport });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join("\n")) as { results: Array<{ checkId: string; status: string; skippedReason?: string; detail?: string }> };
    expect(parsed.results.find((r) => r.checkId === "needs-rls")).toMatchObject({ status: "skipped", skippedReason: "llm_unavailable" });
  });

  it("without OPENAI_API_KEY: skipped with a specific detail — the unverified-live state is explicit", async () => {
    const repo = await makeRepo(
      { "project.yaml": LLM_YAML, "migrations/0001.sql": "x\n" },
      true,
    );
    await writeFile(path.join(repo, "migrations", "0001.sql"), "x\ny\n");
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const io = capture();
      const code = await check(repo, io, { base: "main", json: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(io.out.join("\n")) as { results: Array<{ checkId: string; status: string; detail?: string }> };
      expect(parsed.results.find((r) => r.checkId === "needs-rls")?.detail).toContain("OPENAI_API_KEY is not set");
    } finally {
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    }
  });
});

/* ── live judge (runs ONLY with OPENAI_API_KEY set; otherwise unverified) ── */

describe.skipIf(process.env.OPENAI_API_KEY === undefined)("haversack check — LIVE judge", () => {
  it("runs one real diff check against the configured OpenAI endpoint", async () => {
    const repo = await makeRepo(
      { "project.yaml": LLM_YAML, "migrations/0001.sql": "create table orders (id bigint);\n" },
      true,
    );
    await writeFile(path.join(repo, "migrations", "0001.sql"), "create table orders (id bigint);\ncreate table users (id bigint);\n");
    const io = capture();
    const code = await check(repo, io, { base: "main", json: true }); // real transport
    const parsed = JSON.parse(io.out.join("\n")) as {
      results: Array<{ checkId: string; status: string; usage?: { model: string } }>;
    };
    const llm = parsed.results.find((r) => r.checkId === "needs-rls");
    expect(["pass", "fail", "skipped"]).toContain(llm?.status);
    if (llm?.status !== "skipped") {
      expect(typeof llm?.usage?.model).toBe("string");
      expect(code).toBe(1); // block-severity failure on a table without RLS
    }
  });
});
