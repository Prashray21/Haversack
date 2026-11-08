# Progress ledger

Source of truth: docs/PRD.md (v0.3). Plan: docs/BUILD_PROGRAM.md (v0.3). Last updated: 2026-11-08 (P0).

Status values: Done / In progress / Blocked / Not started. Every "Done" claim cites a commit hash plus a test name or pasted output. "Not started" means no code exists.

## Phase map

| Phase | Milestone | Status | Evidence | Next action |
| --- | --- | --- | --- | --- |
| P0 | Reset and preflight | **Done** (2026-11-08) | Commits `105ee42` (standing rules), `3eed5b5` (PRD v0.3 + archive moves), and this commit (PROGRESS, README banner, audit entry, dogfood regen). PRD header check: `grep` output in session log. Typecheck exit 0; tests 199 passed + 1 skipped (see below); `sync --verify` and `check` exit 0 after the changes | — |
| P1 | Target research: ADR 003 (Claude Code) | **Done** (2026-11-08) | ADR approved by owner; commit `115db5e`, CI run 42456054907 success | — |
| P2 | Engine extension (packages/core) | **Done — gate posted, awaiting owner** | Sub-milestone commits `3cb7f7b` (item model), `e0a1e9b` (ingestion), `72235d2` (planner+adapter), `5ecdfe5` (apply/undo/ledger). All 10 required adversarial tests present and passing — exact names in docs/REVIEW_P2.md §3. Core **176 passed** (19 files), cli **58 passed \| 1 skipped**, typecheck exit 0. fflate added (owner-approved, audit clean) | Owner reviews the P2 gate checklist → "continue" starts P3 |
| P2 | Engine extension (packages/core) | Not started | — | Library-item model, install planner (preview diff), snapshots/undo, applied-items record, first-target adapter, skill ingestion; adversarial tests per plan §P2; gate checklist with evidence |
| P3 | Desktop app, local mode (no account) | **In progress** — P3.1 wiring + P3.2 screens done; P3.3 installer, P3.4 screenshots/E2E remain | Identity confirmed by owner: **Haversack** (appId io.github.prashray21.haversack). P3.1 commit `a358b0f` + CI fix `04cf3da` (Electron 45.2.3, sandboxed renderer, app:// + full CSP, fixed zod IPC, utility-process engine with hard kill, smoke-proven `SMOKE_OK`; core `inventory` added tests-first). P3.2 commit `95c3ef7` (all L1–L7 screens; safeStorage secret store fail-closed, values never reach the renderer; MCP test with per-run approval). CI green runs 42460775131, 42461555420 | P3.3: build NSIS installer, verify install/run/upgrade/uninstall on this PC with pasted evidence (incl. no secrets left); P3.4: REAL screenshots to docs/assets/app/, gate checklist → STOP for "ship it" |
| P4 | Supabase schema + RLS | Not started (preflight blocked) | Docker Desktop CLI present (29.9.2) but engine NOT running; WSL2 NOT installed (see preflight facts) | Owner installs WSL2, starts Docker, local Supabase; then ADR first (STOP), migrations, DB tests |
| P5 | Team mode | Not started | — | Gate depends on PRD §12 validation: after P3, at least 2 real teams say yes before P4/P5 work |
| P6 | Second target + project binding | Not started | — | Owner must name the second target |
| Later | LLM provider settings, gateway design review, code signing, macOS/Linux | Not started | — | Only on owner request; each its own session + gate |

## Preflight facts (2026-11-08, P0)

- node `v24.14.1` · pnpm `12.16.1`
- Docker: CLI `29.9.2` present; engine NOT running (`docker info` → `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`). WSL2: NOT installed (`wsl --status` → "The Windows Subsystem for Linux is not installed"). Not needed until P4.
- Disk at P0 start: C: 6.0 GB free · D: 127.6 GB free. TEMP/caches/clones/build output stay on D:.
- CI on main: **verified green** via read-only `gh run list` (user-approved per-call GCM-token workaround; token never printed/stored): rename commit `19e85c4` → run 42368654884 success; P0 push `daa476c` → run 42455188562 completed success (1m16s). Interactive gh remains unauthenticated (`gh run list` without the workaround → "gh auth login", exit 4).
- Rename decision (owner, 2026-11-08): commit `19e85c4` KEPT. Code stays `haversack` (binary, packages `@haversackhq/*`, `.haversack/` manifest dir, spec key). "Haversack" is a working name in prose only. No further renaming. ADR 002 archived to `docs/archive/002-rename.md`.

## Local verification at P0 (2026-11-08)

- `pnpm typecheck` — core Done, cli Done, exit 0.
- `pnpm test` — core: **141 passed** (15 files); cli: **58 passed | 1 skipped** (5 files; skip = live-judge test without OPENAI_API_KEY). Overall exit 0.
- `node packages/cli/dist/main.js sync --verify` — "all 3 generated file(s) in sync", exit 0.
- `node packages/cli/dist/main.js check` — 3 checks passed, "no blocking failures (exit 0)".

## What the owner must provide

- gh authentication (GH_TOKEN env var or `gh auth login`) so CI status on main can be verified at every session start.
- Before P3 installer work: the app identity constant (name).
- Before P4: WSL2 installed, Docker Desktop engine running, local Supabase feasible.
- After the P3 gate: validation notes from 3–5 real teams (PRD §12) — required before P4 and P5 work.

## Session log

- 2026-11-08 — P0 done. Stopped at the P0 gate; awaiting owner "continue" before P1.
