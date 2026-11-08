# ADR 001 — Desktop architecture (Phase A: native Windows app)

**Status:** Revised per owner review 2026-11-07 — direction approved
(**Electron**); document NOT yet final. Track paused until the owner confirms
the product rename to **Orbit** is done (§11).
**Date:** 2026-11-07 (revised same day after owner review)
**Scope:** Phase A = a native Windows (x64) desktop app for Project Runtime,
local-first, with an optional Supabase team layer. GitHub App PR enforcement
does NOT exist (later phase) — see §12 "Honesty constraints".

## 1. Context and constraints (measured, not assumed)

- Repo: TypeScript pnpm monorepo, ESM, plain `tsc` builds, vitest.
  `@runtime/core` deps today: `zod ^4.1.0`, `yaml`, `picomatch` — zod already
  present, so the IPC layer reuses it (no new dependency for validation).
- Machine (measured 2026-11-07): Windows 11 x64 (26200), Node 24.14.1,
  pnpm 12.16.1, git 2.53.0. **No elevation**; **C: 1.5 GB free**, D: 128 GB —
  owner approved D: for all storage. **MSVC Build Tools + Windows SDK absent**
  (irrelevant for Electron). WebView2 156.0.4314.58 present. RAM 15.6 GB.
- CI: `windows-latest` green required per milestone commit. Solo dev. Repo
  stays private (D12). **2026-11-08 update:** the owner made the repository
  public; this premise changed, recorded in §9's note below.
