# Haversack build program (v0.3)

Source of truth: docs/PRD.md (v0.3). Progress ledger: docs/PROGRESS.md. The product is a Windows desktop app where a team shares a library of skills and MCP servers through a Supabase workspace, and a teammate applies it with one click. It is NOT a rules or PR-enforcement tool, and it is NOT a chat workspace.

## Session protocol (every session, in this order)
1. Read this file, docs/PRD.md, docs/PROGRESS.md, docs/AUDIT.md, docs/BUGS.md, and the ADRs.
2. Run git status, git log --oneline -10, confirm local main = origin/main and CI is green. Report in 5 lines.
3. Continue at the first unfinished milestone. Stop at every STOP gate.
4. Before ending (including on any stop condition), update docs/PROGRESS.md: per milestone Done / In progress / Blocked / Not started, with evidence (commit hash + test name or output), the next action, and what I must provide.
5. If you notice you are guessing or repeating yourself, update PROGRESS.md and stop. Stopping early is fine; fabricating progress never is.

## Standing rules
- Evidence or it didn't happen: every "done" claim cites a file + test name or pasted command output.
- Truth rule for all public text (README, CHANGELOG, UI copy, release notes): claim only what is proven. Anything not built is listed as not built.
- Small commits. After each milestone: pnpm typecheck + tests with real output, update docs/PROGRESS.md and docs/AUDIT.md, 5-line checkpoint (done / decided / pending / risks). Continue automatically only if tests pass and CI is green on windows-latest and ubuntu. STOP gates always wait for my reply.
- Stop and report instead of retrying if: a command runs >5 minutes, the same failure happens twice, you need credentials or input you lack, or you are unsure an external fact is correct. No milestone may exceed 45 minutes.
- Never invent external facts. For every agent target (skill and MCP formats, install locations, any official CLI), Supabase (Auth, RLS, test tooling), Electron, and Windows credential storage, read the current official docs and cite them in the ADR. Otherwise mark "blocked: needs verification".
- Secrets: I never paste keys into chat. Environment variables and git-ignored .env files only. Never print, log, commit, or upload a key. Test against LOCAL Supabase only; never touch a cloud project.
- Bug policy: failing regression test first, root-cause fix, a guard against the whole class of bug, entry in docs/BUGS.md.
- Security-sensitive work needs a written threat model and adversarial tests for each threat; the gate does not pass with untested threats.
- No force pushes. Repo stays PRIVATE. Ask before adding any dependency (name, size, why) or using any paid service.
- Disk: TEMP, caches, clones and build output go on D:. Report C: free space at the start and end of each milestone; stop if C: drops below 1 GB.
- gh/git authorization: push commits to main, create and delete throwaway test tags and releases, create a release tag only after I say "ship it". Every release is a PRERELEASE (hyphenated tag).
- Do NOT work on: renaming, the GitHub App, PR enforcement, rules-as-CI features, the MCP gateway, an in-app LLM, auto-update, macOS/Linux. Those are shelved by the PRD.
- Proof of work: for every claim, paste the RAW command output (including the exit code), not a summary. A claim without raw output counts as not done.
- Run tests and builds yourself before reporting. Never report a test count you did not just see in the output.
- Wall-clock limit: if any single step has produced no tool output for about 10 minutes, stop and report what you were doing.
- At the end of each milestone, list the 3 riskiest decisions you made and the 3 things you are least sure about.
- Security-critical work (P2 adversarial tests, P4 RLS and database tests, anything handling secrets or running commands from shared definitions): after tests pass, write docs/REVIEW_<phase>.md containing the exact diff paths and test names so an independent reviewer can check them.

## Phases

### P0: Reset and preflight
- Move the old PRD and decision log to docs/archive/ (do not delete). Confirm docs/PRD.md is v0.3 (header says "Version: 0.3"); if it is not, STOP and tell me.
- Create docs/PROGRESS.md from this phase map. Update README status banner to state plainly what exists today and that the desktop app, skills and MCP management, and team workspace are not built yet.
- Report: node/pnpm versions, Docker/WSL status (not needed until P4), C: and D: free space.
- Keep the working name "Haversack" in new text only where needed; do not run a rename. STOP and report.

