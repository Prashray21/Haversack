import { useEffect, useState } from "react";

/**
 * P3.1 shell: proves the whole pipeline (sandboxed renderer → preload bridge →
 * zod-validated main → utility process → @haversackhq/core). The real
 * local-mode screens land in P3.2.
 */

interface PingResult {
  product?: string;
  appVersion?: string;
  engine?: string;
}

export function App() {
  const [ping, setPing] = useState<PingResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    window.haversack
      .invoke("engine.ping", {})
      .then((result) => setPing(result as PingResult))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="app">
      <h1>Haversack</h1>
      <p className="subtitle">Your team&apos;s skills and MCP servers, installed with one click.</p>
      {error !== undefined && (
        <div role="alert" className="card error">
          Engine error: {error}
        </div>
      )}
      {error === undefined && ping === undefined && (
        <div className="card muted" aria-busy="true">
          Starting the engine…
        </div>
      )}
      {ping !== undefined && (
        <div className="card ok">
          Engine connected ({ping.engine}) · app v{ping.appVersion}
        </div>
      )}
      <p className="muted small">
        Local mode. Local-mode screens (inventory, add, plan preview, apply, undo) arrive with P3.2.
      </p>
    </main>
  );
}
