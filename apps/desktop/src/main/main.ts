import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { APP_IDENTITY } from "../shared/identity.js";
import { engineOps, requestSchemas } from "../shared/ipc.js";
import { EngineClient } from "./engine-client.js";

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
const engine = new EngineClient(path.join(app.getPath("userData"), "data"), app.getVersion());

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
      preload: path.join(__dirname, "preload.js"),
      // Local content only; navigation lockdown below.
      webSecurity: true,
    },
  });
  // Navigation lockdown (ADR 001 §5 item 4): nothing external may take over the window.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) event.preventDefault();
  });
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
    // Only files under the bundled renderer directory are served.
    const rel = path.normalize(decodeURIComponent(url.hostname + url.pathname).replace(/^\/+/, ""));
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
    return new Response(response.body, { status: response.status, headers });
  } catch {
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
    const schema = requestSchemas[op as keyof typeof requestSchemas];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`rejected: invalid payload for ${op}: ${z.prettifyError(parsed.error)}`);
    }
    return engine.invoke(op as keyof typeof requestSchemas, parsed.data);
  });
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
        .then((result) => {
          console.log(`SMOKE_OK ${JSON.stringify(result)}`);
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
