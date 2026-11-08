# MVP Audit — 2026-11-07

## 2026-11-08 — v0.2.0-alpha.1 SHIPPED (owner "ship it")

- Tag `v0.2.0-alpha.1` pushed after main CI green (`42467209609`); Release workflow run `42467342843` success (1m59s). Release verified via gh: `isPrerelease:true`, `isDraft:false`, notes from CHANGELOG.
- Assets: `haversack-{linux-x64, macos-arm64, macos-x64, windows-x64.exe}` + `SHA256SUMS.txt` (workflow) + `Haversack-Setup-0.2.0-alpha.1.exe` (122,881,989 bytes, SHA-256 `92b6b18f8183ed7569ebcbb2f9468a745836bf319ca81d1743e94dfd4c0a328e`) + `.sha256` — desktop installer uploaded via gh. **Self-caught correction**: the first upload was the pre-userData-fix build (`e76fb191…`); replaced with the fully-fixed `release-a3` build (`92b6b18f…`) via `--clobber` — the shipped artifact is the exact binary the uninstall-wipe evidence used.
- Version bump: all four package.json files → `0.2.0-alpha.1`; CLI build injects `CLI_VERSION = 0.2.0-alpha.1`. The version-invariant test failed once against the stale pre-bump dist and passed after rebuild — working as designed, no BUGS.md entry.
- README rewritten for the current reality: desktop app local mode first (with the four real screenshots), CLI engine second (framing superseded by PRD v0.3), honest not-built list (team layer, second target, auto-update, signing, macOS/Linux).

## 2026-11-08 — P3 complete (gate posted)

