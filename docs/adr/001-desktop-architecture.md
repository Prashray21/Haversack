# ADR 001 — Desktop architecture (Phase A: native Windows app)

**Status:** Proposed — awaiting owner approval
**Date:** 2026-11-07
**Scope decision it serves:** Phase A = a native Windows (x64) desktop app for
Project Runtime, local-first, with an optional Supabase team layer. GitHub App
PR enforcement does NOT exist yet (later phase) and this app does not pretend
otherwise — see "Honesty constraints" below.

## 1. Context and constraints (measured, not assumed)

- Repo: TypeScript pnpm monorepo, ESM (`"type": "module"`), plain `tsc` builds,
  vitest. Packages: `@runtime/core` (engine), `@runtime/cli`. `pnpm-workspace.yaml`
  already includes `apps/*`.
- `@runtime/core` dependencies today: `zod ^4.1.0`, `yaml`, `picomatch`
  (`packages/core/package.json`). Zod already exists → the IPC layer can reuse
  it for validation without a new dependency.
- Machine (dev PC, measured 2026-11-07): Windows 11 x64 (build 26200), Node
  24.14.1, pnpm 12.16.1, git 2.53.0. **No elevation rights**; **C: has 1.5 GB
  free**, D: has 128 GB — owner has approved D: for all storage (tool caches,
  future WSL/Docker images). **MSVC Build Tools + Windows SDK are absent**
  (`cl.exe` not found, no `Windows Kits\10\Include`). Rust/cargo absent.
  WebView2 runtime present (156.0.4314.58). RAM 15.6 GB.
- CI: GitHub Actions, `windows-latest`, green required on every pushed milestone
  commit. Solo developer. Repo stays private (D12).
- Signing: none today (CLI release v0.1.0 is unsigned; SmartScreen behavior is
  documented in `CHANGELOG.md` and `docs/TESTING.md`). Code signing is roadmap
  item G — out of scope for Phase A.

## 2. Electron vs Tauri — comparison for THIS repo

| Axis | Electron | Tauri v2 |
| --- | --- | --- |
| **Reusing `packages/core`** | **Direct `import` in the main process** — main is a Node process; core's Node-based engine (fs, realpath guards, secret scan) runs in-process with zero protocol code. Core's existing vitest suites cover the exact code path the app executes. | Core cannot be imported into the Rust host. Options: (a) sidecar process — we already ship a Node SEA `runtime.exe` (v0.1.0), but every operation becomes a second IPC protocol (app→sidecar) stacked on app→renderer IPC, plus process lifecycle management and packaging of two binaries; (b) reimplement core in Rust — forbidden by "core logic stays in packages/core, never copied". |
| **Local toolchain needed** | **None.** Node+pnpm+git already present. electron-builder downloads NSIS at build time (cache redirectable to D:). | Rust MSVC toolchain (rustup) **plus** "Desktop development with C++" Build Tools workload (official prerequisite) — ~4–8 GB, elevation-gated on this PC, C:-resident by default, MSVC currently absent. Buildable, but it is the single biggest install/fragility cost for a solo Windows-only dev. |
| **Bundle size** | Installer ≈ 80–100 MB, installed ≈ 250–300 MB (Chromium+Node embedded; same order as the existing SEA `runtime.exe`). | ≈ 5–15 MB (relies on the OS WebView2). Tauri wins clearly; weight matters little for an internal-phase tool on machines with GB-scale disks. |
| **Security model** | Documented, prescriptive defaults: `contextIsolation` on (since 12), `nodeIntegration` off (since 5), renderer sandbox on (since 20), CSP guidance, IPC sender validation guidance (official security tutorial, cited below). Sufficient for our model if followed exactly. | Capability-based allowlists in Rust; also strong. No advantage that changes our design (both models demand the same discipline: no remote content, validated IPC). |
| **Session storage** | `safeStorage` is built in: **DPAPI on Windows**, main-process-only API (`encryptString`/`decryptString` + async variants). Zero extra dependencies. Documented caveat: protects against other users, not other apps in the same Windows session (accepted; same class of protection as VS Code and other DPAPI-based apps). | Plugins exist (OS keyring, stronghold), but they are extra third-party plugin dependencies in a second language ecosystem. |
| **Auto-update** | `electron-updater`: **NSIS is the supported Windows target** ("Squirrel.Windows is not supported"), sha512 of every artifact verified against the manifest, Ed25519-signed manifests available, `.blockmap` differential downloads, providers include a **generic HTTP(s) server** — testable end-to-end on this PC against a local static server. **Code signing is NOT required on Windows** (mandatory only for macOS auto-update). | Updater **requires** its own minisign-style signatures: "This cannot be disabled." Extra key ceremony; key loss permanently breaks updates to installed apps. Testable, but more moving parts for the same outcome. |
| **Installer format** | NSIS via electron-builder (assisted, per-user option, familiar, downloads tooling automatically). | NSIS or MSI via Tauri bundler (MSI needs a VBSCRIPT optional feature Windows is deprecating). |
| **Webview** | Ships Chromium — consistent rendering everywhere, big download. | OS WebView2 — already present here (156.0.4314.58) and on Win10 1803+. Small download, rendering varies with OS patch level. |