- Signing: none in Phase A (owner decision #2). Roadmap G will research it
  with citations.
- The product is being renamed to **Orbit** (owner, 2026-11-07). No installer
  or binary identity may be chosen until that rename is confirmed — §11.

## 2. Electron vs Tauri — comparison for THIS repo (retained from v1; decision unchanged)

| Axis | Electron | Tauri v2 |
| --- | --- | --- |
| Reusing `packages/core` | **Direct import** in a Node-capable process; no protocol code; core's own test suites cover the exact code path. | Sidecar process (second IPC protocol + second binary) or engine copy (forbidden). |
| Local toolchain | **None** (Node+pnpm+git present). | Rust MSVC toolchain + "Desktop development with C++" Build Tools (official prerequisite) — ~4–8 GB, elevation-gated here. |
| Bundle size | ≈ 85–115 MB installer (estimate, §10) | ≈ 5–15 MB (relies on OS WebView2). |
| Security model | Documented defaults: `contextIsolation` on, `nodeIntegration` off, sandbox on, CSP + IPC-sender guidance (cited). | Capability allowlists; same discipline required. |
| Session storage | Built-in `safeStorage` → **DPAPI on Windows**. | Third-party keyring/stronghold plugins. |
| Auto-update | `electron-updater` NSIS + sha512 — **not used, see §9** (owner decision #3). | Mandatory minisign signatures ("cannot be disabled"). |
| Installer | NSIS via electron-builder (cited). | NSIS or MSI (MSI needs VBSCRIPT, being deprecated). |

## 3. Decision: Electron

Reasons (ranked):

1. **Direct core reuse** — no sidecar protocol, no engine copy.
2. **Zero new local toolchain** — no elevation, no MSVC, no Rust on a
   C:-constrained machine.
3. **Built-in DPAPI session storage** (`safeStorage`) — §7.
4. Accepted cost: ~90 MB-class installer vs ~10 MB-class. Irrelevant here.

## 4. Core execution model: utility process, never the main process

**Rule (owner amendment a):** all `packages/core` operations (init, sync,
verify, check, drift) run in an **Electron `utilityProcess`** — never in the
main process. A per-operation hard timeout in the main process **kills** the
utility process on breach (`child.kill()`; the docs guarantee the `'exit'`
event after termination) and reports the operation as failed — never a
silent pass.

Why: repo-defined regexes (check `pattern`s, `secrets.ignore`) are untrusted
input. The core engine's per-check time budget is cooperative
(1 s → `skipped`, `packages/core/src/constants.ts`) and its documented
residual risk (`docs/BUGS.md` BUG-003) is a single synchronous
`regex.test` call that cannot be interrupted — a process boundary with a hard
kill is the backstop the cooperative budget cannot provide.

Options verified from official docs:

- **`utilityProcess`** (chosen) — "provides the equivalent of
  `child_process.fork` API from Node.js but instead uses Services API from
  Chromium to launch the child process"; message ports via
  `process.parentPort` / `postMessage`; `'exit'` event; `child.kill()`.
  Source: https://www.electronjs.org/docs/latest/api/utility-process
- **Node `worker_threads`** (rejected) — can be terminated, but shares the
  process (weaker isolation boundary for hostile input) and interacts poorly
  with the `runAsNode`/fork fuse posture below.
- Fuse interplay: disabling the `runAsNode` fuse breaks
  `child_process.fork`; the Fuses documentation itself points to Utility
  Processes as the replacement (https://www.electronjs.org/docs/latest/tutorial/fuses)
  — consistent with this choice.

Renderer ⇄ main ⇄ utility-process: two message hops, both zod-validated at
the receiving end.

## 5. Security model (concrete)

- **Renderer isolation:** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; only bundled local content served via a custom protocol
  (never remote content); `webSecurity` never disabled; navigation locked:
  `will-navigate` → `preventDefault()` for anything not our protocol;
  `setWindowOpenHandler` → deny; permission requests denied by default via
  `setPermissionRequestHandler`.
- **CSP (full, owner amendment f), enforced via the protocol handler's
  response headers and a `<meta>` fallback:**

  ```
  default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'
  ```

  No `'unsafe-inline'` for scripts or styles — styles ship as files; JSX
  inline `style={}` objects mutate CSSOM (not CSP-blocked), but no component
  may inject `<style>` elements.
- **IPC:** fixed channel set exposed via `contextBridge`; **sender-frame
  validation (origin comparison per the official security tutorial) in
  addition to zod schema validation** of every payload in the main process.
  Main returns plain data only.
- **Supabase session storage (owner amendment c):** a custom storage adapter
  in the main process backed by `safeStorage` — **no plaintext session is
  ever written to disk.** If `safeStorage` encryption is unavailable, the app
  **fails closed**: the session is NOT persisted (in-memory for that run
  only, gone on exit) and the UI explains why. Tokens never reach the
  renderer; it receives derived facts only. Sign-out deletes the stored blob.
- **Connect-to-team screen (owner amendment d):** accepts a Supabase project
  URL + PUBLIC anon key. Validation requires **HTTPS** (localhost `http://`
  allowed only when a dev flag for local Supabase testing is set — never in
  packaged builds). The target **host is displayed prominently** on the
  screen, and sign-in requires an explicit confirmation step showing it
  ("You are about to sign in to `https://<host>`").
- **File-system scope:** fs entry points = native `showOpenDialog` (result
  stays in main) or re-opening a recently-opened path. All repo I/O flows
  through `packages/core` — same realpath escape guards (BUG-001 fix), atomic
  writes (BUG-005), binary handling. **A malicious repo's `project.yaml` and
  context/rules files go through exactly the same path-escape and secret-gate
  protections as the CLI** (same code, same tests) — and the check patterns
  they define additionally run inside the killed-on-timeout utility process
  (§4).
- **Secrets in the UI (D8 semantics):** secret-gate findings are **redacted
  only** — `file:line`, rule, redacted snippet; the value never materializes
  in UI, logs, or uploads.
- **Uploaded findings (owner amendment e):** by default a finding carries
  **file path, line, rule id, severity — no content**. Uploading source
  snippets is **opt-in per workspace** (default off), and even then snippets
  pass the secret gate first. Docs must state: source snippets remain private
  code; only workspaces that explicitly opt in see them.

## 6. Data flow

```
Renderer (sandboxed, CSP 'self', no Node, no network)
   │  typed IPC (contextBridge; sender-frame + zod validated in main)
   ▼
Main process (Node) — orchestration only; no untrusted code runs here
   │  postMessage / parentPort (zod-validated both ends)
   ▼
Utility process — @runtime/core (init/sync/verify/check/drift) on the
   │                user-chosen repo folder; killed on timeout
   ▼
Main ──► Supabase (optional): supabase-js over HTTPS, PUBLIC anon key +
          user JWT; every table RLS default-deny; is_member() roles.
          Service-role key has no field, setting, env var, or code path;
          build-time bundle pattern test fails on a hit (A6).
```

## 7. Hardening checklist (owner amendment g)

| # | Hardening | Detail |
| --- | --- | --- |
| 1 | Fuses flipped at build via **`@electron/fuses`** (official tooling, cited) | **Disable:** `runAsNode`, `nodeOptions`, `nodeCliInspect`, `grantFileProtocolExtraPrivileges` (we serve via custom protocol, not `file://`). **Enable:** `cookieEncryption`, `embeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar` (docs: combined, "it is impossible to load non-validated code"). |
| 2 | IPC sender-frame validation | Origin comparison on every message, in addition to schema validation. |
| 3 | No `shell.openExternal` on untrusted URLs | External opens (docs links only) restricted to an https allowlist of our own domains; everything else ignored. |
| 4 | Navigation + window lockdown | `will-navigate` prevent, `setWindowOpenHandler` deny, permission handler deny-by-default. |
| 5 | DevTools disabled in packaged builds | Not openable when `app.isPackaged`; `nodeCliInspect` fuse disabled removes the debug-port path. |
| 6 | No telemetry, no crash-report uploads | `crashReporter` never started; no analytics code or calls. |
| 7 | Log redaction in main | A redaction filter wraps every log write (tokens, keys, secret-shaped strings); logs live in userData only. |
| 8 | `safeStorage` limits, stated | DPAPI protects session data from **other Windows users**, not from **malware running as the same user** (official docs caveat, cited). Documented in app docs and README. |
| 9 | Repo content = untrusted input | `project.yaml`/context/rules: same realpath + secret-gate protections as the CLI (§5), plus utility-process isolation (§4). |

## 8. Threat model (Phase A scope)

| Threat | Mitigation | Where tested |
| --- | --- | --- |
| Cross-tenant leakage | RLS default-deny on every table; `is_member()`; 4 roles; anon key alone yields nothing | A5 automated DB tests |
| Token theft from disk | safeStorage/DPAPI adapter, fail-closed (§5); tokens never in renderer/localStorage; sign-out wipes | A6 sign-out test; A8 uninstall evidence |
| Malicious repo content | Untrusted data, never executed by the app; realpath guards + secret gate; check patterns run in a killable utility process; redacted display; gate before every upload | Core regression tests + A6 upload-gate test |
| IPC abuse from a compromised renderer | Fixed channels, sender-frame + zod validation, sandboxed renderer, no fs/network authority in renderer | A2 IPC contract tests |
| Malicious installer substitution (manual updates — there is no in-app update channel to tamper with) | Downloads only over HTTPS from this repo's GitHub Releases; SHA-256 verification via `SHA256SUMS.txt` is the integrity mechanism (same as the CLI); unsigned residual → SmartScreen warning, stated plainly | A7 install evidence; README (A9) |
| Injection (HTML/SQL/path) | No remote content; full CSP (§5); DB only via parameterized PostgREST; all paths through core guards | A3/A6 suites |

## 9. Updates: NONE in Phase A (owner decision #3) — manual only

> **2026-11-08 note:** the repository is now **public**, which removes the
> private-repo premise of the electron-updater reasoning below (public
> releases need no GH_TOKEN on user machines). The decision stands — no
> auto-update ships until the owner revisits it — but the "unacceptable UX"
> analysis no longer applies as written.

- No auto-update code ships in Phase A; `electron-updater` is **removed from
  the dependency list** (§10).
- Verified reason, with citation: for a **private** GitHub Releases repo,
  electron-updater's documented mechanism is the `GH_TOKEN` **environment
  variable set on the user's machine** ("You can use a private repository for
  updates with electron-updater by setting the GH_TOKEN environment variable
  (on user machine) and private option"), and the docs themselves warn
  "Private GitHub provider only for very special cases — not intended and not
  suitable for all users" (https://www.electron.build/docs/features/auto-update).
  On this private repo, workable options reduce to asking every teammate to
  maintain a GitHub token (unacceptable UX) or embedding a token in the app
  (forbidden — the service-role/secrets rule applies a fortiori). Neither
  meets the owner's bar.
- **Revisit criteria (recorded):** only when updates (a) require no embedded
  token, and (b) manifests are signed and verified by the app.
- **Manual update process (documented in README/SELF_HOSTING at A9):**
  download the new installer from GitHub Releases over HTTPS, verify SHA-256
  against `SHA256SUMS.txt`, run the assisted installer over the existing
  install.
- **Electron patching policy (owner amendment h):** Electron security fixes
  are frequent; the app **cuts a new build whenever Electron ships a security
  fix** affecting the runtime — pin bumped, installer rebuilt, SHA256SUMS
  regenerated, CHANGELOG updated, released under the current Phase A version
  scheme. The manual-update doc above is how users apply it. This is the
  standing obligation replacing auto-update.

## 10. Installer, size, and what still touches C:

- **Format:** NSIS, **assisted installer** — `oneClick: false`,
  `allowToChangeInstallationDirectory: true`, `perMachine: false` (option
  semantics cited from the official NSIS options reference:
  https://www.electron.build/v26/docs/nsis). This lets test installs go to
  D: and end users pick their own drive.
- **Size estimates** (basis: Electron win-x64 release artifacts are ~90–100 MB
  in recent majors; exact numbers recorded in AUDIT when A2 produces the
  first artifact — these are estimates, not measurements):
  - Installer download: **85–115 MB** — confidence **high** (±10 MB; driven
    almost entirely by the embedded Chromium+Node).
  - Installed footprint: **230–330 MB** — confidence **medium-high**.
  - Pushes it higher: newer Electron majors (Chromium growth); shipping all
    locales (we strip to English via `electronLanguages`, which pushes it
    lower); any future native module. Pushes lower: locale stripping.
- **What still writes to C: even with a D: install directory:**
  | Location | Content | Typical size |
  | --- | --- | --- |
  | `%APPDATA%\<productName>\` (Electron userData) | config, recently-opened list, redacted logs, DPAPI-encrypted session blob, Chromium shader/GPU cache | KBs → tens of MB (cache grows with use) |
  | Windows Error Reporting (OS-level, if a crash occurs) | local crash reports; we never upload anything | KBs → few MB |
  | Dev-machine build caches | **redirected to D:** (`ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`, pnpm store on the project drive) | 0 on C: |
  Relocation of userData to D: is possible (`app.setPath`) but is NOT
  committed for Phase A (candidate setting later; it must not break DPAPI
  access, which is per-user not per-path).

## 11. App identity — ONE constant, set only after the Orbit rename

Owner decision #5: no `Runtime.Desktop`, no `runtime-desktop.exe`. The product
is being renamed to **Orbit**; naming is frozen until the owner confirms the
rename is done. In code there will be exactly **one** identity constant that
everything else (BrowserWindow title, installer artifact name, `appId`,
executable name, userData folder) derives from:

```ts
// apps/desktop/src/shared/identity.ts — values TBD until rename confirmation
export const APP_IDENTITY = {
  appId: 'TBD',          // reverse-DNS, set once, never changed afterwards
  productName: 'TBD',    // "Orbit" family name — owner confirms exact string
  exeName: 'TBD',
  userDataDirName: 'TBD',
} as const;
```

**Track paused:** A2–A9 do not start until the owner says the rename is done.

## 12. Scope exclusions (owner amendment b + honesty constraints)

- **LLM-judged checks are EXCLUDED from the Phase A app.** The app runs
  static checks and secret scanning only. This is stated in the ADR scope,
  in the app UI wherever checks are described, and in all user-facing text
  (README, CHANGELOG at A9). The CLI keeps them (experimental, unverified
  live) — the desktop app simply does not expose them.
- Not built, and listed as such everywhere: GitHub App PR enforcement
  (webhooks cannot reach a desktop app), MCP gateway, skills, living context,
  AST checks, import mode, macOS/Linux builds, code signing, auto-update (§9).

## 13. Dependency list — approved with exact pins (owner review #1)

All MIT (license check via `npm view <pkg> license`, 2026-11-07). Exact pins
from the npm registry the same day; `pnpm audit` runs immediately after
install in A2 and its output lands in AUDIT. Install scripts allowed for
**`electron` and `electron-builder` only** (pnpm `allowBuilds` gains exactly
those two); all caches and build output on D:.

| Package | Pin | Kind | Why |
| --- | --- | --- | --- |
| `electron` | `45.2.3` | dev | Runtime shell (Chromium+Node embedded) |
| `electron-builder` | `26.18.0` | dev | NSIS packaging + SHA256SUMS |
| `@electron/fuses` | `2.1.3` | dev | Official fuse-flipping utility (docs: "a JavaScript utility designed to make flipping these fuses easy") — required by hardening item 1 |
| `vite` | `8.3.6` | dev | Renderer bundling; main/preload stay plain `tsc` |
| `@vitejs/plugin-react` | `6.2.1` | dev | React support in vite |
| `react` / `react-dom` | `19.3.1` / `19.3.1` | runtime (bundled) | UI framework (owner decision #4) |
| `@types/react` / `@types/react-dom` | `19.3.0` / `19.3.0` | dev | Types |
| `@supabase/supabase-js` | `2.119.0` | runtime (main) | Team layer (auth + PostgREST) |
| ~~`electron-updater`~~ | — | — | **Removed** by owner decision #3 (§9) |

No zod addition (core already has it); no CSS framework; no router; no state
library.

## 14. Day estimates (unchanged from v1)

A2 wiring 1 · A3 local UI 3–4 · A4 schema 1.5–2 · A5 DB tests 1–1.5 (needs
owner-installed WSL2+Docker) · A6 team features 3–4 · A7 installer+uninstall
evidence 1–2 (auto-update work removed) · A8 E2E + screenshots 1 · A9 docs+RC
1 → **total ≈ 12.5–17 dev-days**.

## 15. Owner decisions recorded (2026-11-07 review)

1. Dependencies: approved with exact pins + license check; install scripts
   electron/electron-builder only; D: caches; audit after install.
   electron-updater removed; @electron/fuses added (docs-backed).
2. Unsigned in Phase A; SmartScreen warning stated plainly in README.
3. No auto-update; manual updates; reasons + revisit criteria in §9.
4. React approved.
5. No Runtime.Desktop naming; identity via one constant after Orbit rename
   confirmed; track paused until then.

Remaining before A2: owner confirms the Orbit rename is done. (Supabase CLI
route + WSL2/Docker install remain owner-side prerequisites before A5.)

## 16. Sources (official, fetched 2026-11-07)

- Electron security tutorial:
  https://www.electronjs.org/docs/latest/tutorial/security
- Electron `safeStorage` (DPAPI on Windows; other-users caveat):
  https://www.electronjs.org/docs/latest/api/safe-storage
- Electron `utilityProcess` (fork-equivalent via Chromium Services API,
  `'exit'`, `kill()`, parentPort):
  https://www.electronjs.org/docs/latest/api/utility-process
- Electron Fuses (fuse list, defaults, `@electron/fuses` official tooling,
  runAsNode→utility-process note, ASAR integrity):
  https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-builder auto-update (private repo `GH_TOKEN` on user machine;
  "Private GitHub provider only for very special cases"):
  https://www.electron.build/docs/features/auto-update
- electron-builder NSIS options (`oneClick`, `allowToChangeInstallationDirectory`):
  https://www.electron.build/v26/docs/nsis
- Tauri v2 prerequisites (MSVC workload, Rust, WebView2) — comparison only:
  https://v2.tauri.app/start/prerequisites/
- Tauri v2 updater (signatures mandatory) — comparison only:
  https://v2.tauri.app/plugin/updater/
