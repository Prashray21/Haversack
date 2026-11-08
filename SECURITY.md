# Security Policy

## Supported versions

The project is pre-1.0: only the latest `main` branch and the most recent release tag receive security fixes.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability") on this repository. Please do not open a public issue for anything you believe is exploitable.

- Triage target: **72 hours**.
- Include reproduction steps, the affected component (desktop app / CLI / engine), and, if possible, a minimal reproduction.

## Design boundaries you can rely on

The central threat is stated in [PRD §7](docs/PRD.md): a shared MCP definition runs commands on teammates' machines, and a shared skill steers their agent. The mitigations below are implemented and tested — regressions are treated as bugs with a failing test first (see [docs/BUGS.md](docs/BUGS.md)).

**Install engine (`packages/core`)**

- Skill ingestion rejects path escapes (absolute, `..`, backslashes, drive paths), symlinks/junctions, binary and oversized payloads, and invalid names; zip entry names are validated before decoding (zip-slip).
- Secret literals in library items are **blocked** at ingest, at plan preview, and before any upload — findings are always **redacted**; a matched value is never printed, logged, or stored.
- Library items carry placeholder NAMES only; real values never enter the library or the backend.
- Apply re-verifies the exact plan-time target state before writing (plan→apply drift aborts with nothing written) and writes each file atomically (temp+rename).
- Uninstall and undo touch only items proven by the content-hashed applied-items ledger; user-modified files are refused (`force` required).

**Desktop app (`apps/desktop`, per [ADR 001](docs/adr/001-desktop-architecture.md) rev 2)**

- Sandboxed renderer: `contextIsolation` on, `nodeIntegration` off, strict CSP (headers + meta), navigation and window-open locked down, DevTools closed when packaged, no telemetry/crash uploads.
- All engine work runs in a utility process killed on timeout; the renderer has a fixed, zod-validated IPC surface only.
- Secret values are stored with Windows-protected storage (safeStorage/DPAPI), never sent to the renderer, and the app **fails closed** (memory-only) if protection is unavailable.
- The MCP connection test shows the exact command and requires approval every run.
- No auto-update: download installers from Releases and verify the SHA-256 (unsigned builds show a SmartScreen warning).

**Known residuals** are documented per phase (currently `docs/REVIEW_P2.md` §4), including: shared skill content is data to this app but instructions to the agent — review the flagged diff before installing anything from a source you do not trust.
