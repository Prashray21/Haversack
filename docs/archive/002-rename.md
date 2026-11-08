# ADR 002 — Rename "Project Runtime" → "Haversack"

**Status:** Proposed — awaiting owner approval (STOP gate)
**Date:** 2026-11-07
**Basis:** N0 name check (reported 2026-11-07; Toolroll failed check 1 — npm
product `toolroll@0.9.93` in the same space ships a `toolroll` bin + brew tap;
fallbacks evaluated). Owner confirmed: **name confirmed: Haversack**, with the
specifics below.

## 1. Identity decisions

| Item | Decision | Justification |
| --- | --- | --- |
| Product name | **Haversack** | Owner-confirmed after the N0 matrix (clean PATH everywhere, no dev-tool namesakes, `haversack.dev` the only likely-free domain of all candidates). |
| Binary name | `haversack` | Per owner. **No short alias** — the owner's rule permits one only after collision checks + justification; a 9-char binary needs no alias, and an alias doubles the SEA release matrix (4 → 8 assets) and keeps two names alive. Decision: no alias. |
| Deprecated `runtime` alias for one release | **NO** | There is nothing to alias for: no npm package is published (distribution = GitHub release binaries + SHA256SUMS only), and the user population holding v0.1.0 binaries is the owner (AUDIT: design partners "Not started"). An alias would ship 8 binaries per release instead of 4 to serve zero users. Stated explicitly: if a real user base existed at rename time, a one-release alias would be mandatory. |
| npm publishing | **Nothing is published to npm — in this rename or now.** | Current distribution is GitHub release binaries only (`docs/AUDIT.md` §3). The workspace package names are internal identifiers. |
| Package scope | `@runtime/*` → **`@haversackhq/*`** | An npm scope must equal an npm user/org name. The unscoped `haversack` package is taken; whether the *org* name `haversack` is free is UNVERIFIED (npmjs.com returns 403 to programmatic checks — N0 finding). Since nothing publishes, the scope is cosmetic: pick the name that is collision-free by construction and future-proof. `@haversackhq/core` + `@haversackhq/cli`. If npm publishing is ever approved, the org choice is re-verified then. |
| Root package name | `project-runtime` → `haversack` | Private, unpublished; cosmetic consistency. |
| Manifest dir | `.runtime/` → **`.haversack/`** | Migration design §3. |
| Spec key | `runtime: 1` → **`haversack: 1`**; legacy `runtime: 1` accepted with a deprecation warning | §3.5. |
| Cursor rule file | `.cursor/rules/runtime.mdc` → **`.cursor/rules/haversack.mdc`** | Legacy-file removal policy §3.4 (Cursor loads every `.mdc` as always-on — a leftover file would double the rules; per `docs/agents-md-findings.md`). |
| Env prefix | **`HAVERSACK_` reserved.** Verified today: the only env var read in src is `OPENAI_API_KEY` (third-party, unchanged); **no legacy env prefix exists to migrate** (grep 2026-11-07). | — |
| Secret allow marker | `runtime:allow-secret` → `haversack:allow-secret`; **legacy marker honored indefinitely** (line comments in user files; no forced cleanup) | §3.6 |
| GitHub repo | `Prashray21/project-runtime` → `Prashray21/haversack` | N5, owner-authorized (gh may rename). Local remote updated the same day. Existing tags/releases stay as history. |
| Release assets | `runtime-{linux-x64,macos-arm64,macos-x64,windows-x64}[.exe]` → `haversack-*` | `release.yml` (4 assemble steps), `SHA256SUMS.txt` entries, `ci.yml` binary-smoke + dogfood job command names, `scripts/sea/`. `scripts/sea/sea-config.json` carries no product name (verified). |

## 2. Complete rename map (live grep inventory, 2026-11-07, node_modules/dist excluded)

Word `\bruntime\b` counts by area: `packages/core/src` 26 · `packages/core/test` 46 · `packages/cli/src` 30 · `packages/cli/test` 49 · `scripts` 9 · `docs` 58 · `.github` 54 · `examples/sample-project` 13. Zero `toolroll` strings exist in the repo (verified: grep = 0).

