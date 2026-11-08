declare global {
  interface Window {
    /** The ONLY bridge (preload contextBridge). See main/preload.ts. */
    haversack: { invoke: (op: string, payload: unknown) => Promise<unknown> };
  }
}

export {};