### Decision: **Electron**

Ranked reasons:

1. **Core reuse is direct, not protocol-shaped.** The app's entire value is
   running `packages/core` against a user-chosen folder. Electron imports it
   in-process; Tauri forces a sidecar CLI (second IPC protocol, second binary,
   process management) or an engine copy (forbidden). This dominates the
   decision.
2. **Zero new local toolchain.** No elevation, no MSVC, no Rust — nothing to
   install on a C:-constrained machine. Tauri needs ~4–8 GB of elevation-gated
   tooling for this PC alone.
3. **Built-in DPAPI session storage** (`safeStorage`) and an **auto-update path
   that works unsigned on Windows** (sha512 + optional signed manifests, NSIS,
   generic provider testable locally) — both map 1:1 onto A6/A7 requirements
   with the fewest dependencies.
4. Accepted cost: ~90 MB installer vs ~10 MB. Irrelevant for a Windows-only
   internal tool phase.

## 3. Security model (concrete, per official docs)

- **Renderer isolation:** `BrowserWindow` created with `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. Renderer loads only local, bundled
  content (vite build output via a custom `app://` protocol or `loadFile`); no
  remote content, `webSecurity` never disabled, navigation locked via
  `will-navigate` + `setWindowOpenHandler` (deny-by-default), permission
  requests denied via `setPermissionRequestHandler`.
- **CSP:** strict `<meta>` CSP in the renderer HTML: `default-src 'self'`;
  `script-src 'self'`; `connect-src 'self'` (Supabase calls happen **in the
  main process**, so the renderer needs no network at all — strongest CSP).
- **IPC:** one narrow `contextBridge` API. No raw `ipcRenderer` exposure; no
  arbitrary channel or path passthrough. Every channel: fixed name + zod schema
  (reusing the zod already in core) validating arguments in the **main**
  process; sender validation per official guidance. Main returns plain data —
  never Node primitives, functions, or fs handles.
- **Supabase session storage:** access/refresh tokens held **only in the main
  process**, encrypted at rest with `safeStorage` (DPAPI on Windows) under the
  app's user-data dir. Renderer receives derived facts ("signed in as
  a@b.c, role owner"), never tokens. Sign-out deletes the stored blob
  (A6 verifies). Service-role key: the app has no field, setting, env var, or
  code path for it; a build-time test greps the bundle for the service-role key
  pattern (A6) and fails the build on a hit.
- **File-system scope:** the only fs entry points are (a) folder picked via the
  native `showOpenDialog` (renderer cannot supply a path — the dialog result
  stays in main), and (b) recently-opened list re-opening an exact prior path.
  All reads/writes go through `packages/core`, which already enforces the
  realpath escape guards (BUG-001 fix, `packages/core/src/parse/files.ts`),
  atomic writes (BUG-005 fix), and binary-file handling.