| # | Surface | Files |
| --- | --- | --- |
| 2.1 | Package names + imports | `packages/core/package.json`, `packages/cli/package.json` (`@runtime/cli`, `@runtime/core`, dep `workspace:*`); import specifiers in `packages/cli/src/commands/{check,init,join,sync}.ts` |
| 2.2 | CLI bin + program name | `packages/cli/package.json` `"bin": { "runtime": … }`; `packages/cli/src/main.ts` `.name("runtime")` |
| 2.3 | Manifest dir | `packages/core/src/constants.ts`, `packages/core/src/{parse/load.ts,parse/write.ts,llm/ledger.ts}`, `packages/cli/src/commands/{sync,check,init,join}.ts`, tests (`check/sync/files/schema`), `docs/{PRD,TESTING,github-app-design}.md` |
| 2.4 | Generated header | `packages/core/src/adapters/header.ts`, `packages/core/src/constants.ts`; tests `claude-code.test.ts`, `sync.test.ts`; live artifacts in `examples/sample-project/` (CLAUDE.md, `.cursor/rules/runtime.mdc`, `.github/copilot-instructions.md`) |
| 2.5 | Spec key | `packages/core/src/schema/project.ts` (zod), `examples/sample-project/project.yaml`, PRD §6 example |
| 2.6 | Cursor adapter output path | `packages/core/src/adapters/cursor.ts`; tests `cursor.test.ts`, `sync.test.ts`, `join.test.ts` |
| 2.7 | Secret marker | `packages/core/src/secrets/scan.ts`; `README.md`, `docs/{AUDIT,PRD}.md`, cli tests; 9 marked lines in this repo |
| 2.8 | Workflows | `.github/workflows/{ci,release}.yml` (asset names, job steps, dogfood/binary-smoke commands) |
| 2.9 | Scripts | `scripts/{render-terminal,check-links,license-report,scan-secrets,write-version,gh-api}.mjs` (labels, paths, asset names) |
| 2.10 | Docs | `README.md` (+ badges + transcripts), `docs/{PRD,BUGS,TESTING,AUDIT,agents-md-findings,github-app-design,dependency-licenses}.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/adr/001` (§11 identity) |
| 2.11 | Examples | `examples/sample-project/` — stays a **legacy-shape fixture** for the migration (it has `.runtime/manifest.json`, `runtime: 1`, legacy headers); N4b migrates it for real |
| 2.12 | Desktop ADR identity | `docs/adr/001-desktop-architecture.md` §11 `APP_IDENTITY` — values applied **only after the N5 gate** (§6) |

**History policy:** `CHANGELOG.md` v0.1.0/v0.1.0-alpha.1 sections and quoted strings in `docs/BUGS.md` keep the historical name verbatim (history is not rewritten); the new v0.2.0-alpha.1 section documents the rename. Prose elsewhere updates outright.

## 3. Migration design (legacy repo → new names, one `haversack sync`)

Principle: content hashes are BOM-stripped, LF-normalized, and computed over file content — **the rename does not change any file's content hash**, so manifest states carry over 1:1 and a migrated file can never be misclassified as hand-edited. No repo state is destroyed; every write stays atomic (BUG-005 machinery); any I/O failure takes the normal sync error path (exit 1) with legacy state untouched.

1. **Legacy manifest adoption.** If `.haversack/manifest.json` is absent and `.runtime/manifest.json` exists: load the legacy manifest, adopt its entries verbatim (paths + hashes), write the new manifest atomically, then **only after a successful write** delete `.runtime/` (dir). If both exist (crash between the two steps): prefer `.haversack/`, warn "legacy .runtime/ leftover", remove it after the next successful sync.
2. **Legacy headers are still "ours".** `hasGeneratedHeader` accepts BOTH `GENERATED BY RUNTIME — DO NOT EDIT` and `GENERATED BY HAVERSACK — DO NOT EDIT`, with the same anchored matching and comment-opener rules (BUG-002 guards) — spoof tests must pass for both headers. A legacy-headered file whose content still matches its manifest hash is **ours and stale** (header text changed) → regenerated with the new header in that same sync; it is never reported as hand-edited.
3. **Hand-edited legacy files stay protected.** Content differs from the manifest hash → `hand-edited`, skipped without `--force`, exactly as today. The rename must not reclassify hand-edited as stale. (N2 test.)
4. **Cursor legacy output removal.** When writing `.cursor/rules/haversack.mdc`, sync checks the legacy `.cursor/rules/runtime.mdc`: present + tracked in the adopted manifest + hash matches → delete the file and drop the entry, logging `migrated: removed legacy .cursor/rules/runtime.mdc`; present + hand-edited (hash differs) → **not deleted**, warning surfaced ("delete manually or re-run sync --force"); present + untracked → header rule (2) decides. Rationale: Cursor treats every `.mdc` as always-on, so an orphan would double the rules.
5. **Spec key.** zod schema: `haversack: 1` (new) and `runtime: 1` (legacy, value must be 1) both load; legacy emits a deprecation warning on load ("rename `runtime:` to `haversack:` in project.yaml — legacy key support will be removed in a future release"). `runtime: 2`, `haversack: 2`, unknown versions, or **both keys present** → config error, exit 2 (D6 semantics; both-present is ambiguity, refused rather than guessed). `haversack init` always writes `haversack: 1` and never silently rewrites an existing legacy key — it reports the deprecation.
6. **Secret marker.** Both markers accepted forever.
7. **Budget ledger.** `.runtime/budget.json` → `.haversack/budget.json`, contents migrated verbatim on first use (same JSON shape; UTC-month semantics unchanged).
8. **Not migrated automatically:** git remote URL (N5), git history, README prose (N3 re-renders from real runs).

