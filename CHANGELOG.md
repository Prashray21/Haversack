# Changelog

All notable changes to Haversack (working name) are documented here.
Format: Keep a Changelog-ish; versioning: semver (prereleases carry a hyphen).

## v0.2.0-alpha.1 (2026-11-08)

**First desktop-app prerelease: local mode.** The product is now a Windows
desktop app where a team shares a library of skills and MCP servers (PRD v0.3
reset). This release is the no-account, one-machine half (L1-L7). The team
layer (shared library, accounts, invites) does **not** exist yet.

### Added

- **Desktop app, local mode** (`apps/desktop`, Electron 45, per ADR 001 rev 2): sandboxed renderer, strict CSP, fixed zod-validated IPC, all engine work in a utility process killed on timeout.
- **Inventory** (L1): skills + MCP servers configured for Claude Code, with "installed by Haversack" provenance from a content-hashed applied-items ledger; corrupt config files reported, not fatal.
- **Add skill** (L2) from folder / zip / pinned-commit git URL. Ingestion rejects path escapes, symlinks/junctions, binary and oversized payloads; secret literals are **blocked** (redacted everywhere); injection-shaped content and bundled scripts are **flagged** for review.
- **Add MCP server** (L3): command/args/env with placeholder NAMES only.
- **Plan preview** (L4): exact file writes with before/after sha256 and the exact `claude mcp add-json` argv; plan-to-apply re-verification aborts on any target drift; changed MCP commands require per-machine approval and never auto-apply.
- **Apply / undo / uninstall** (L4/L5): per-file atomic writes, pre-apply snapshots, undo that refuses to clobber user edits, uninstall gated on the ledger (never touches foreign items).
- **Secrets** (L6): values stored once with OS-protected storage (safeStorage/DPAPI), never in project files, never uploaded, never sent to the renderer; fail closed (memory-only) if protection is unavailable.
- **MCP connection test** (L7): shows the exact command, asks for approval every run.
- **Install engine in core** (`packages/core`): library-item model, ingestion, pure planner + Claude Code adapter (official `claude mcp` CLI preferred per ADR 003), apply/undo/uninstall, read-only inventory. Ten adversarial test classes pass (zip-slip, symlinks, traversal, oversize/binary, secrets, injection, crash mid-apply, partial-failure undo, foreign-item uninstall, plan-to-apply drift) — mapped in docs/REVIEW_P2.md.
- **Installer**: assisted NSIS (per-user, choose directory), unsigned (SmartScreen warning expected). Verified on the dev machine: install, run, upgrade, uninstall, with the stored secret wiped on uninstall.

### Fixed

- BUG-009: packaged renderer showed "not found" — the `app://` protocol handler double-counted the virtual host in the file path. Smoke gate now fails unless the UI actually mounts.
- BUG-010: sandboxed preload must be CommonJS; an ESM preload silently broke the renderer bridge. Preload is built as CJS; the renderer shows a plain-language error if the bridge is missing.

### Changed

- Product reset to PRD v0.3: the GitHub App, PR enforcement, rules-as-CI as a product, and the MCP gateway are shelved. The CLI (below) continues as the engine inside the app.
- Renamed Project Runtime to **Haversack** in code (binary `haversack`, scope `@haversackhq`, `.haversack/` manifest, `haversack: 1` spec key with legacy migration).

# Changelog

All notable changes to Project Runtime are documented here.
Format: Keep a Changelog-ish; versioning: semver (prereleases carry a hyphen).

## v0.1.0 (2026-11-07)

First stable-tagged CLI release. The local CLI half of the MVP: define once,
compile to every tool, detect drift, enforce locally. **Not** included (see
below): the GitHub App, dashboard, gateway, skills — "Rules as CI" enforcement
on pull requests does not exist yet; nothing gates a PR until the App ships.

### What works

- **`runtime init`** (F5.1, D11): scans a repo, ingests existing `CLAUDE.md` /
  `AGENTS.md` / `.cursor/rules` into `context/` + `rules/` (secret-gated,
  never overwrites, moves files that would conflict with generated output),
  and writes a DRAFT `project.yaml` for human review.
- **`runtime sync`** (F1.2, F1.3): compiles the definition into each target's
  native config with a diff preview, drift detection against a committed
  manifest (`.runtime/manifest.json`), atomic writes, and `--verify` for CI.
- **Three target adapters** (F1.1, D9): `claude-code` → `CLAUDE.md`,
  `cursor` → `.cursor/rules/runtime.mdc` (header after frontmatter),
  `copilot` → `.github/copilot-instructions.md`. Formats verified against
  official docs (`docs/agents-md-findings.md`).
- **`runtime check`** (F2.7, D13): static pattern checks (path-scoped,
  per-line regex with a cooperative time budget), secret scanning (redacted,
  D8), `--base <ref>` diff mode.
- **`runtime join`** (F5.2): new-teammate setup — sync, verify, report what
  is missing; measured well under the 10-minute target (F5.3).
