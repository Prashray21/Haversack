# MVP Audit — 2026-11-07

Method: every claim cites a file path plus a passing test name or pasted command output; "Not started" means no code exists. PRD v0.2 (`docs/PRD.md`, last commit `c942e5e`) is the requirement source. Test evidence: `pnpm test` 2026-11-07 (R0 recount) — core **128 passed** (14 files), cli **52 passed** (5 files) — **180 passed + 1 skipped** live-judge test.

## 1. P0 requirements (PRD §7 + §8)

| ID | Requirement | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| F1.1 | Adapters for ≥3 targets | **Done** (3/3) | claude-code → CLAUDE.md (`packages/core/src/adapters/claude-code.ts`); cursor → `.cursor/rules/runtime.mdc` (`packages/core/src/adapters/cursor.ts`, header after frontmatter, format verified per `docs/agents-md-findings.md`); copilot → `.github/copilot-instructions.md` (`packages/core/src/adapters/copilot.ts`); tests: `packages/core/test/cursor.test.ts` (9 incl. placement + determinism), `packages/core/test/registry.test.ts` ("registers all three MVP targets"); dogfooded live on this repo and examples/sample-project | — |
| F1.2 | `sync` shows diff before writing | **Done** | `packages/cli/src/commands/sync.ts` (`renderDiff`, prompt); `packages/cli/test/sync.test.ts` ("prompts before writing and aborts on anything but yes") | — |
| F1.3 | Generated files marked; hand edits → drift | **Done** | `packages/core/src/adapters/header.ts`, `packages/core/src/drift/detect.ts`; `packages/core/test/detect.test.ts` ("hand-edited: disk differs from the last sync"); `packages/cli/test/sync.test.ts` ("hand-edited generated files are skipped as drift unless --force") | — |
| F1.4 | Rule priority; conflicts flagged at compile time | **Not started** | No lower-level instruction source exists to conflict with; nothing coded | Needs user-level config concept; deferred |
| F1.5 | Adapters versioned + isolated; add target without touching core | **Done** (mechanism) | `packages/core/src/adapters/types.ts` (pure `TargetAdapter`), `registry.ts` (one line per target); `packages/core/test/registry.test.ts` | — |
| F2.1 | Static checks: pattern, file-path, AST | **Partial** | `packages/core/src/checks/static.ts` + `packages/core/test/static.test.ts` ("fails with a finding when a line matches", "restricts evaluation to the path globs") | AST-based rules (needs ts-morph) |
| F2.2 | LLM-judged checks on the diff | **Partial** (implemented; unverified live) | Judge engine `packages/core/src/llm/judge.ts` + fetch transport `transport.ts` (timeout, bounded retries, Retry-After, 429 handling) wired into `packages/cli/src/commands/check.ts`; 17 tests in `packages/core/test/judge.test.ts` (mocked transport: pass, fail, malformed, schema-mismatch, fences, timeout, 429 retry/Retry-After, 401 no-retry, budget pre/post, injection-guard delimiters, key-in-header-only) + 5 CLI-integration tests in `packages/cli/test/check.test.ts` (ledger, paths scoping, budget pre-gate, malformed, env-key detail) | **Unverified live:** the live test exists but is `describe.skipIf(!OPENAI_API_KEY)` — needs an API key to run (see checkpoint) |
| F2.3 | severity block/warn/info; only block fails | **Done** | `packages/core/src/checks/static.ts`; `packages/cli/test/check.test.ts` ("warn-only violations exit 0", "whole-file mode: block failure exits 1") | — |
| F2.4 | Findings link rule, file, line, suggested fix | **Done** | `CheckFinding` (`packages/core/src/checks/types.ts`); `packages/cli/test/check.test.ts` ("src/app.ts:2 — console.log…" + "fix: …" asserted) | — |
| F2.5 | Dismiss findings with reason; logged | **Not started** | — | Needs server/App state; out of scope this session |
| F2.6 | Cost controls: static first; LLM only changed files; budget | **Done** (local scope) | static-first ordering + path scoping (`packages/cli/test/check.test.ts` F2.6 tests); llm checks run only in `--base` diff mode and only on `paths`-matching changed files ("a changed file outside the check's paths: skipped no_matching_files, judge never called"); budget: per-run + per-month caps in `packages/core/src/llm/judge.ts` + machine-local ledger `packages/core/src/llm/ledger.ts` ("month budget exhausted before the call: skipped, judge never called", "run cost above usd_per_run: verdict not presented, spend recorded") | Server-side ledger is App scope (M8) |
| F2.7 | `runtime check` locally | **Done** | `packages/cli/src/commands/check.ts`; 11 tests in `packages/cli/test/check.test.ts`; verified live on this repo — the dogfood CI job runs `runtime check` + `runtime sync --verify` on every push (`.github/workflows/ci.yml`) | — |
| F5.1 | `init` scans repo, generates draft; ingests CLAUDE.md/AGENTS.md/.cursor/rules | **Done** | `packages/cli/src/commands/init.ts`; 9 tests in `packages/cli/test/init.test.ts` ("repo with CLAUDE.md: MOVES it into context/…, and sync works afterwards", "re-running init refuses…", "a secret in the ingested file blocks init…", empty/AGENTS.md/both/broken-yaml fixtures); live run on a scratch repo: init → `sync` → `sync --verify` all exit 0 | — |
| F5.2 | `join` sets up a teammate | **Done** (CLI scope) | `packages/cli/src/commands/join.ts`; 6 tests in `packages/cli/test/join.test.ts` ("fresh clone: syncs registered targets, verifies, reports missing + inert integrations", "a second join is idempotent", secret-stop exit 3); live on the sample project: exit 0 with full report | Gateway connect step is Phase 2 (D7) — the report says so explicitly |
| F5.3 | join → working setup < 10 min | **Verified** (mechanism) | Every join prints its elapsed time; measured live: **0.1s** on the sample project (fresh-clone state, generated artifacts removed) and 0.1s on this repo — far under the 10-minute target; business validation still needs real design partners | — |
| F6.1 | Dashboard: members and roles | **Not started** | — | Explicitly out of scope this session |
| F6.2 | Dashboard: integrations status | **Not started** | — | Out of scope this session |
| F6.3 | Dashboard: check results + audit log | **Not started** | — | Out of scope this session |
| F6.4 | Dashboard: drift report | **Not started** | — | Out of scope this session |

