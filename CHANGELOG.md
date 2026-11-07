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
