# Windows testing — R1 (2026-11-07)

All output below is pasted from real runs on this machine (Windows 10.0.26200,
Git Bash, node v24.14.1). The working folder name deliberately contains a
**space and non-ASCII characters**: `%TEMP%\R1 test rüñtime 中文`.

## 1. Fresh clone — install, build, typecheck, test

```text
$ git clone <repo> "$TEMP/R1 test rüñtime 中文/repo"   # HEAD = e0c089b
$ pnpm install --frozen-lockfile
.../esbuild@0.28.2/node_modules/esbuild postinstall: Done
Done in 3s using pnpm v12.16.1

$ pnpm build
packages/core build: Done
packages/cli build: Done

$ pnpm typecheck          → 2 × "Done" (core, cli)

$ pnpm test
packages/core test:  Test Files  14 passed (14)
packages/core test:       Tests  128 passed (128)
packages/cli test:  Test Files  5 passed (5)
packages/cli test:       Tests  52 passed | 1 skipped (53)
```

## 2. Published binary + checksum

Downloaded `v0.1.0-alpha.1` (the current prerelease) into the same
space+non-ASCII folder:

```text
$ gh release download v0.1.0-alpha.1 -p "runtime-windows-x64.exe" -p "SHA256SUMS.txt"
$ sha256sum -c SHA256SUMS.txt --ignore-missing
runtime-windows-x64.exe: OK
```

## 3. Scripted scenario (using the downloaded runtime-windows-x64.exe)

Scratch repo `%TEMP%\R1 test rüñtime 中文\scratch repo` (git init, contains a
`CLAUDE.md`), all commands run from inside that path.

**init** (exit 0 — the existing CLAUDE.md is moved aside):

```text
moved CLAUDE.md → context/existing-claude.md (original removed: it conflicts with the generated CLAUDE.md)
wrote project.yaml (DRAFT — review before syncing)
next steps: ...
INIT EXIT: 0
```

**Draft review**: the DRAFT yaml (shown in full in the run) lists the migrated
context file, `rules: []`, `targets: [claude-code]`, `checks: []`. A block
check was added by hand (`no-todo-in-src`, `severity: block`,
`pattern: "TODO"`, `path: ["src/**"]`).

**sync — diff + confirmation** (y piped to the prompt):

```text
Write 1 file(s)? [y/N] wrote CLAUDE.md
updated .runtime/manifest.json
SYNC EXIT: 0
```

**sync --verify — in sync** (exit 0), then **hand-edit the generated file**:

```text
$ printf '\nHAND EDIT MARKER\n' >> CLAUDE.md
$ runtime sync --verify
  hand-edited CLAUDE.md
✘ drift: CLAUDE.md was hand-edited — skipped (use --force to overwrite)
verify: 1 file(s) would change — run 'runtime sync' to update
VERIFY EXIT: 1
```

**sync without --force** (exit 1, nothing written):

```text
✘ drift: CLAUDE.md was hand-edited — skipped (use --force to overwrite)
nothing written — resolve the drift above or re-run with --force
SYNC-SKIP EXIT: 1
```

**sync --force --yes** (exit 0, overwrite):

```text
wrote CLAUDE.md
updated .runtime/manifest.json
FORCE EXIT: 0
```

**check with the failing block rule** (exit 1):

```text
✘ no-todo-in-src (block) — 1 finding(s)
    src/app.ts:1 — TODO left in code.
check: 0 passed · 1 failed · 0 skipped · mode: whole files (all tracked)
result: 1 BLOCK check(s) failed (exit 1)
CHECK EXIT: 1
```

**secret gate** (fake GitHub-token-shaped line added to a context file):

```text
SECRET-SYNC EXIT: 3
    bootstrap credential: [REDACTED]
  CLAUDE.md:19 — github-token
    bootstrap credential: [REDACTED]
```

Exit 3, value redacted in both the source file and the would-be generated
output. (A first attempt at this step accidentally produced a malformed
`project.yaml` — the CLI rejected it with positioned YAML errors, exit 2,
which is correct behavior; the scenario was then re-run with a valid file.)

**join from a second fresh clone, timed** (node timing around
`git clone` + `runtime join`, artifacts committed in the source repo):

```text
clone: 119ms, join: 133ms, total clone-to-working: 252ms
join exit: 0
done in 0.0s (F5.3 target: under 10 minutes)
```

## 4. Shell × core.autocrlf matrix

Fresh clone per cell; `core.autocrlf` set per-repo; `git checkout -- .`
re-applied so the setting takes effect on the working tree.

| Shell | autocrlf | sync --verify | check | --version | project.yaml working-tree EOL |
| --- | --- | --- | --- | --- | --- |
| Git Bash | false | 0 | 0 | 0 | `i/lf w/lf` |
| Git Bash | true | 0 | 0 | 0 | `i/lf w/crlf` |
| PowerShell | false | 0 | 0 | 0 | `i/lf w/lf` |
| PowerShell | true | 0 | 0 | 0 | `i/lf w/crlf` |
| cmd | false | 0 | 0 | 0 | `i/lf w/lf` |
| cmd | true | 0 | 0 | 0 | `i/lf w/crlf` |

Visible native-shell runs (exit codes from `$LASTEXITCODE` / `%ERRORLEVEL%`):

```text
PowerShell: verify: all 1 generated file(s) in sync
PS-EXIT: 0

cmd:        verify: all 1 generated file(s) in sync
CMD-EXIT: 0
```

Observation (interop, not a Runtime bug): passing the non-ASCII path to
`cmd.exe` as a command-line argument from Git Bash mangles the characters
(`rüñtime 中文` → `r??...`), so cmd reports "not recognized". Launching cmd
with a UTF-16 process creation (as every normal launcher does — Node,
PowerShell, Explorer) works, as the `CMD-EXIT: 0` run above shows.

## 5. SmartScreen behavior

- The binary has **no Authenticode signature** (by design for this alpha;
  stated in the README and CHANGELOG).
- Files downloaded through browsers carry Windows' Mark-of-the-Web; SmartScreen
  evaluates such files and, for an unsigned binary with no established
  reputation, shows **"Windows protected your PC"** with only *More info →
  Run anyway* as the override. This is documented Windows behavior
  (Microsoft Learn, Microsoft Defender SmartScreen overview).
- Empirically, the file downloaded here via `gh release download` carries **no
  Mark-of-the-Web** (PowerShell `Get-Item -Stream *` lists only `:$DATA`), and
  the binary therefore ran **without any prompt** in every step above.
- Steps a first-time user takes after a browser download:
  1. verify the SHA-256 against `SHA256SUMS.txt`;
  2. on first launch, SmartScreen appears → click **More info** →
     **Run anyway**;
  3. optionally unblock the file up front: file Properties → **Unblock**, or
     `Unblock-File .\runtime-windows-x64.exe` in PowerShell.

## 6. Failures and bug policy

No Runtime product failures found in R1. The two mid-run errors (a malformed
`project.yaml` edit and a duplicated entry) were scenario-script mistakes; the
CLI rejected both with clear positioned errors and correct exit codes (2), and
the re-runs passed. One interop observation (Git Bash → cmd non-ASCII argv
mangling) is documented above; it reproduces with any exe, not just Runtime's.