### §8 MVP scope items

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| CLI `init` | **Done** | `packages/cli/src/commands/init.ts`; 9 tests; live init→sync→verify pipeline on a scratch repo (exit 0) | — |
| CLI `sync` | **Done** | `packages/cli/src/commands/sync.ts`; 18 tests in `packages/cli/test/sync.test.ts`; live run on `examples/sample-project` (exit 0, "everything in sync (3 file(s) managed)") and in the CI dogfood job | — |
| CLI `check` | **Done** | `packages/cli/src/commands/check.ts`; 18 tests; see F2.7 | — |
| CLI `join` | **Done** | `packages/cli/src/commands/join.ts`; 6 tests; live timed run on the sample project (exit 0, 0.1s) | — |
| 3 target adapters | **Done** (3/3) | claude-code, cursor, copilot registered + tested; live-generated on this repo and examples/sample-project | — |
| GitHub App (static + LLM PR checks) | **Not started** | `apps/github-app/README.md` stub only | Out of scope this session; ~5–8 dev-days |
| Minimal dashboard | **Not started** | — | Out of scope this session; ~3–5 dev-days |
| `project.yaml` spec v1 | **Done** | `packages/core/src/schema/project.ts`; `packages/core/test/schema.test.ts` (10 tests) | — |

### MVP exit criteria (PRD §8)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 3 design-partner agencies, 2 live projects each | **Not started** | No design partners recruited |
| New dev working setup < 10 min | **In progress (mechanism verified)** | `runtime join` exists and prints elapsed time; measured 0.1s live on the sample project (F5.2/F5.3 rows); business validation needs design partners |
| Check FP rate < 15% on blocking rules | **Not started** | Needs real PR traffic (GitHub App) |
| init ingests existing AI config files | **In progress (code done)** | `runtime init` implements F5.1/D11 — see F5.1 row; MVP-exit criterion needs design-partner trials |

## 2. P1 items (status only)

- **F3 Living context** — Not started.
- **F4 Managed MCP gateway** — Not started (Phase 2 per PRD §14).
- **F7 Skills** — Not started.

