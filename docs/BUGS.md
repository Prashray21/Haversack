# Bug log

Every entry: what broke, the root cause, the fix, and the regression test that
guards the class of bug. Newest last.

## BUG-009 — Packaged renderer showed "not found": app:// path double-counted the virtual host (2026-11-08, P3.3)

- **Symptom:** the installed app opened with the correct title bar but the
  body rendered the protocol handler's 404 body ("not found"). The dev smoke
  test passed — `did-finish-load` fires for a 404 body, so the pipeline
  (main → utility process → core) was green while the UI was empty.
- **Root cause:** `main.ts` loaded `app://renderer/index.html` and the
  protocol handler concatenated `url.hostname + url.pathname` into the file
  path, resolving to `dist/renderer/renderer/index.html` — nonexistent → 404.
  The hostname is the virtual host marker, not a path segment.
- **Fix:** the handler maps `url.pathname` alone under the renderer root.
- **Guard:** the smoke hook now fails (`SMOKE_FAIL renderer did not mount`)
  unless `#root` actually has children in the loaded page — a pipeline-green/
  renderer-empty run can no longer pass. Found by the owner opening the
  installed app; regression caught by the strengthened smoke, not by unit
  tests (protocol handling is Electron-runtime behavior).

## BUG-010 — Sandboxed preload was ESM: `window.haversack` never existed, renderer rendered empty (2026-11-08, P3.3)

- **Symptom:** after the BUG-009 path fix, the smoke gate still failed — all
  renderer files served 200, no visible errors, but `#root` had no children.
  With pre-load console capture attached: `Unable to load preload script …
  SyntaxError: Cannot use import statement outside a module`, then
  `Cannot read properties of undefined (reading 'invoke')`.
- **Root cause:** the repo is `"type": "module"`, so tsc emitted the preload
  as ESM `.js`. Electron **sandboxed** renderers load preload scripts as
  plain CommonJS — an ESM preload cannot expose the contextBridge, so the
  bridge (`window.haversack`) never existed and the app crashed on its first
  invoke.
- **Fix:** the build emits the preload via esbuild as
  `dist/main/preload.cjs` (`--format=cjs --external:electron`), and
  `main.ts` points at the `.cjs`. The renderer also renders a plain-language
  error instead of a silent blank page if the bridge is missing.
- **Guard:** the BUG-009 render check (smoke fails unless `#root` has
  children) is the guard — it caught this bug the same day. Lesson recorded:
  the smoke gate must capture renderer console messages from window creation,
  not after load (load-time errors were invisible in the first diagnostic run).

## BUG-001 — Symlink/junction escape in source-file reads (2026-11-07, M3)

- **Symptom:** `readRepoTextFile` validated the requested path lexically
  (resolve + prefix check) but never resolved links. A symlink (or Windows
  junction) placed inside the repo pointing outside it passed the check and its
  target — outside the repo root — was read into context/rules or scanned.
- **Root cause:** the guard compared `path.resolve` strings; resolving a link
  was never part of the check.
- **Fix:** `packages/core/src/parse/files.ts` resolves the real path of both
  the repo root and the target file (`fs.realpath`) before any read and
  rejects the file with `unsafe_path` when the real location escapes the real
  root. `realpath` also normalizes 8.3 short paths and case on Windows.
- **Guard:** `packages/core/test/files.test.ts` — "refuses a symlink/junction
  that points outside the repo root — its content is never read" (uses a
  junction on Windows so unprivileged machines exercise it too; failed against
  the unfixed code before the fix landed).

## BUG-002 — Generated-header spoofing misclassified foreign files as ours (2026-11-07, M3)

- **Symptom:** `hasGeneratedHeader` used `content.includes(marker)`. Any
  user-owned file that merely *quoted* the header text (e.g. documentation
  about the header) was classified `stale` when the manifest had no entry, so
  `runtime sync` would overwrite it without `--force`.
- **Root cause:** unanchored substring match for the generated-file marker.
- **Fix:** `packages/core/src/adapters/header.ts` anchors the match at the
  start of the body (after an optional BOM or frontmatter block) and requires
  a comment opener (`<!--` or `/*`) — exactly where an adapter places the
  header.
- **Guard:** `packages/core/test/detect.test.ts` — "untracked: a foreign file
  that only MENTIONS the header text is never treated as ours" and "untracked:
  header text at the start without a comment opener is not ours (prose, not
  header)"; plus a positive test for the mdc-style frontmatter placement.

## BUG-003 — Static checks had no time bound (2026-11-07, M3)

- **Symptom:** a user-supplied pattern that backtracks catastrophically could
  hang `runtime check` indefinitely when many lines fed it.