- **Secrets found by the secret gate:** core's D8 semantics — findings are
  **redacted** (value never materializes). The UI renders `file:line`, rule,
  redacted snippet only. Redacted findings are what gets uploaded in team mode
  (A6 tests that a planted secret blocks upload). Secret values are never
  logged, never written to disk outside the repo, never sent anywhere.

## 4. Data flow

```
Renderer (sandboxed, CSP 'self', no Node, no network)
   │  typed IPC channels (contextBridge; zod-validated in main)
   ▼
Main process (Node)
   ├──► @runtime/core  — init / sync / verify / check / drift on the
   │                     user-chosen repo folder (local mode needs nothing else)
   └──► Supabase (optional) — supabase-js over HTTPS with PUBLIC anon key
         + user JWT from Supabase Auth. EVERY table RLS default-deny;
         role checks via is_member(workspace_id, min_role).
         No service-role key exists anywhere in app code, config, or logs.
```

## 5. Threat model (Phase A scope)

| Threat | Mitigation | Where tested |
| --- | --- | --- |
| Cross-tenant leakage | RLS default-deny on every table; `is_member()` helper; viewer/member/admin/owner roles; anon key alone yields nothing | A5 automated DB tests (user A vs B, viewer write, anon) |
| Token theft from disk | DPAPI-encrypted session blob in user-data dir; tokens never in renderer, never in localStorage; sign-out wipes | A6 (sign-out test), A8 (uninstall/credential-removal evidence) |
| Malicious repo content (poisoned CLAUDE.md, planted secrets, path escape) | Repo content treated as untrusted data, never executed by the app; core realpath guards; secret gate before every upload, redacted display; header-anchoring prevents spoofed generated-file overwrites | Existing core tests (BUG-001/002) + A6 upload-gate test |
| IPC abuse from a compromised renderer | Fixed channel set, zod-validated args in main, sender validation, sandboxed renderer, no fs/network authority in renderer | A2 IPC contract tests |
| Update-channel tampering | electron-updater verifies sha512 of every artifact; signed update manifests (Ed25519) before any download; HTTPS-only provider; unsigned NSIS binary residual risk documented (SmartScreen + SHA256SUMS, same policy as the CLI) | A7 end-to-end update test |
| Injection (HTML/SQL/path) | No remote content; strict CSP; DB access only via supabase-js parameterized PostgREST (no raw SQL from the app); all paths flow through core's resolve+realpath guards | A3/A6 UI + core test suites |

## 6. Installer and update plan

- **Format:** NSIS via electron-builder; per-user install (no elevation needed
  by end users), desktop + start-menu shortcuts.
- **Updates:** `electron-updater` with the **generic HTTPS provider**, pointed
  at a static file host we control (GitHub Releases private repo is the
  fallback). sha512 always verified; we enable Ed25519 **signed manifests**
  (v27 feature) so the manifest is not protected by transport alone. A7
  delivers an end-to-end tested update (old version → new version) served from
  a local server in the test, mirroring production config. If this cannot be
  tested end to end, ADR falls back to documented manual updates per the
  session spec.
- **Unsigned reality:** installers are unsigned in Phase A → SmartScreen
  "Unknown publisher — More info → Run anyway" on first run; stated plainly in
  README (A9) exactly like the CLI release. Cost/process of code signing is a
  roadmap-G decision: current CA pricing will be researched with citations when
  we get there (not guessed now — marked *needs verification* per the truth
  rule).

## 7. Dependency list (asked per rules — approval of this ADR approves these)