- **`project.yaml` spec v1** with schema validation, positioned errors,
  duplicate detection, and cross-field checks.
- **Standalone binaries** (Node SEA): linux-x64, macOS arm64/x64 (ad-hoc
  signed), windows-x64 — each smoke-tested in CI against the sample project;
  verified on Windows (paths with spaces and non-ASCII characters, three
  shells, both `core.autocrlf` settings — `docs/TESTING.md`).

### What is NOT included

- **GitHub App / PR enforcement** (F2 App side, designed in
  `docs/github-app-design.md`): nothing blocks a pull request yet; `runtime
  check` is local-only.
- **Dashboard** (F6): none.
- **Managed MCP gateway** (F4): Phase 2; `integrations:` validates but is
  inert (D7).
- **Skills** (F7), living context (F3): not started.
- **LLM-judged checks**: implemented and mock-tested; labeled **experimental,
  unverified live** — the live test needs an `OPENAI_API_KEY` and has not run
  against the real API yet.
- **Signed/notarized binaries**: Windows binaries are unsigned (SmartScreen
  warns), macOS binaries are ad-hoc signed (Gatekeeper warns; not
  notarized). SHA-256 verification via `SHA256SUMS.txt` is the integrity
  mechanism.
- **AST-based static checks** (ts-morph): pattern checks only.

## v0.1.0-alpha.1 (2026-11-07)

First tagged alpha. The local CLI half of the MVP. **Not** included (see below):
the GitHub App, dashboard, gateway, skills — the PRD's "Rules as CI" enforcement
on pull requests does not exist yet; nothing gates a PR until the App ships.

### What works

- **`runtime init`** (F5.1, D11): scans a repo, ingests existing `CLAUDE.md` /
  `AGENTS.md` / `.cursor/rules` into `context/` + `rules/` (secret-gated,
  never overwrites, moves files that would conflict with generated output),
  and writes a DRAFT `project.yaml` for human review.
- **`runtime sync`** (F1.2, F1.3): compiles the definition into each target's
  native config with a diff preview, drift detection against a committed
  manifest (`.runtime/manifest.json`), atomic writes, and `--verify` for CI.
- **Three target adapters** (F1.1, D9): `claude-code` → `CLAUDE.md`,
  `cursor` → `.cursor/rules/runtime.mdc` (header after frontmatter),
  `copilot` → `.github/copilot-instructions.md`. Formats verified against
  official docs (`docs/agents-md-findings.md`).
- **`runtime check`** (F2.7, D13): static pattern checks (path-scoped,
  per-line regex with a cooperative time budget), secret scanning (redacted,
  D8), `--base <ref>` diff mode. LLM-judged checks (F2.2) run in diff mode
  through a fetch-based OpenAI judge with bounded retries and a USD budget
  ledger (D4) — every failure mode is `skipped`, never a pass.
- **`runtime join`** (F5.2): new-teammate setup — sync, verify, report what
  is missing; measured well under the 10-minute target (F5.3).
- **`project.yaml` spec v1** with schema validation, positioned errors,
  duplicate detection, and cross-field checks.
- **Standalone binaries** (Node SEA): linux-x64, macOS arm64/x64 (ad-hoc
  signed), windows-x64 — each smoke-tested in CI against the sample project.

### What is NOT included

- **GitHub App / PR enforcement** (F2 App side, ~7 dev-days designed in
  `docs/github-app-design.md`): nothing blocks a pull request yet; `runtime
  check` is local-only.
- **Dashboard** (F6): none.
- **Managed MCP gateway** (F4): Phase 2; `integrations:` validates but is
  inert (D7).
- **Skills** (F7), living context (F3): not started.
- **LLM-judged checks**: implemented and mock-tested; labeled
  **experimental, unverified live** — the live test needs an `OPENAI_API_KEY`
  and has not run against the real API yet.
- **Signed/notarized binaries**: Windows binaries are unsigned (SmartScreen
  warns), macOS binaries are ad-hoc signed (Gatekeeper warns; not
  notarized). SHA-256 verification via `SHA256SUMS.txt` is the integrity
  mechanism.
- **AST-based static checks** (ts-morph): pattern checks only.
## v0.1.0 (2026-11-07)

First stable-tagged CLI release. The local CLI half of the MVP: define once,
compile to every tool, detect drift, enforce locally. **Not** included (see
below): the GitHub App, dashboard, gateway, skills — "Rules as CI" enforcement
on pull requests does not exist yet; nothing gates a PR until the App ships.

### What works

- **`runtime init`** (F5.1, D11): scans a repo, ingests existing `CLAUDE.md` /
  `AGENTS.md` / `.cursor/rules` into `context/` + `rules/` (secret-gated,
  never overwrites, moves files that would conflict with generated output),
  and writes a DRAFT `project.yaml` for human review.
