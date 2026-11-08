# Haversack — Product Requirements Document

**Version:** 0.3 (resets v0.2) · **Status:** Draft, pre-build · **Date:** November 8, 2026 · **Name:** Haversack is a working name, pending a trademark check

**Pitch:** Install your team's skills and MCP servers once. Everyone gets them with one click.

## 1. Summary

Haversack is a **Windows desktop app for sharing an AI agent setup across a team**. A team keeps a shared library of skills and MCP servers in a workspace. A teammate signs in and clicks Apply, and the app installs the skills and writes the MCP configuration for their agents, after showing exactly what will change. A new teammate gets an invite link and is ready in minutes, without installing or wiring up each tool by hand.

Supabase is the team backend. The app also works alone, on one machine, with no account.

### What changed from v0.2

| v0.2 | v0.3 | Why |
| --- | --- | --- |
| Product was a rules and drift control plane, with a CLI first | Product is a team workspace for skills and MCP servers, with a desktop app first | v0.2 drifted from the original idea. The CLI never delivered install and share. |
| PR enforcement via a GitHub App was the wedge | Shelved. Revisit only if customers ask for it. | It is not what the product is for. |
| Rules-as-CI, drift manifest, and a secret gate were the features | They become engine components inside the app | The safe-writing code is reusable. |
| LLM was a PR-check judge | In-app LLM is not in v1. Provider settings come later. | The agents the team already uses are the LLMs. |
| MCP gateway was the moat | Later phase, behind a security design review | It holds other people's credentials. |

## 2. Problem

Every person on a team, and every new project, repeats the same setup:

- Find and install the skills.
- Add and configure each MCP server.
- Paste API keys into the right config files.
- Do it again for a new teammate, a new machine, or a different agent.

The result is that teammates' agents behave differently, new joiners lose hours, and nobody knows who has what installed.

## 3. Users

- **Admin (team lead):** curates the shared library and decides what the team's agents get.
- **Member:** applies the team setup and keeps it up to date.
- **New joiner:** opens an invite link and gets a working setup quickly.

**Beachhead:** small dev teams (2 to 15 people) already using AI coding agents, with agencies and consultancies as the first target. They have many projects and rotating people, so setup cost repeats constantly.

## 4. Competitive landscape

Based on each project's README as of November 2026. Not exhaustive, and subject to change.

| Project | What it does | Team features |
| --- | --- | --- |
| kaiopiola/Loadout | Cross-platform desktop app that discovers, installs, and manages skills, agents, and MCP servers, with an MCP connection test before saving | None stated |
| AxeForging/loadout | CLI that keeps agent configs in one git-friendly store and installs them into each agent's home, with a drift matrix and snapshots | Bundle export and import |
| VirajMishra1/loadout | CLI that manages skills and MCP across many agents from a curated catalog, with handoff between agents | Catalog sharing |
| cuecards (cue-ai) | Per-directory profile manager that materializes into several tools' native formats | Optional marketplace |

**Honest read:** installing skills and MCP servers into agents is already done by others, with more breadth than we will have at first. The gap is a **live team workspace**: roles, invites, a shared library that stays in sync, and one-click apply for a new teammate. That gap is real but thin. It must be validated with real teams before large investment (Section 14).

## 5. Core concepts

- **Workspace:** a team. Has members with roles.
- **Library:** the workspace's shared skills and MCP server definitions.
- **Bundle:** a named selection from the library (for example "Frontend team").
- **Project:** a repository linked to a bundle.
- **Target:** an agent the app can configure (first one chosen in Section 6).
- **Apply:** the operation that installs a bundle into a person's targets. Always previewed, always undoable.
- **Local profile:** per-person secrets and settings, stored only on that machine.

## 6. Scope

### v1 (MVP)

**Local mode (no account needed):**

- L1. Inventory: show the skills and MCP servers already configured for the supported target.
- L2. Add a skill from a folder, a zip file, or a git URL.
- L3. Add an MCP server definition (command, arguments, environment variables as placeholders).
- L4. Preview a diff of every change before it is written. Apply, with a snapshot so it can be undone.
- L5. Uninstall only what Haversack installed.
- L6. Secrets: definitions hold placeholders. The person enters real values once, stored with Windows-protected storage and never written to shared data.
- L7. Optional MCP connection test, with the exact command shown and approved first.

**Team mode (Supabase):**

- T1. Sign in (email and password).
- T2. Workspaces with roles: owner, admin, member, viewer.
- T3. A shared library, synced to every member's app.
- T4. Bundles.
- T5. Invite links: expiring, role-limited, sign-in required, revocable, never containing credentials.
- T6. One-click Apply of a bundle on any member's machine.
- T7. Status: who is up to date, who is behind, which items changed.
- T8. Audit log of who published or changed what.

### Later

- Project binding: link a repo to a bundle so the app suggests applying it when the repo is opened.
- More targets (see below), added only after verifying each agent's real formats.
- LLM provider settings: API key, an OpenAI-compatible endpoint (which covers most local LLM tools), or a connected provider if its docs allow third-party use. Used only by optional features such as drafting a skill. Not in v1.
- Managed credential gateway, only after a security design review.
- macOS and Linux, auto-update, code signing.

### Targets

The first target is **Claude Code**, with its skill and MCP formats verified from official documentation before any code is written. The second target is chosen by the product owner after the first works. Every target is added only from verified, cited formats. If an agent offers an official command for adding MCP servers, prefer it over editing its files directly.

### Non-goals for v1

Chat workspace or in-app agent, public marketplace, credential vault or gateway, PR enforcement, GitHub App, in-app LLM, macOS or Linux builds, auto-update.

## 7. Security and threat model