## 4. Implementation order (N2, tests first — the owner's contract)

Failing/regression tests written before the code change:
1. legacy-manifest repo syncs cleanly to `.haversack/` (states preserved, `.runtime/` removed);
2. hand-edited legacy file → reported as drift, never overwritten;
3. header-spoof tests pass with **both** headers;
4. legacy `runtime: 1` accepted with a deprecation warning; `haversack: 1` written by init; both-keys/unknown-version → exit 2;
5. cursor legacy file: removed when ours, kept + warned when hand-edited;
6. budget-ledger migration; 7. `haversack --version`/help text. 
Then the mechanical rename per §2, then the repo-wide old-name search pasted into the N2 report (generic "runtime" in unrelated prose is acceptable and listed as such).

## 5. N3 (README/PRD) scope

Tagline **"Connect your project once. Share it with a link."** + "## Why Haversack" section right after the status banner, "That's where Haversack is going." — existence/not-built lists filled ONLY from `docs/AUDIT.md` at that moment; FAQ answer per Appendix B; PRD §3 addition per Appendix A; all terminal transcripts/SVGs regenerated from REAL `haversack` runs; architecture diagram updated; every command/flag re-verified against `haversack --help`; link checker run.

## 6. Sequencing with N5 and the desktop track

N5: repo rename → local remote update → CI green on the final commit → gate checklist → **STOP for "ship it"** → prerelease **v0.2.0-alpha.1**. After N5 approval: ADR 001 §11 `APP_IDENTITY` is filled from the confirmed name with these **proposed** values (owner confirms at that point): `appId: io.github.prashray21.haversack` (reverse-DNS of a namespace we actually control — `haversack.dev` is RDAP-404 but unpurchased, and an appId must not squat a domain we don't own), `productName: "Haversack"`, `exeName: haversack-desktop.exe` (distinct from the CLI's `haversack.exe`), `userDataDirName: "Haversack"`. Desktop track then reports and still awaits "so" before A2.

## 7. Release-history proposal (propose now, do only at N5 with authorization)

Add one paragraph at the top of the existing **v0.1.0** GitHub release body: "Project Runtime has been renamed to **Haversack**; development continues at Prashray21/haversack. The v0.1.0 `runtime` binaries keep working; the binary name is retired without an alias (see docs/adr/002-rename.md)." Existing tags/releases remain untouched history.

## 8. Effort

N2 rename+tests ≈ 1–1.5 d · N3 docs ≈ 1 d · N4 verify ≈ 0.5 d · N5 rename+release ≈ 0.5 d → **≈ 3–3.5 d total**.

## Appendix A — PRD §3 addition (owner-corrected; applied at N3)

> **Agent-config aggregators (loadout, cuecards, and similar — based on each project's README as of 2026-11-07):** these tools maintain a store or catalog of skills, MCP servers, and agent instructions and install or materialize them into each tool's native formats — cuecards materializes a per-directory `profile.yaml` into roughly ten tools' native configs; loadout installs artifacts from a git-friendly store into agent home directories and shows a per-artifact drift matrix with confirm-before-apply gates. Their breadth is real — curated catalogs, more agent targets, agent-to-agent handoff — none of which this product has. The difference is where the definition lives and what is enforced: here the project's context and rules are defined **in the repo** (`project.yaml`), compiled into each target's config with a **committed** drift manifest that CI gates on via `sync --verify` (exit 1) — an aggregator's install state is machine-local — and project-defined deterministic checks (pattern rules, severities, exit codes 0/1/2/3) plus a secret gate on repo content run locally. PR enforcement (GitHub App) and the share-by-link team layer are not built (roadmap B; §19 D14).

## Appendix B — README FAQ answer (owner-corrected; applied at N3)

> **How is this different from loadout / cuecards?** (Based on each project's README as of 2026-11-07.) They aggregate ready-made skills, MCP servers, and agent configs from catalogs and install or materialize them into your tools — cuecards turns a per-directory profile into ~10 tools' native configs; loadout syncs a git-friendly store into each agent's home directory with a per-artifact drift matrix and confirm-before-apply gates. That breadth — curated catalogs, 10–12 agent targets, agent handoff — is beyond anything here. Haversack starts from a different question: what does this project itself say, and is every tool actually following it? The definition lives in your repo (`project.yaml` + `context/` + `rules/`); sync compiles it into each target's config; the **committed** manifest detects hand-edits and `sync --verify` exits 1 so CI can gate on it — an aggregator's install state is machine-local. `haversack check` enforces project-defined pattern rules (block/warn/info severities, exit codes 0/1/2/3) and the secret gate scans repo content with redacted findings. PR enforcement (the GitHub App) and the share-by-link team layer are **not built** — see the not-built list.