- **Root cause:** the static engine looped over all lines with no deadline.
- **Fix:** cooperative per-check time budget (`CHECK_TIME_BUDGET_MS = 1000`,
  `packages/core/src/constants.ts`). A check that exceeds it is `skipped`
  with reason `time_budget_exceeded` — never a hang, never a pass (D13
  semantics). The CLI maps the reason to an explanatory message.
- **Guard:** `packages/core/test/static.test.ts` — budget-exceeded skip is
  deterministic (`timeBudgetMs: 0`), and budget-off evaluation is unchanged.
- **Residual risk (documented, not fixed):** JavaScript regex is synchronous;
  a single line that backtracks catastrophically *inside one `regex.test`
  call* cannot be interrupted without worker threads, which Node SEA builds
  do not support. The 1 MB per-file input cap (`CHECK_MAX_FILE_BYTES`) bounds
  that work, and patterns are repo-controlled (a repo owner only attacks
  themselves). Patterns are also capped at 500 characters in the schema.

## BUG-004 — Binary files were regex-scanned (2026-11-07, M3)

- **Symptom:** a binary file in scope (NUL bytes) was split into "lines" and
  fed to every matching pattern; random byte sequences could produce nonsense
  findings.
- **Root cause:** the check pipeline had no binary detection.
- **Fix:** `packages/cli/src/commands/check.ts` skips any file whose content
  contains a NUL byte, with a visible `⚠ skipped … binary file` warning.
- **Guard:** `packages/cli/test/check.test.ts` — "binary files are skipped
  with a warning, never scanned".

## BUG-005 — Non-atomic writes could leave a half-written target (2026-11-07, M3)

- **Symptom:** `sync` wrote generated files and the manifest with a direct
  `writeFile`. A crash mid-write (or a full disk) could leave a truncated
  `CLAUDE.md` or a torn manifest.
- **Root cause:** no write-to-temp-then-rename step.
- **Fix:** `packages/core/src/parse/write.ts` — `writeTextFileAtomic` writes a
  sibling temp file then renames (atomic on all supported platforms), removes
  the temp file on any failure, and creates parent directories. Used for both
  generated files and the manifest; the write loop reports failures as
  `✘ write failed: …` (exit 1) and points at re-running sync to converge.
- **Guard:** `packages/core/test/files.test.ts` — happy path, overwrite, and
  failed-rename-without-litter; `packages/cli/test/sync.test.ts` — "a failed
  write exits 1 with a clear message and leaves no temp litter".

## BUG-006 — A directory at a generated path crashed sync with a stack trace (2026-11-07, M3)

- **Symptom:** with a directory named `CLAUDE.md` on disk, `runtime sync`
  threw `EISDIR` out of `readIfExists` (only `ENOENT` was handled) and died
  with a raw stack trace.
- **Root cause:** unhandled `EISDIR` in the drift pre-read.
- **Fix:** `readIfExists` treats `EISDIR` as "nothing readable"; the write
  stage then fails with the clear `✘ write failed:` message and exit 1.
- **Guard:** the same sync.test.ts failed-write test (fixture uses a directory
  at the target path — fails the rename on every platform).

## BUG-007 — sync's secret gate skipped project.yaml itself (2026-11-07, M3)

- **Symptom:** the D8 gate on `sync` scanned context/rules sources and
  generated output but not the definition file — a credential pasted into
  `project.yaml` (a prompt or description) synced without complaint. `check`
  already scans it (it walks all tracked files).
- **Root cause:** `collectSecretFindings` never included the config file.
- **Fix:** `packages/cli/src/commands/sync.ts` reads and scans `project.yaml`
  with the same ignore list; findings block the sync (exit 3, redacted).
- **Guard:** `packages/cli/test/sync.test.ts` — "a secret in project.yaml
  itself blocks the sync with redacted findings (exit 3)".

## BUG-008 — the secret gate flagged the sanctioned environment-read idiom (2026-11-07, M6)

- **Symptom:** `runtime check` exited 3 on
  `const apiKey = process.env.OPENAI_API_KEY;` in the CLI's own source —
  the generic-credential rule matched the assignment's "value"
  (`process.env.OPENAI_API_KEY`). Reading credentials from the environment is
  the pattern the project's own rules mandate; the gate blocked the sanctioned
  idiom (found live while wiring the M6 judge).
- **Root cause:** the generic assignment rule captured anything after `=`/`:`
  without distinguishing an environment *reference* from a secret *literal*.
- **Fix:** `packages/core/src/secrets/scan.ts` skips matches whose captured
  value starts with `process.env.` — a literal right next to it is still
  caught.
- **Guard:** `packages/core/test/secrets.test.ts` — "does not flag environment
  reads — the sanctioned credential pattern (BUG-008)" (failed against the
  unfixed scanner before the fix landed; asserts literals are still caught).