- **`runtime sync`** (F1.2, F1.3): compiles the definition into each target's
  native config with a diff preview, drift detection against a committed
  manifest (`.runtime/manifest.json`), atomic writes, and `--verify` for CI.
- **Three target adapters** (F1.1, D9): `claude-code` → `CLAUDE.md`,
  `cursor` → `.cursor/rules/runtime.mdc` (header after frontmatter),
  `copilot` → `.github/copilot-instructions.md`. Formats verified against
  official docs (`docs/agents-md-findings.md`).
- **`runtime check`** (F2.7, D13): static pattern checks (path-scoped,
  per-line regex with a cooperative time budget), secret scanning (redacted,
  D8), `--base <ref>` diff mode.
- **`runtime join`** (F5.2): new-teammate setup — sync, verify, report what
  is missing; measured well under the 10-minute target (F5.3).
- **`project.yaml` spec v1** with schema validation, positioned errors,
  duplicate detection, and cross-field checks.
- **Standalone binaries** (Node SEA): linux-x64, macOS arm64/x64 (ad-hoc
  signed), windows-x64 — each smoke-tested in CI against the sample project;
  verified on Windows (paths with spaces and non-ASCII characters, three
  shells, both `core.autocrlf` settings — `docs/TESTING.md`).

### What is NOT included

- **GitHub App / PR enforcement** (F2 App side, designed in
  `docs/github-app-design.md`): nothing blocks a pull request yet; `runtime
  check` is local-only.
- **Dashboard** (F6): none.
- **Managed MCP gateway** (F4): Phase 2; `integrations:` validates but is
  inert (D7).
- **Skills** (F7), living context (F3): not started.
- **LLM-judged checks**: implemented and mock-tested; labeled **experimental,
  unverified live** — the live test needs an `OPENAI_API_KEY` and has not run
  against the real API yet.
- **Signed/notarized binaries**: Windows binaries are unsigned (SmartScreen
  warns), macOS binaries are ad-hoc signed (Gatekeeper warns; not
  notarized). SHA-256 verification via `SHA256SUMS.txt` is the integrity
  mechanism.
- **AST-based static checks** (ts-morph): pattern checks only.

## v0.1.0-alpha.1 (2026-11-07)

First tagged alpha. The local CLI half of the MVP. **Not** included (see below):
the GitHub App, dashboard, gateway, skills — the PRD's "Rules as CI" enforcement
on pull requests does not exist yet; nothing gates a PR until the App ships.

### What works

- **`runtime init`** (F5.1, D11): scans a repo, ingests existing `CLAUDE.md` /
  `AGENTS.md` / `.cursor/rules` into `context/` + `rules/` (secret-gated,
  never overwrites, moves files that would conflict with generated output),
  and writes a DRAFT `project.yaml` for human review.
- **`runtime sync`** (F1.2, F1.3): compiles the definition into each target's
  native config with a diff preview, drift detection against a committed
  manifest (`.runtime/manifest.json`), atomic writes, and `--verify` for CI.
- **Three target adapters** (F1.1, D9): `claude-code` → `CLAUDE.md`,
  `cursor` → `.cursor/rules/runtime.mdc` (header after frontmatter),
  `copilot` → `.github/copilot-instructions.md`. Formats verified against
  official docs (`docs/agents-md-findings.md`).
- **`runtime check`** (F2.7, D13): static pattern checks (path-scoped,
  per-line regex with a cooperative time budget), secret scanning (redacted,
  D8), `--base <ref>` diff mode. LLM-judged checks (F2.2) run in diff mode
  through a fetch-based OpenAI judge with bounded retries and a USD budget
  ledger (D4) — every failure mode is `skipped`, never a pass.
- **`runtime join`** (F5.2): new-teammate setup — sync, verify, report what
  is missing; measured well under the 10-minute target (F5.3).
- **`project.yaml` spec v1** with schema validation, positioned errors,
  duplicate detection, and cross-field checks.
- **Standalone binaries** (Node SEA): linux-x64, macOS arm64/x64 (ad-hoc
  signed), windows-x64 — each smoke-tested in CI against the sample project.

### What is NOT included

- **GitHub App / PR enforcement** (F2 App side, ~7 dev-days designed in
  `docs/github-app-design.md`): nothing blocks a pull request yet; `runtime
  check` is local-only.
- **Dashboard** (F6): none.
- **Managed MCP gateway** (F4): Phase 2; `integrations:` validates but is
  inert (D7).
- **Skills** (F7), living context (F3): not started.
- **LLM-judged checks**: implemented and mock-tested; labeled
  **experimental, unverified live** — the live test needs an `OPENAI_API_KEY`
  and has not run against the real API yet.
- **Signed/notarized binaries**: Windows binaries are unsigned (SmartScreen
  warns), macOS binaries are ad-hoc signed (Gatekeeper warns; not
  notarized). SHA-256 verification via `SHA256SUMS.txt` is the integrity
  mechanism.
- **AST-based static checks** (ts-morph): pattern checks only.
