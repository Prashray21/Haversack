import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload (ADR 001 §5): the ONLY bridge. Exposes a single invoke function
 * over the fixed channel; no fs, no Node, no network authority. The main
 * process validates every invocation (sender frame + zod schema), so the
 * bridge itself carries no authorization.
 */
contextBridge.exposeInMainWorld("haversack", {
  invoke: (op: string, payload: unknown): Promise<unknown> => ipcRenderer.invoke("engine.invoke", op, payload),
});
