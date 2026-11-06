# MVP Audit — 2026-11-07

Method: every claim cites a file path plus a passing test name or pasted command output; "Not started" means no code exists. PRD v0.2 (`docs/PRD.md`, last commit `c942e5e`) is the requirement source. Test evidence: `pnpm test` 2026-11-07 — core **87 passed**, cli **24 passed** (111 total).

## 1. P0 requirements (PRD §7 + §8)

| ID | Requirement | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| F1.1 | Adapters for ≥3 targets | **Partial** | `packages/core/src/adapters/claude-code.ts` + `packages/core/test/claude-code.test.ts` ("generates exactly one file at CLAUDE.md"); `packages/core/test/registry.test.ts` ("registers claude-code") | Cursor + Copilot adapters (M3d, docs-gated) |
| F1.2 | `sync` shows diff before writing | **Done** | `packages/cli/src/commands/sync.ts` (`renderDiff`, prompt); `packages/cli/test/sync.test.ts` ("prompts before writing and aborts on anything but yes") | — |
| F1.3 | Generated files marked; hand edits → drift | **Done** | `packages/core/src/adapters/header.ts`, `packages/core/src/drift/detect.ts`; `packages/core/test/detect.test.ts` ("hand-edited: disk differs from the last sync"); `packages/cli/test/sync.test.ts` ("hand-edited generated files are skipped as drift unless --force") | — |
| F1.4 | Rule priority; conflicts flagged at compile time | **Not started** | No lower-level instruction source exists to conflict with; nothing coded | Needs user-level config concept; deferred |
| F1.5 | Adapters versioned + isolated; add target without touching core | **Done** (mechanism) | `packages/core/src/adapters/types.ts` (pure `TargetAdapter`), `registry.ts` (one line per target); `packages/core/test/registry.test.ts` | — |
| F2.1 | Static checks: pattern, file-path, AST | **Partial** | `packages/core/src/checks/static.ts` + `packages/core/test/static.test.ts` ("fails with a finding when a line matches", "restricts evaluation to the path globs") | AST-based rules (needs ts-morph) |
| F2.2 | LLM-judged checks on the diff | **Not started** | Schema exists (`packages/core/src/schema/project.ts` `llmCheckSchema`); runner reports `skipped` (`packages/cli/src/commands/check.ts`) | Judge engine (M3c) |
| F2.3 | severity block/warn/info; only block fails | **Done** | `packages/core/src/checks/static.ts`; `packages/cli/test/check.test.ts` ("warn-only violations exit 0", "whole-file mode: block failure exits 1") | — |
| F2.4 | Findings link rule, file, line, suggested fix | **Done** | `CheckFinding` (`packages/core/src/checks/types.ts`); `packages/cli/test/check.test.ts` ("src/app.ts:2 — console.log…" + "fix: …" asserted) | — |
| F2.5 | Dismiss findings with reason; logged | **Not started** | — | Needs server/App state; out of scope this session |
| F2.6 | Cost controls: static first; LLM only changed files; budget | **Partial** | Static runs first, LLM reported skipped (`packages/cli/src/commands/check.ts`); `paths` scoping in schema; `model_policy.budget` in schema (`packages/core/src/schema/project.ts`) | Budget ledger + LLM execution (M3c) |
| F2.7 | `runtime check` locally | **Done** | `packages/cli/src/commands/check.ts`; 9 tests in `packages/cli/test/check.test.ts`; CI green (GitHub Actions run for `d84ec16`) | — |
| F5.1 | `init` scans repo, generates draft; ingests CLAUDE.md/AGENTS.md/.cursor/rules | **Not started** | — | M3a |
| F5.2 | `join` sets up a teammate | **Not started** | — | M3b |
| F5.3 | join → working setup < 10 min | **Not started** | Unmeasurable until F5.2 exists | After M3b |
| F6.1 | Dashboard: members and roles | **Not started** | — | Explicitly out of scope this session |
| F6.2 | Dashboard: integrations status | **Not started** | — | Out of scope this session |
| F6.3 | Dashboard: check results + audit log | **Not started** | — | Out of scope this session |
| F6.4 | Dashboard: drift report | **Not started** | — | Out of scope this session |

### §8 MVP scope items

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| CLI `init` | **Not started** | — | M3a |
| CLI `sync` | **Done** | `packages/cli/src/commands/sync.ts`; 15 tests in `packages/cli/test/sync.test.ts`; live run on `examples/sample-project` (exit 0, "everything in sync (1 file(s) managed)") | — |
| CLI `check` | **Done** | `packages/cli/src/commands/check.ts`; 9 tests; see F2.7 | — |
| CLI `join` | **Not started** | — | M3b |
| 3 target adapters | **Partial** (1/3) | claude-code registered + tested | Cursor, Copilot (M3d, docs-gated) |
| GitHub App (static + LLM PR checks) | **Not started** | `apps/github-app/README.md` stub only | Out of scope this session; ~5–8 dev-days |
| Minimal dashboard | **Not started** | — | Out of scope this session; ~3–5 dev-days |
| `project.yaml` spec v1 | **Done** | `packages/core/src/schema/project.ts`; `packages/core/test/schema.test.ts` (10 tests) | — |

