# REVIEW P2 — engine extension (security-critical review guide)

**Status:** P2 gate artifact. Written after all P2 tests pass (evidence in the P2 gate checklist).
**Purpose:** an independent reviewer can check every security-relevant change and its tests
without reading this codebase first. Standing rule: "after tests pass, write docs/REVIEW_<phase>.md
containing the exact diff paths and test names".

## 1. What P2 built (one paragraph)

The library/ install engine for the Haversack desktop app (PRD v0.3): a **library-item model**
with placeholder-only secret values and canonical content hashes; **skill ingestion** from
folder / zip / pinned-commit git URL as a security boundary (path escapes, symlinks, binary and
oversize payloads, and secret literals are rejected here; injection-shaped content is flagged);
a **pure install planner** per target adapter (exact destination paths, exact JSON, exact
`claude mcp` argv — never writes); and **apply / undo / uninstall** with plan-to-apply
re-verification, per-file atomic writes, pre-apply snapshots, and an applied-items ledger that is
the only proof of "we installed this". Design decisions and citations: docs/adr/003 §1–§5.

## 2. Exact diff paths (P2 commits `3cb7f7b`, `e0a1e9b`, `72235d2`, `5ecdfe5`)

| Path | Role | Review focus |
| --- | --- | --- |
| `packages/core/src/library/item.ts` | item model: names, file paths, env placeholders, content hashes | path validation (`validateSkillFilePath`), reserved names, strict env schema (`{ placeholder }` only — a bare string or extra key fails), hash canon |
| `packages/core/src/library/ingest.ts` | ingestion boundary: folder walk, zip decode (fflate), git clone+checkout | symlink rejection before read, zip entry-name validation, binary/NUL + UTF-8 fatal decode, size caps, secret-scan blocking with redacted output, `.git` exclusion, error mapping |
| `packages/core/src/install/claude-code.ts` | pure planner + paths for the first target | plan-time name re-validation (tampered item defense), before-hash capture, corrupt-config refusal (`config_unreadable`), placeholder-vs-inline secret policy (project scope NEVER inlines; user scope only from caller-supplied values) |
| `packages/core/src/install/apply.ts` | apply/undo/uninstall/verify + ledger | plan→apply equality re-check (`target_changed`), `assertInsideRoot`, per-file atomic writes (`writeTextFileAtomic`), snapshot/undo drift refusal, ledger shape validation, spawn seam (`SpawnFn`), CLI argv passthrough |
| `packages/core/src/index.ts` | export lines for the above | nothing else changed |
| `packages/core/package.json` + `pnpm-lock.yaml` | dependency: `fflate ^0.8.3` (owner-approved; `pnpm audit`: "No known vulnerabilities found") | — |
| Test files: `packages/core/test/library-item.test.ts` (10), `library-ingest.test.ts` (8), `install-plan.test.ts` (7), `install-apply.test.ts` (10) | see §3 | — |

## 3. Required adversarial tests → exact test names (all passing)

| BUILD_PROGRAM P2 requirement | Test file · exact test name |
| --- | --- |
| zip-slip and path traversal | `library-ingest.test.ts` · "rejects zip-slip and path traversal entry names; nothing escapes" |
| symlinks and junctions | `library-ingest.test.ts` · "rejects symlinks/junctions inside a skill folder and never reads their target" |
| absolute paths | `library-ingest.test.ts` · same zip-slip test (`/etc/evil.txt`, `C:\evil.txt`) + `library-item.test.ts` · "rejects unsafe skill file paths: absolute, traversal, backslash, NUL, empty segment, duplicate" |
| oversized or binary payloads | `library-ingest.test.ts` · "rejects oversized and binary payloads" (file >1 MB, NUL-byte file, non-UTF-8 via folder) |
| secret literals in definitions (blocked, redacted in all output) | `library-ingest.test.ts` · "blocks secret literals in skill content and the error is redacted" (asserts `[REDACTED]` present, token absent) |
| prompt-injection text in skill content (flagged) | `library-ingest.test.ts` · "flags prompt-injection and risky skill content without blocking the item" (flags `skill_shell_injection`, `skill_allowed_tools`, `skill_bundled_script`, `possible_prompt_injection`) |
| crash mid-apply (atomic, snapshot intact) | `install-apply.test.ts` · "crash mid-apply: completed steps stay recorded, the rest untouched, undo restores everything" |
| undo after partial failure | `install-apply.test.ts` · "undo after partial failure cleans up; re-applying the same plan then succeeds" |
| uninstall refuses to touch items we didn't install | `install-apply.test.ts` · "uninstall refuses items we did not install (ledger is the only proof)" (skill on disk without a record; MCP entry in config without a record — nothing touched, no spawn) |
| MCP command definitions that change between plan and apply (rejected) | `install-apply.test.ts` · "rejects MCP when the config changed between plan and apply; spawns nothing" (also the skill variant: "rejects a skill apply when a planned-against file changed on disk") |
| git ingestion pins commit + hash (PRD L2/§7 supply chain) | `library-ingest.test.ts` · "ingests from a git URL pinned to a commit; the pin, not the branch tip, decides content" + "rejects an invalid or unknown commit and a repo without SKILL.md" |
| undo restores updates byte-for-byte; drift refusal on uninstall | `install-apply.test.ts` · "undo restores a pre-existing (updated) file byte-for-byte from the snapshot" + "uninstall refuses drifted files unless forced; verify reports the drift" |

Reproduce: `pnpm -r --stream test` → core **176 passed** (19 files), cli **58 passed | 1 skipped**,
exit 0; `pnpm -r --stream typecheck` exit 0 (2026-11-08).

## 4. Residual risks (documented, accepted for this phase)

1. **Zip bombs:** inflated-size caps are checked *after* `fflate.unzipSync` decodes in memory; the
   compressed-input cap (20 MB) bounds memory but a high-ratio bomb can still allocate heavily
   before rejection. True streaming inspection (fflate `Unzip`) is future work.
2. **Zip mode bits:** fflate's sync API does not expose unix mode bits, so a symlink *entry* inside
   a zip is not detectable as such. Mitigation: symlink entries cannot materialize — apply writes
   only regular files (temp+rename); entry names are validated regardless.
3. **Mid-step interruption convergence:** a crash between two file writes of one skill step leaves
   a mixed directory; re-applying the same plan converges (verified per-file before-states still
   hold), and undo cleans any fully-journaled state. No torn single file is possible
   (temp+rename per file).
4. **Injection heuristics are a flag, not a verdict:** the pattern list (`ingest.ts`
   `INJECTION_PATTERNS`) catches common phrasings and the three structural risks (shell
   injection, `allowed-tools`, bundled scripts); it cannot prove absence. The real gate is the
   per-machine diff approval (P3 UI).
5. **Inline secrets in `~/.claude.json`:** user-scope entries may carry real values as plaintext
   JSON in the user's own profile (disclosed in ADR 003 §2); project-scope files can never
   receive them (enforced in the planner, tested).
6. **`claude mcp add-json` on Windows:** argv-array spawn is the designed path (no shell), but the
   live-CLI behavior on Windows is still needs-live-verification (ADR 003 §7) — the spawn seam
   (`SpawnFn`) isolates this so P3 verification cannot change engine code.