### P1: Target research (STOP for approval)
Write docs/adr/003-targets-and-install-mechanics.md for the FIRST target, Claude Code, from official documentation only (cite every claim): where skills live (user and project scope), the skill format, where MCP server config lives (user, project, local scope), whether an official CLI command exists for adding or removing MCP servers (prefer it over editing files directly), how changes take effect, what must never be overwritten. Define the adapter interface so a second target is one isolated adapter. Also list what each action writes, where, and how it is undone. Include a threat model for the install actions (see PRD section 7). Wait for "approved".

### P2: Engine extension (packages/core, tests first)
Library-item model (skill, mcp) with placeholders for secrets; install planner that returns a previewable plan (diff) without writing; apply with snapshots and undo; an applied-items record so uninstall removes only what we installed; adapter for the first target per ADR 003; skill ingestion from folder, zip, and git URL with pinned commit and content hash.
Adversarial tests (each must exist and pass): zip-slip and path traversal, symlinks and junctions, absolute paths, oversized or binary payloads, secret literals in definitions (blocked, redacted in all output), prompt-injection text in skill content (flagged), crash mid-apply (atomic, snapshot intact), undo after partial failure, uninstall refuses to touch items we didn't install, MCP command definitions that change between plan and apply (rejected).
Gate (STOP): checklist with evidence.

### P3: Windows desktop app, local mode (no account)
Base: docs/adr/001-desktop-architecture.md rev 2 (Electron; renderer sandboxed; core runs in a utility process; no auto-update; assisted installer; all security decisions as written there). Pause and ask me about the app identity constant (name) before building the installer.
Screens: inventory of installed skills and MCP servers for the target; add skill (folder, zip, git URL); add MCP server (command, args, env placeholders); plan preview showing exact files and exact commands; apply; undo; uninstall ours only; first-run entry of secret values stored with Windows-protected storage (fail closed if unavailable); optional MCP connection test that shows the exact command and requires approval each time.
Empty/loading/error states, keyboard accessible, light and dark.
Installer: install, run, upgrade, uninstall verified on this PC with pasted evidence, including that uninstall leaves no stored secrets behind.
Capture REAL screenshots of the running app into docs/assets/app/ (ask before adding automation dependencies). No mocks or fake demo data.
Gate (STOP): checklist with evidence; wait for "ship it" (prerelease). Then STOP and wait for my validation notes: PRD section 12 requires showing local mode to real teams before P4.

### P4: Supabase schema and RLS (needs Docker; I install WSL2 and Docker myself)
ADR first (STOP): data model, RLS strategy, what is stored (definitions with placeholders, bundles, membership, invites, status, audit log) and what is NEVER stored (credentials, secret values). Then migrations under supabase/migrations/, a generated supabase/setup.sql bundle, docs/DATABASE.md. Tables: workspaces, workspace_members (owner/admin/member/viewer), library_items, bundles, bundle_items, projects, invites, apply_status, audit_log (append-only: policy + trigger).
Database tests (STOP after they pass): user A cannot read or write user B's workspace; viewers cannot write; only admins and owners can publish or change library items; members cannot manage members; invites are single-use, expiring and revocable; audit_log cannot be updated or deleted by anyone; anonymous gets nothing; `supabase db reset` from empty works; setup.sql applies to an empty database. Paste results.

### P5: Team mode in the app
Connect screen (HTTPS only, host displayed and confirmed, anon key only; validates migrations are applied), sign in, workspaces and roles, shared library synced to the app, bundles, invite links (create, redeem, revoke; never containing credentials), one-click apply of a bundle, status (who is behind, which items changed), audit log view. Per-machine approval for every new or changed MCP command or skill content before it is written; changed items never auto-apply. Sign out wipes the stored session. A build-time test fails if a service-role key pattern appears in the app bundle or installer. The secret gate runs on every payload before upload.
End-to-end on this PC with local Supabase: two users in two workspaces, publish as admin, apply as member, confirm no cross-workspace leakage; REAL screenshots; timing of invite-to-working-setup (report it honestly, with what was and was not included in the measurement).
Gate (STOP): checklist, then wait for "ship it" (prerelease).

### P6: Second target and project binding (after I name the second target)
Same process as P1 for the second target (ADR first, citing docs). Project binding: link a repo to a bundle; the app suggests applying it when the repo is opened.

### Later (each its own session with its own gate, only when I ask)
LLM provider settings (API key, OpenAI-compatible endpoint, connected provider only if its official docs allow third-party use), gateway design review, code signing, macOS and Linux.

## Final report format (end of every phase)
What is done (with evidence), what is not, bugs found (docs/BUGS.md), what I must provide or do, everything unverified, and the next phase.