## 3. Completion numbers (method shown)

1. **Implemented (P0):** Done 11 / 19, Partial 2 / 19, Not started 6 / 19 — recounted row by row from the §1 table (R0). §8 adds: **6 of 8** scope items fully Done, 0 Partial, 2 Not started.
2. **Verified by automated tests:** 12 of the 13 Done-or-Partial P0 rows (11 Done + 2 Partial) cite named passing tests (F1.1, F1.2, F1.3, F1.5, F2.1, F2.2, F2.3, F2.4, F2.6, F2.7, F5.1, F5.2). The exception is F5.3, whose evidence is a live timing measurement, not a named test. Spec v1 also test-verified.
3. **Completion summary (P0):** Done 11 / 19; Done + Partial 13 / 19.
4. **Rules-as-CI on PRs:** enforcement on pull requests does not exist until the GitHub App exists — today `runtime check` runs locally only and no PR is gated.
5. **Verified live (ran on a real repo or service):** `runtime sync` on the real `examples/sample-project` (exit 0, "everything in sync"); the standalone SEA binary `runtime.exe --version` + `runtime sync --verify` (exit 0, pasted in session); secret-scan audit over the real working tree + git history (16 synthetic fixture findings); the release pipeline end-to-end — throwaway tag `v0.0.2-test` on `90130ad` produced Release run `42277569102` (success, 2m07s, all 4 jobs green) publishing exactly 4 binaries + `SHA256SUMS.txt` with `isPrerelease: true`, macOS ad-hoc codesign exit 0 and per-OS smoke tests passing (release and tags deleted after inspection); **dogfooding (M2)** — this repo has a real `project.yaml` + `context/` + `rules/`; live runs: `runtime sync` exit 0 (wrote `CLAUDE.md` + manifest), `sync --verify` exit 0, `runtime check` exit 0 (3 checks pass; the gate's first run exited 3 and 9 intentional fixture/code lines got `runtime:allow-secret` markers), sample-project `check` exit 0 as a standalone git repo (in-place it exits 2 by design — subdir guard); **release v0.1.0 (R4)** — Release run 42358895337 success (1m37s), isPrerelease **false**, tagged Latest (releases/latest → v0.1.0), 4 binaries + SHA256SUMS.txt, notes from CHANGELOG.md; published Windows exe downloaded to a clean temp folder, checksum verified via the README method (Get-FileHash, matches), `--version` → 0.1.0 (exit 0), quickstart init/sync/verify/hand-edit→verify(1)/force/check all correct exits, join from a fresh clone exit 0 (312 ms clone-to-working); prior: **release v0.1.0-alpha.1 (M9)** — Release run 42291438382 success (1m54s), isPrerelease true, 4 binaries + SHA256SUMS.txt, notes from CHANGELOG.md; the published Windows exe downloaded to a temp dir, checksum verified (sha256sum -c: OK), `--version` → 0.1.0-alpha.1 (exit 0), `sync -y` + `sync --verify` on a fresh clone exit 0 (3 files), `check` on the fresh-clone repo root exit 0; **hardening live runs (M3)** — the locally built Windows SEA binary ran `--version`, `sync`, `sync --verify`, and `check` on this repo (all exit 0, write path included), a fresh clone installed with `--frozen-lockfile`, built, tested (133 passed) and ran the CLI green, and CI runs an ubuntu `binary-smoke` job (`.github/workflows/ci.yml`) plus the dogfood job on every push. **Not verified live:** GitHub App (doesn't exist), all dashboard items.

## 4. Decision log D1–D13