### MVP exit criteria (PRD §8)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 3 design-partner agencies, 2 live projects each | **Not started** | No design partners recruited |
| New dev working setup < 10 min | **Not started** | F5.2/F5.3 don't exist |
| Check FP rate < 15% on blocking rules | **Not started** | Needs real PR traffic (GitHub App) |
| init ingests existing AI config files | **Not started** | M3a |

## 2. P1 items (status only)

- **F3 Living context** — Not started.
- **F4 Managed MCP gateway** — Not started (Phase 2 per PRD §14).
- **F7 Skills** — Not started.

## 3. Completion numbers (method shown)

1. **Implemented (P0):** Done 6 / 19, Partial 3 / 19, Not started 10 / 19 — counted from the §7 table above (F1.1–F1.5, F2.1–F2.7, F5.1–F5.3, F6.1–F6.4). §8 adds: 3 of 8 scope items fully Done, 2 Partial, 3 Not started.
2. **Verified by automated tests:** 8 of the 9 Done-or-Partial P0 rows (6 Done + 3 Partial) cite named passing tests (F1.1-partial, F1.2, F1.3, F1.5, F2.1-partial, F2.3, F2.4, F2.7). The exception is F2.6, whose evidence is the source file only. Spec v1 also test-verified.
3. **Completion summary (P0):** Done 6 / 19; Done + Partial 9 / 19.
4. **Rules-as-CI on PRs:** enforcement on pull requests does not exist until the GitHub App exists — today `runtime check` runs locally only and no PR is gated.
5. **Verified live (ran on a real repo or service):** `runtime sync` on the real `examples/sample-project` (exit 0, "everything in sync"); the standalone SEA binary `runtime.exe --version` + `runtime sync --verify` (exit 0, pasted in session); secret-scan audit over the real working tree + git history (16 synthetic fixture findings). **Not verified live:** `runtime check` (only in temp fixture repos via tests), GitHub App (doesn't exist), all dashboard items.

## 4. Decision log D1–D13

| # | Implemented? | Evidence / gap |
| --- | --- | --- |
| D1 | Partial | Inline checks: schema + runner ✓. Base-branch evaluation: App-side only, not built |
| D2 | Done | `packages/core/src/checks/static.ts` `changedLines`; `packages/cli/test/check.test.ts` ("--base restricts to added lines…") |
| D3 | Done | `severitySchema.default("warn")` in `packages/core/src/schema/project.ts` |
| D4 | Partial | Schema + skipped semantics exist; no spend ledger yet (M3c) |
| D5 | Done | `packages/core/src/adapters/header.ts`, `drift/manifest.ts` (`stableStringify`), LF normalization in `parse/files.ts` |
| D6 | Done | `packages/cli/src/commands/sync.ts` + `check.ts` exit paths; tests assert 0/1/2/3 |
| D7 | Done | `loadProject` warning; `packages/core/test/load.test.ts` ("warns that integrations are inert") |
| D8 | Done | `packages/core/src/secrets/scan.ts`; `packages/core/test/secrets.test.ts` ("never includes the secret value in any snippet…") |
| D9 | Partial | claude-code only; cursor/copilot pending M3d |
| D10 | Partial | 20 KB warn implemented (`SIZE_WARN_BYTES` used in `sync.ts`); import mode is v1.1 by definition |
| D11 | Not started | M3a |
| D12 | Done | `LICENSE` (MIT), `"license": "MIT"` ×3, PRD §16 q5 answered |
| D13 | Done | `packages/cli/src/commands/check.ts`; `packages/cli/test/check.test.ts` |

## 5. Quality

- **Tests:** core 87 (12 files), cli 24 (2 files) — 111 total, all green 2026-11-07.
- **Untested modules:** `apps/github-app` (stub), `packages/cli/src/main.ts` (commander wiring — actions tested directly), `scripts/scan-secrets.mjs`, `scripts/license-report.mjs`, `scripts/gh-api.mjs` (operational scripts, run manually), `packages/core/src/adapters/header.ts` covered ✓ but Cursor `.mdc` path untested until that adapter exists.
- **Known bugs:** none open. Two CI-environment bugs found and fixed earlier today (typecheck-before-build ordering; 8.3 short-path repo-root comparison — both have green CI after fixes).
- **TODOs in our source:** none (`grep -rn "TODO|FIXME|XXX" packages/ --include="*.ts"` matches only `node_modules`).

## 6. Pending work (dependency order, rough single-dev effort)

1. **M3 (this session):** `init` + ingestion (~0.5d) → `join` (~0.25d) → LLM judge + budget ledger (~1d) → AGENTS.md research + Cursor/Copilot adapters (~0.5–1d, gated on official docs).
2. **GitHub App** (~5–8d): webhook receiver, PR check runs against base-branch `project.yaml`, findings annotations, dismissals (F2.5), server-side budget ledger. **Cannot be finished this session.**
3. **Minimal dashboard** (~3–5d): members, integrations, check results, drift report (F6.1–6.4). **Cannot be finished this session.**
4. **AST-based static checks** (~2d, ts-morph).
5. **Living context (F3)** (~2–3d, depends on App).
6. **MVP exit measurement** (design partners, FP-rate) — business work, not code.