The central risk is simple: **a shared MCP server definition runs a command on every teammate's machine, and a shared skill steers every teammate's agent.** A compromised or malicious library item is remote code execution or prompt injection at team scale. The design assumes this threat first.

| Threat | Mitigation |
| --- | --- |
| A malicious or compromised MCP definition runs arbitrary commands on teammates' machines | Only admins and owners can publish. Every new or changed command is shown in full and must be approved on each machine before it is written. Changed commands never auto-apply. Items can pin versions and content hashes. |
| Malicious skill content (prompt injection, hidden instructions, exfiltration text) | Content scanning on add and on every change. The diff is shown before apply. Skills are plain files, never executed by the app. |
| Unsafe archives and paths (zip-slip, symlinks, absolute paths) | Reuse the existing path-escape protections. Extract only to a controlled folder. Reject symlinks and traversal. Tests with hostile archives. |
| Secrets uploaded to the team backend | Definitions store placeholders only. The secret scan runs on every payload before upload. The backend has no column for credentials. |
| Cross-workspace data access | Row-level security on every table, default deny, tested with two real users. |
| Service-role key in the app | The key is never present. The app uses only the public anon key and the user's own session. |
| Session token theft | Sessions are stored with Windows-protected storage and fail closed. Sign out wipes them. The limits of that protection are documented. |
| Hostile Supabase URL during sign-in | HTTPS required, the host is displayed prominently, and the person confirms before signing in. |
| Invite link abuse | Single-purpose, expiring, role-limited, revocable. A link grants only a workspace role, never credentials. |
| Supply chain via git or URL skill sources | Pinned commits and hashes. Visible source on every item. The first fetch is confirmed. |
| Electron-specific risks | Follow ADR 001 rev 2: sandboxed renderer, strict CSP, validated IPC, fuses, and all network calls in the main process. |

## 8. Architecture

- **Desktop shell:** Electron, Windows x64, per ADR 001 rev 2. Core logic runs in a utility process with timeouts, not in the main process.
- **Engine (reused from the existing CLI):** atomic writes, snapshots and undo, path-escape protection, the secret gate, and the content-hash drift model. It is extended with a library-item model, an install planner that produces a preview, and an applied-items record so uninstall removes only what was installed.
- **Backend:** Supabase Postgres and Auth, with row-level security. Each team uses its own Supabase project and applies a supplied SQL bundle once. Teammates enter only the project URL and the public anon key.
- **Data stored:** workspaces, members and roles, library items (definitions with placeholders), bundles, projects, invites, apply-status records, an append-only audit log. **Never stored:** credentials, secret values, or personal environment values.

## 9. Metrics

| Metric | Target |
| --- | --- |
| Time for a new teammate from invite to a working setup | Under 5 minutes |
| Apply success rate | Over 95 percent |
| Share of members up to date after a library change | Over 80 percent within a day |
| Weekly active teams | Tracked from the first design partner |
| Items per workspace | Tracked as an engagement signal |

## 10. Roadmap

Estimates are for one developer, with low to medium confidence. The main things that would push them higher are agent format changes, Windows installer problems, and the Supabase tests.

| Phase | What | Estimate |
| --- | --- | --- |
| 0 | Preflight: free disk space on C:, install WSL2 and Docker, set up local Supabase | 1 to 2 days |
| 1 | Verify target formats from official docs, write the target ADR | 2 to 3 days |
| 2 | Engine extension: library items, planner, snapshots and undo, hostile-input tests | 1 to 2 weeks |
| 3 | Desktop app, local mode (L1 to L7), installer, real screenshots | 2 to 3 weeks |
| 4 | Supabase schema, row-level security, database tests | 1 to 2 weeks |
| 5 | Team mode (T1 to T8), with two-user end-to-end tests | 3 to 4 weeks |
| 6 | Project binding, second target, prerelease | 2 to 3 weeks |
| Later | LLM provider settings, gateway design review, signing | Unscheduled |

## 11. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Competitors add team features | Medium | Ship team mode early. Validate with real teams first. |
| Agent config formats change | High | Verify from official docs, isolate each target behind an adapter, add contract tests, keep the target list small. |
| A shared definition is used to attack teammates | Medium | Section 7: publish roles, per-machine approval, hashes, scanning. |
| People still must enter their own credentials | Certain in v1 | State it plainly. A managed gateway is a later, reviewed phase. |
| Unsigned installer shows SmartScreen warnings | Certain | Document it. Decide on signing later. |
| Thin differentiation against existing tools | Medium | Validate the team workspace gap in Section 12 before building Phase 4 and 5. |
| Local disk space on the development PC | Present | Fix before Phase 0 completes. Keep caches and builds on D:. |

## 12. Validation plan

1. After Phase 3, show local mode to 3 to 5 real teams and watch them add a skill and an MCP server.
2. Ask directly: would your team use a shared workspace, and who would pay?
3. Do not start Phases 4 and 5 until at least two teams say yes and describe the team workflow in their own words.
4. After Phase 5, run a real two-person test: one publishes, one applies, with timing.

## 13. Open questions

1. Which agent is the second target, after Claude Code?
2. Free for small teams, with pricing for larger ones, or paid from the start?
3. Does the existing CLI stay as a separate developer tool, or become only the engine inside the app?
4. Final name, after the trademark check.
5. Open source, and under which license, for the engine and the app? **Answered 2026-11-08:** the repository is public on GitHub; everything is MIT (the license was already decided).
6. When the in-app LLM arrives, which providers come first?

## 14. What carries over from v0.2

**Reused:** schema validation approach, atomic writes, path-escape protection, the secret gate, content hashing, the test and CI setup, the Electron ADR, the MIT license decision.

**Shelved:** the GitHub App, PR enforcement, rules-as-CI as a product feature, the check engine as a headline, the share-by-link gateway vision until the gateway design review.