| # | Implemented? | Evidence / gap |
| --- | --- | --- |
| D1 | Partial | Inline checks: schema + runner ✓. Base-branch evaluation: App-side only, not built |
| D2 | Done | `packages/core/src/checks/static.ts` `changedLines`; `packages/cli/test/check.test.ts` ("--base restricts to added lines…") |
| D3 | Done | `severitySchema.default("warn")` in `packages/core/src/schema/project.ts` |
| D4 | Done (local scope) | `packages/core/src/llm/judge.ts` (USD cents math, usd_per_run + usd_per_month caps, exhaustion → skipped never pass) + `packages/core/src/llm/ledger.ts` (machine-local ledger, UTC month, integer cents); tests in judge.test.ts + check.test.ts; server-side ledger = M8 |
| D5 | Done | `packages/core/src/adapters/header.ts`, `drift/manifest.ts` (`stableStringify`), LF normalization in `parse/files.ts` |
| D6 | Done | `packages/cli/src/commands/sync.ts` + `check.ts` exit paths; tests assert 0/1/2/3 |
| D7 | Done | `loadProject` warning; `packages/core/test/load.test.ts` ("warns that integrations are inert") |
| D8 | Done | `packages/core/src/secrets/scan.ts`; `packages/core/test/secrets.test.ts` ("never includes the secret value in any snippet…", "does not flag environment reads — the sanctioned credential pattern (BUG-008)"); gate extended to project.yaml on sync (BUG-007) |
| D9 | Done | All three MVP targets registered (`packages/core/src/adapters/registry.ts`); formats verified from official docs — see `docs/agents-md-findings.md` |
| D10 | Partial | 20 KB warn implemented (`SIZE_WARN_BYTES` used in `sync.ts`); import mode is v1.1 by definition |
| D11 | Done | `packages/cli/src/commands/init.ts` ingests CLAUDE.md / AGENTS.md / .cursor/rules with the conflict-aware move rule; 9 tests in `packages/cli/test/init.test.ts` (F5.1 row) |
| D12 | Done | `LICENSE` (MIT), `"license": "MIT"` ×3, PRD §16 q5 answered |
| D13 | Done | `packages/cli/src/commands/check.ts`; `packages/cli/test/check.test.ts` |

## 5. Quality

- **Tests:** core 128 (14 files), cli 52 (5 files) — 180 passed + 1 skipped live-judge, all green 2026-11-07 (R0 recount).
- **Hardening (M3):** symlink/junction escape rejected (`realpath` both sides), generated-header detection anchored (spoof guard), per-check cooperative time budget (1000 ms → `skipped`, never a pass; single-call residual risk documented in `packages/core/src/constants.ts`), binary-file skip, atomic writes (temp+rename) for generated files and the manifest, corrupt-manifest recovery, secret gate extended to `project.yaml`. Full details with regression tests in `docs/BUGS.md` (BUG-001…007).
- **Untested modules:** `apps/github-app` (stub), `packages/cli/src/main.ts` (commander wiring — actions tested directly), `scripts/scan-secrets.mjs`, `scripts/license-report.mjs`, `scripts/gh-api.mjs` (operational scripts, run manually).
- **Known bugs:** none open; 8 found and fixed with regression tests (`docs/BUGS.md` BUG-001…008: 7 during M3, BUG-008 during M6), plus two CI-environment bugs fixed earlier (typecheck-before-build ordering; 8.3 short-path repo-root comparison).
- **Dependency audit:** `pnpm audit` — **No known vulnerabilities found** (R0.2: vitest bumped 3.2 → 4.1.12 with owner approval; all 5 previous findings were dev-toolchain and are gone). R0 recount: P0 Done 11/19, Partial 2/19, Not started 6/19; §8 6 of 8 Done. License report: 100 packages, 0 flagged (`docs/dependency-licenses.md`).
- **TODOs in our source:** none (`grep -rn "TODO|FIXME|XXX" packages/ --include="*.ts"` matches only `node_modules`).

## 6. Pending work (dependency order, rough single-dev effort)

1. ~~M3–M7 (2026-11-07 session):~~ **done** — hardening pass (M3, 8 bugs fixed), `init` (M4), `join` (M5), LLM judge + budget ledger (M6, unverified live), Cursor/Copilot adapters (M7). Release v0.1.0-alpha.1 shipped (M9).
2. **GitHub App** (~5–8d): webhook receiver, PR check runs against base-branch `project.yaml`, findings annotations, dismissals (F2.5), server-side budget ledger. **Cannot be finished this session.**
3. **Minimal dashboard** (~3–5d): members, integrations, check results, drift report (F6.1–6.4). **Cannot be finished this session.**
4. **AST-based static checks** (~2d, ts-morph).
5. **Living context (F3)** (~2–3d, depends on App).
6. **MVP exit measurement** (design partners, FP-rate) — business work, not code.