| Package | Kind | Approx. size | Why |
| --- | --- | --- | --- |
| `electron` | dev | ~100 MB download (embedded Chromium+Node; ships in installer) | Runtime shell |
| `electron-builder` | dev | ~25 MB incl. deps (build machine only) | NSIS packaging + SHA256SUMS |
| `electron-updater` | runtime (main) | ~1 MB | A7 auto-update |
| `vite` + `@vitejs/plugin-react` | dev | ~50 MB on disk, build machine only | Renderer bundling; main/preload stay plain `tsc` (repo convention) |
| `react`, `react-dom` + matching `@types/*` | runtime (bundled) | ~55 KB gzipped in bundle; types dev-only | UI framework — largest ecosystem, best TS story; plain CSS, no component kit |
| `@supabase/supabase-js` | runtime (main) | ~120 KB gzipped | Team layer (auth + PostgREST); main process only |
| — | — | — | No zod addition (core already has it); no CSS framework; no router (single-window view state); no state lib (React state + IPC callbacks) |

pnpm build-script allowlist (`pnpm-workspace.yaml` `allowBuilds`) gains
`electron` (postinstall downloads the binary) — mechanism verified at A2, and
CI build is the regression guard. All caches (`ELECTRON_CACHE`,
`electron-builder` cache, `vite` cache) redirected to D:.

## 8. Day estimates (realistic, solo, includes tests+docs)

| Milestone | Days |
| --- | --- |
| A2 Monorepo wiring + IPC + CI build | 1 |
| A3 Local mode UI | 3–4 |
| A4 Schema + migrations + setup.sql + DATABASE.md | 1.5–2 |
| A5 DB tests (needs WSL2+Docker installed by owner first) | 1–1.5 |
| A6 Team features + upload gate + service-role pattern guard | 3–4 |
| A7 Installer + update E2E | 1–2 |
| A8 E2E on this PC + real screenshots | 1 |
| A9 Docs + release candidate | 1 |
| **Total** | **12.5–17 dev-days** |

## 9. Open questions for the owner (answer with "approved" or alongside)

1. **Dependency list** — approve the 6 additions in §7?
2. **Signing** — confirm: unsigned in Phase A (SmartScreen warning documented),
   signing researched properly at roadmap G.
3. **Auto-update** — build it in A7 (generic provider, end-to-end tested), or
   document manual updates for now? Recommendation: build it.
4. **App identity** — name/product id for installer metadata: propose
   "Project Runtime" desktop app, product id `Runtime.Desktop`, exe
   `runtime-desktop.exe`.
5. **React** — OK, or prefer a lighter option (Preact ~4 KB)? Recommendation:
   React.

## 10. Honesty constraints carried into all Phase A text

Not built and must be listed as such wherever the app, README, or release
notes describe scope: GitHub App PR enforcement (webhooks cannot reach a
desktop app — enforcement is a later hosted phase), MCP gateway, skills,
living context, AST checks, import mode, macOS/Linux builds, code signing.

## Sources (official, fetched 2026-11-07)

- Electron security tutorial — contextIsolation/nodeIntegration/sandbox
  defaults, CSP, IPC sender validation, remote-content rules:
  https://www.electronjs.org/docs/latest/tutorial/security
- Electron `safeStorage` — DPAPI on Windows, main-process-only API, caveats:
  https://www.electronjs.org/docs/latest/api/safe-storage
- electron-builder auto-update — "Windows: NSIS", "Squirrel.Windows is not
  supported", providers incl. generic HTTP(s), sha512 verification, signed
  manifests, "macOS application must be signed in order for auto updating to
  work" (Windows unsigned updates install with sha512 checks):
  https://www.electron.build/docs/features/auto-update
- electron-builder signed update manifests — "electron-updater always verifies
  the sha512 checksum of a downloaded artifact against the update manifest":
  https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/signed-update-manifests.md
- Tauri v2 prerequisites — "Desktop development with C++" Build Tools workload,
  Rust MSVC toolchain, WebView2 (present on Win10 1803+), VBSCRIPT for MSI:
  https://v2.tauri.app/start/prerequisites/
- Tauri v2 updater — "Tauri's updater needs a signature to verify that the
  update is from a trusted source. This cannot be disabled."; key loss = cannot
  publish updates: https://v2.tauri.app/plugin/updater/
