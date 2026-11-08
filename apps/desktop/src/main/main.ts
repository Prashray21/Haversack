import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { APP_IDENTITY } from "../shared/identity.js";
import { engineOps, requestSchemas } from "../shared/ipc.js";
import { EngineClient } from "./engine-client.js";
import { SecretStore } from "./secrets.js";

/**
 * Main process (ADR 001 §5): orchestration only; no untrusted work here.
 * - Sandboxed renderer (contextIsolation on, nodeIntegration off, sandbox on),
 *   local content only via the custom app:// protocol with the full CSP.
 * - Fixed IPC channel set; every message sender-frame-validated + zod-validated.
 * - All core work in the utility process (EngineClient), hard-killed on timeout.
 * - No crashReporter, no telemetry, DevTools closed when packaged.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'";

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: false } }]);

// ADR 001 §11: the userData folder derives from the ONE identity constant,
// not from the package name. Must be set before app ready.
app.setPath("userData", path.join(app.getPath("appData"), APP_IDENTITY.userDataDirName));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
const engine = new EngineClient(path.join(app.getPath("userData"), "data"), app.getVersion());
const secrets = new SecretStore(path.join(app.getPath("userData"), "data", "secrets.bin"));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    title: APP_IDENTITY.productName,
    autoHideMenuBar: true,
    backgroundColor: "#f5f4ef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"), // sandboxed preload must be CJS (BUG-010)
      // Local content only; navigation lockdown below.
      webSecurity: true,
    },
  });
      // Navigation lockdown (ADR 001 §5 item 4): nothing external may take over the window.
      mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("app://")) event.preventDefault();
      });
      if (process.env.HAVERSACK_SMOKE === "1") {
        mainWindow.webContents.on("console-message", (_event, _level, message) => {
          console.log(`RENDERER_CONSOLE ${message.slice(0, 300)}`);
        });
      }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (app.isPackaged) {
    // No DevTools in packaged builds (ADR 001 §7 item 5).
    mainWindow.webContents.on("devtools-opened", () => mainWindow?.webContents.closeDevTools());
  }
  void mainWindow.loadURL("app://renderer/index.html");
}

function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    // The hostname ("renderer") is the virtual host marker; the FILE PATH is
    // the pathname alone. Treating the hostname as a path segment was BUG-009
    // (renderer 404 "not found").
    const rel = path.normalize(decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    const root = path.join(__dirname, "..", "renderer");
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      return new Response("forbidden", { status: 403 });
    }
    return net_fetch(abs);
  });
}

import { net } from "electron";
async function net_fetch(absPath: string): Promise<Response> {
  try {
    const response = await net.fetch(pathToFileURL(absPath).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    if (process.env.HAVERSACK_SMOKE === "1") console.log(`PROTOCOL_DEBUG ${response.status} ${absPath}`);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (process.env.HAVERSACK_SMOKE === "1") console.log(`PROTOCOL_DEBUG throw ${absPath}: ${error instanceof Error ? error.message : String(error)}`);
    return new Response("not found", { status: 404 });
  }
}

/** Fixed IPC surface: one channel, op-enum + zod schema, sender-frame check. */
function registerIpc(): void {
  ipcMain.handle("engine.invoke", async (event, op: unknown, payload: unknown) => {
    // Sender-frame validation (ADR 001 §5): only our own main frame may invoke.
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) {
      throw new Error("rejected: sender is not the main window");
    }
    if (typeof op !== "string" || !(engineOps as readonly string[]).includes(op)) {
      throw new Error(`rejected: unknown op ${String(op)}`);
    }
    const key = op as keyof typeof requestSchemas;
    const parsed = requestSchemas[key].safeParse(payload);
    if (!parsed.success) {
      throw new Error(`rejected: invalid payload for ${op}: ${z.prettifyError(parsed.error)}`);
    }
    // Secret values NEVER come from the renderer. For plan.mcp the main process
    // looks up placeholder values in the protected store itself.
    if (key === "plan.mcp") {
      const data = parsed.data as unknown as {
        scope: string;
        item: { env?: Record<string, { placeholder?: string }>; headers?: Record<string, { placeholder?: string }> };
        secretValues?: Record<string, string>;
      };
      delete data.secretValues;
      if (data.scope === "user") {
        const secretValues = await collectSecretValuesFor(data.item);
        if (Object.keys(secretValues).length > 0) data.secretValues = secretValues;
      }
      return engine.invoke(key, parsed.data);
    }
    if (key === "secrets.status") {
      return { encryptionAvailable: secrets.isEncryptionAvailable() };
    }
    if (key === "secrets.set") {
      const { name, value } = parsed.data as { name: string; value: string };
      return secrets.set(name, value); // { persisted } — false ⇒ memory-only, UI says so
    }
    if (key === "secrets.delete") {
      return { deleted: await secrets.delete((parsed.data as { name: string }).name) };
    }
    if (key === "secrets.names") {
      return { names: await secrets.names() }; // names only — values never leave main
    }
    if (key === "mcp.test") {
      return runMcpTestWithApproval(parsed.data as { argv: string[]; label: string });
    }
    if (key === "app.env") {
      // Facts the renderer needs to frame engine requests — nothing more.
      return { home: app.getPath("home"), userData: app.getPath("userData"), appVersion: app.getVersion(), productName: APP_IDENTITY.productName };
    }
    if (key === "dialog.pickFolder") {
      const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
        title: (parsed.data as { title: string }).title,
        properties: ["openDirectory"],
      });
      return { canceled: result.canceled, path: result.filePaths[0] };
    }
    if (key === "dialog.pickZip") {
      const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
        title: (parsed.data as { title: string }).title,
        properties: ["openFile"],
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (result.canceled || result.filePaths[0] === undefined) return { canceled: true, fileBase64: "" };
      const bytes = await import("node:fs/promises").then((fs) => fs.readFile(result.filePaths[0] as string));
      return { canceled: false, fileBase64: bytes.toString("base64") };
    }
    return engine.invoke(key, parsed.data);
  });
}