- **Installer evidence on this PC** (assisted NSIS, per-user, unsigned per ADR 001 decision #2):
  - alpha.0 installer `Haversack-Setup-0.2.0-alpha.0.exe`, SHA-256 `229851da2c0ea52fe3f230d917206e03e9717377546eb3d060afd358a17410b1`, `Get-AuthenticodeSignature` → `NotSigned` (expected, documented).
  - Install → app ran; smoke on the installed exe. **Upgrade**: alpha.1 (fixed) installed over it → `SMOKE_OK {"product":"Haversack","appVersion":"0.2.0-alpha.1","engine":"utility-process","rendered":true}` from `D:\New folder (2)\Haversack\Haversack.exe`.
  - Secrets: in-app round-trip via the REAL safeStorage path → `SMOKE_SECRET persisted=true roundTrip=true`; `%APPDATA%\Haversack\data\secrets.bin` exists; `grep` for the secret value in the file → count 0 (DPAPI-encrypted blob, not plaintext).
  - Uninstall → `installdir_exists_exit=2`, `userdata_exists_exit=2`, `secrets_exists_exit=2` (all gone — the stored encrypted secret was wiped with the userData tree), zero Haversack processes.
- **Two owner-reported/capture-found bugs, fixed + logged in docs/BUGS.md**: BUG-009 (app:// hostname double-counted in the path → renderer 404 "not found" — the owner saw this on opening the app) and BUG-010 (sandboxed preload must be CJS; ESM preload silently killed the bridge). Guard: the smoke gate now FAILS unless `#root` actually mounts and captures renderer console from window creation.
- **Real screenshots** (1080×720, window capture via PrintWindow PW_RENDERFULLCONTENT; no automation dependency — smoke-only tab-switch hook + `scripts/capture-window.ps1`): `docs/assets/app/{inventory,add-skill,add-mcp-server,secrets}.png` (light/dark follow OS; captured in dark).
- **Git mishap, self-caught**: a commit accidentally included the electron-builder output dirs (~420k lines incl. a 122 MB exe > GitHub's 100 MB cap) → push rejected → reset (never pushed), output dirs gitignored, re-committed clean. Force-push-free.
- Verification: typecheck exit 0 (all three packages); core **178 passed** + cli **58 passed | 1 skipped**; CI `42466303155` success. Disk: C: 3.0 GB free (above the 1 GB stop line), D: 124.3 GB.
- **Honestly not done**: click-through E2E of the file-picker dialogs (folder/zip selection needs a human at the dialog) — the owner's interactive validation per PRD §12 covers exactly this before P4/P5.

## 2026-11-08 — P3 mid-phase (P3.1 wiring + P3.2 screens)

- Identity: owner confirmed **Haversack** → single `APP_IDENTITY` constant (`apps/desktop/src/shared/identity.ts`), appId `io.github.prashray21.haversack`.
- P3.1 (`a358b0f` + fix `04cf3da`): Electron 45.2.3 + electron-builder 26.18.0 + @electron/fuses 2.1.3 + vite 8.3.6 + React 19.3.1 — exact ADR 001 §13 pins (supabase-js deferred to P5). Sandboxed renderer, `app://` protocol serving only `dist/renderer` with the full CSP from ADR §5, fixed zod-validated IPC with sender-frame check, utility-process engine (hard kill on timeout), no crashReporter/telemetry. One CI failure self-inflicted (core inventory module committed late) — fixed same day, CI green.
- Audit findings at install (recorded per ADR §13): `pnpm audit` = **1 moderate** — minimatch GHSA-g3hv-75wg-m249, ALL paths inside electron-builder's build tooling (dev-only, never ships in the app bundle). Accepted as residual; flagged to owner. `electron-winstaller` (transitive of electron-builder's Squirrel target, which this project never builds) needed an allowBuilds entry — its install script is a local 7z-arch selector (verified from the npm registry scripts field; no network fetch).
- P3.2 (`95c3ef7`): local-mode screens per PRD L1–L7; secret values via safeStorage store FAIL-CLOSED (unavailable ⇒ memory-only this run, UI states it); values never sent to the renderer (main injects them into plan.mcp for user scope only); MCP connection test shows the exact command in an approval dialog EVERY run.
- Verification: `pnpm typecheck` (desktop, two tsconfigs) exit 0; `pnpm build` exit 0; `HAVERSACK_SMOKE=1 electron .` → `SMOKE_OK {"product":"Haversack","appVersion":"0.2.0-alpha.0","engine":"utility-process"}`; core 178 + cli 58+1skip tests green; CI runs 42460775131, 42461555420 success.

## 2026-11-08 — P2 engine extension complete (gate posted)

- P1: ADR 003 (`docs/adr/003-targets-and-install-mechanics.md`, commit `115db5e`) approved by owner.
- P2 sub-milestones (tests first, each committed): `3cb7f7b` library-item model (skill/mcp items,
  placeholder-only env, canonical hashes); `e0a1e9b` skill ingestion folder/zip/pinned-git
  (security boundary); `72235d2` pure install planner + claude-code adapter; `5ecdfe5`
  apply/undo/uninstall + applied-items ledger.
- All 10 adversarial tests required by BUILD_PROGRAM §P2 exist and pass — exact test names mapped
  in `docs/REVIEW_P2.md` §3 (the phase's security review guide, with residual risks in §4).
- Verification 2026-11-08: `pnpm -r --stream typecheck` exit 0; `pnpm -r --stream test` core
  **176 passed** (19 files) + cli **58 passed | 1 skipped**, overall exit 0.
- Dependency: `fflate ^0.8.3` added to packages/core (owner-approved; `pnpm audit`: "No known
  vulnerabilities found"). Zip parser choice per owner (battle-tested over hand-rolled).
- Content-hash semantics: skill hashes pin FILES ONLY (name is the destination, previewed
  separately); MCP hashes include the server name (the name is the config entry key).

## 2026-11-08 — P0 plan reset (PRD v0.3 is now the source of truth)

- Product plan reset per `docs/BUILD_PROGRAM.md`: the product is a Windows desktop app + Supabase team workspace (PRD v0.3). Rules-as-CI, GitHub App, PR enforcement, MCP gateway, renames: shelved. Old docs archived, nothing deleted: `docs/archive/PRD-v0.2.md`, `docs/archive/decisions.md` (moved from `context/`), `docs/archive/002-rename.md`.
- The audit sections below remain valid as the evidence record for the **v0.1.0 CLI engine**, which PRD v0.3 §14 explicitly reuses (atomic writes, path-escape protection, secret gate, content hashing, test/CI setup).
- Rename decision (owner): commit `19e85c4` kept — code stays `haversack`; no further renaming.
- Standing rules added (`105ee42`). Progress ledger created: `docs/PROGRESS.md`.
- Dogfood consistency after archiving `context/decisions.md`: removed its `project.yaml` context reference and regenerated (`sync` wrote `CLAUDE.md`, `.cursor/rules/haversack.mdc`, `.github/copilot-instructions.md`, updated `.haversack/manifest.json`); `sync --verify` exit 0; `check` exit 0 (3 checks, no blocking failures).
- Verification at P0: `pnpm typecheck` exit 0; `pnpm test` core **141 passed** (15 files) + cli **58 passed | 1 skipped** (live-judge test needs OPENAI_API_KEY), overall exit 0.
- CI on main verified green after the P0 push: run `42455188562` (commit `daa476c`) completed success, 1m16s — read-only `gh run list` with the user-approved per-call GCM token (interactive gh remains unauthenticated, exit 4).

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
| F5.3 | join → working setup < 10 min | **Verified** (mechanism) | Every join prints its elapsed time; measured live: **0.1s** on the sample project (fresh-clone state, generated artifacts removed) and 0.1s on this repo — far under the 10-minute target; business validation still needs real design partners | The 0.1 s measurement proves the mechanism only — it is not a first-time setup measured from download |
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
5. **Verified live (ran on a real repo or service) — table form (rewritten 2026-11-07 from the previous prose):**

| What was run | When | Result |
| --- | --- | --- |
| `runtime sync` on the real `examples/sample-project` | 2026-11-07 | exit 0, "everything in sync" |
| Standalone SEA binary: `runtime.exe --version` + `runtime sync --verify` | 2026-11-07 | exit 0 (pasted in session) |
| Secret-scan audit over the real working tree + git history | 2026-11-07 | 16 synthetic fixture findings |
| Release pipeline end-to-end: throwaway tag `v0.0.2-test` on `90130ad` | 2026-11-07 | Release run `42277569102` success (2m07s, all 4 jobs green), 4 binaries + `SHA256SUMS.txt`, `isPrerelease: true`, macOS ad-hoc codesign exit 0, per-OS smoke tests passing; release and tags deleted after inspection |
| Dogfood (M2) live runs on this repo (real `project.yaml` + `context/` + `rules/`) | 2026-11-07 | `runtime sync` exit 0 (wrote `CLAUDE.md` + manifest), `sync --verify` exit 0, `runtime check` exit 0 (3 checks pass; the gate's first run exited 3 and 9 intentional fixture/code lines got `runtime:allow-secret` markers) |
| `runtime check` on `examples/sample-project` as a standalone git repo | 2026-11-07 | exit 0 (in-place it exits 2 by design — subdir guard) |
| Release v0.1.0 (R4) | 2026-11-07 | Release run `42358895337` success (1m37s), isPrerelease **false**, tagged Latest (releases/latest → v0.1.0), 4 binaries + SHA256SUMS.txt, notes from CHANGELOG.md; published Windows exe downloaded to a clean temp folder, checksum verified via the README method (Get-FileHash, matches), `--version` → 0.1.0 (exit 0), quickstart init/sync/verify/hand-edit→verify(1)/force/check all correct exits, join from a fresh clone exit 0 (312 ms clone-to-working) |
| Release v0.1.0-alpha.1 (M9) | 2026-11-07 | Release run `42291438382` success (1m54s), isPrerelease true, 4 binaries + SHA256SUMS.txt, notes from CHANGELOG.md; the published Windows exe downloaded to a temp dir, checksum verified (sha256sum -c: OK), `--version` → 0.1.0-alpha.1 (exit 0), `sync -y` + `sync --verify` on a fresh clone exit 0 (3 files), `check` on the fresh-clone repo root exit 0 |
| Hardening live runs (M3) | 2026-11-07 | The locally built Windows SEA binary ran `--version`, `sync`, `sync --verify`, and `check` on this repo (all exit 0, write path included); a fresh clone installed with `--frozen-lockfile`, built, tested (133 passed) and ran the CLI green; CI runs an ubuntu `binary-smoke` job plus the dogfood job on every push (`.github/workflows/ci.yml`) |

   **Not verified live:** GitHub App (doesn't exist), all dashboard items, the LLM judge against the real OpenAI API.

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
2. **GitHub App** (~5–8d, design in `docs/github-app-design.md`): webhook receiver, PR check runs against base-branch `project.yaml`, findings annotations, dismissals (F2.5), server-side budget ledger. Roadmap B — its own future session with its own gate.
3. **Dashboard (F6.1–6.4)** — members, integrations, check results, drift report: now being built as the Phase A desktop app's team layer (§7, A6) instead of a separate web dashboard.
4. **AST-based static checks** (~2d, ts-morph).
5. **Living context (F3)** (~2–3d, depends on App).
6. **MVP exit measurement** (design partners, FP-rate) — business work, not code.

## 7. Phase A — desktop app (Windows, started 2026-11-07)

| Step | Status | Evidence |
| --- | --- | --- |
| A0 preflight | **Done** | Measured: node 24.14.1, pnpm 12.16.1, git 2.53.0, WebView2 156.0.4314.58 present; docker ✗, supabase CLI ✗, WSL ✗, MSVC ✗, Rust ✗; C: 1.5 GB free / D: 128 GB (owner approved D: for storage). Blockers handed to owner: WSL2 + Docker Desktop install (elevated, owner-side, needed by A5), Supabase CLI route. |
| A1 architecture ADR | **Approved** (rev 2, owner review 2026-11-07); **desktop track paused** pending rename completion | `docs/adr/001-desktop-architecture.md` rev 2: 8 dependencies pinned exact + MIT-checked (electron 45.2.3, electron-builder 26.18.0, @electron/fuses 2.1.3, vite 8.3.6, @vitejs/plugin-react 6.2.1, react/react-dom 19.3.1, supabase-js 2.119.0), `electron-updater` removed — **no auto-update**, manual updates (private-repo `GH_TOKEN` reason verified + cited), core runs in a **utility process** killed on hard timeout, **LLM-judged checks excluded** from the app, safeStorage-backed session storage that **fails closed**, full CSP, sender-frame + zod IPC validation, assisted NSIS installer with D:-writable target + C:-writer list, identity via one `APP_IDENTITY` constant TBD until rename. All framework claims cite official docs fetched 2026-11-07. |

## 8. Rename track N0–N5 (2026-11-07, "Project Runtime" → working name Toolroll → **Haversack confirmed**)

| Step | Status | Evidence |
| --- | --- | --- |
| N0 name check + N0b competitor review | **Done — STOPPED, owner replied "name confirmed: Haversack"** | Toolroll failed check 1 (npm `toolroll@0.9.93` "control plane for unattended coding agents" ships bin `toolroll` + brew tap ap9000/homebrew-toolroll). Matrix of 7 names checked (npm registry + bins, GitHub users + star-ranked search, brew/debian/ubuntu/winget/pypi, RDAP, web). Recommendation Haversack accepted: PATH 100% clean, npm unscoped taken (no bin; scoped publishing), GitHub handle taken (repo under Prashray21), haversack.dev RDAP-404. npm org availability UNVERIFIED for all (npmjs 403 to bots). Trademark links (USPTO/EUIPO/WIPO, Nice 9+42) handed to owner. N0b: 4 competitor READMEs read + cited; owner-corrected drafts stored in ADR 002 appendix. |
| N1 rename ADR | **Approved** (owner, 2026-11-07) | `docs/adr/002-rename.md`: full rename map from live grep (≈285 word-hits across src/tests/docs/workflows), identity table (binary `haversack`, **no alias** — zero-user justification, **nothing publishes to npm**, scope `@haversackhq/*`), migration design (content-hash invariance, legacy manifest adoption + `.runtime/` removal, both headers "ours", hand-edited protection, cursor legacy removal policy, spec-key deprecation, marker/ledger migration), tests-first N2 contract, desktop APP_IDENTITY proposal applied only after N5. |
| N2 rename implemented (tests first) | **Done** | Tests-first red run: **17 failing tests** across schema/load/secrets/ledger/sync/init (pasted in session) before the code change. Final: core **141 passed** (15 files, +13 incl. new `ledger.test.ts` migration tests), cli **58 passed + 1 skipped**; `pnpm build` + `pnpm typecheck` green. Live migration proof on this repo (real binary): legacy manifest adopted ("migrating legacy manifest: .runtime/manifest.json → .haversack/manifest.json"), legacy-headered CLAUDE.md regenerated as `stale` (never hand-edited), `.cursor/rules/runtime.mdc` orphan-deleted → `haversack.mdc` written, `.runtime/` removed; then `sync --verify` exit 0 ("all 3 in sync") and `check` exit 0 (legacy `runtime:allow-secret` markers honored). Sample project migrated the same way (key `haversack: 1`, verify exit 0). Legacy contract covered: both spec keys (both-present → exit 2), both headers as "ours" (spoof guards pass for both), hand-edited legacy file → drift + never overwritten, hand-edited legacy cursor file → kept + warned, budget-ledger verbatim migration. Leftover sweep: remaining `\bruntime\b` in src are legacy-compat references only (detector regex, schema legacy key, deprecation paths) — listed in the N2 report. |