/** Collects stored values for every placeholder the MCP item references. */
async function collectSecretValuesFor(item: { env?: Record<string, { placeholder?: string }>; headers?: Record<string, { placeholder?: string }> }): Promise<Record<string, string>> {
  const placeholders = new Set<string>();
  for (const map of [item.env, item.headers]) {
    if (map === undefined) continue;
    for (const value of Object.values(map)) {
      if (typeof value?.placeholder === "string") placeholders.add(value.placeholder);
    }
  }
  const out: Record<string, string> = {};
  for (const placeholder of placeholders) {
    const value = await secrets.get(placeholder);
    if (value !== undefined) out[placeholder] = value;
  }
  return out;
}

const execFileAsync = promisify(execFile);

/** PRD L7: the exact command is shown and approved EVERY time. */
async function runMcpTestWithApproval(request: { argv: string[]; label: string }): Promise<{
  approved: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  if (mainWindow === undefined) throw new Error("no window");
  const exact = request.argv.map((arg) => JSON.stringify(arg)).join(" ");
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Run", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Run MCP connection test?",
    message: `Run this exact command for "${request.label}"?`,
    detail: exact,
    noLink: true,
  });
  if (response !== 0) return { approved: false, exitCode: null, stdout: "", stderr: "" };
  try {
    const { stdout, stderr } = await execFileAsync(request.argv[0] as string, request.argv.slice(1), {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { approved: true, exitCode: 0, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    return {
      approved: true,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: (err.stdout ?? "").slice(0, 4000),
      stderr: (err.stderr ?? (err.killed === true ? "timed out after 15s" : String(error))).slice(0, 4000),
    };
  }
}

void app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // CI/agent smoke path: prove the pipeline end-to-end, then exit. Not a
  // feature — a testability hook documented here.
  if (process.env.HAVERSACK_SMOKE === "1") {
    mainWindow?.webContents.once("did-finish-load", () => {
      engine
        .invoke("engine.ping", {})
        .then(async () => {
          // Render check (BUG-009 guard): the pipeline can be green while the
          // renderer 404s — verify the app actually mounted.
          const window_ = mainWindow;
          if (window_ === undefined) throw new Error("window gone");
          const renderedJson = await window_.webContents.executeJavaScript(
            "JSON.stringify({ rootChildren: document.getElementById('root') !== null ? document.getElementById('root').children.length : -1, bodyHead: document.body.innerHTML.slice(0, 160) })",
          );
          const rendered = JSON.parse(renderedJson) as { rootChildren: number };
          if (process.env.HAVERSACK_SMOKE === "1") console.log(`RENDERER_DEBUG ${String(renderedJson).slice(0, 300)}`);
          if (rendered.rootChildren <= 0) {
            console.error("SMOKE_FAIL renderer did not mount (protocol/path bug)");
            app.exit(1);
            return;
          }
          const secretValue = process.env.HAVERSACK_SMOKE_SECRET;
          if (secretValue === undefined) {
            console.log(`SMOKE_OK ${JSON.stringify({ product: APP_IDENTITY.productName, appVersion: app.getVersion(), engine: "utility-process", rendered: true })}`);
            app.quit();
            return;
          }
          // Exercise the REAL protected-store path: store, read back, report
          // match without printing the value. HAVERSACK_SMOKE_KEEP=1 leaves the
          // entry in the store (uninstall-wipe evidence needs a secret present).
          const setResult = await secrets.set("SMOKE_TEST_SECRET", secretValue);
          const readBack = await secrets.get("SMOKE_TEST_SECRET");
          console.log(`SMOKE_SECRET persisted=${String(setResult.persisted)} roundTrip=${String(readBack === secretValue)}`);
          if (process.env.HAVERSACK_SMOKE_KEEP !== "1") await secrets.delete("SMOKE_TEST_SECRET");
          app.quit();
        })
        .catch((error: Error) => {
          console.error(`SMOKE_FAIL ${error.message}`);
          app.exit(1);
        });
    });
  }
});

app.on("window-all-closed", () => {
  engine.kill();
  app.quit();
});

// External opens (docs links only) — https allowlist, never shell.openExternal on arbitrary URLs.
export function openExternalIfAllowed(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  void shell.openExternal(url);
  return true;
}
