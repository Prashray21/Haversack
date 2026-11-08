import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineOp, EngineResponse } from "../shared/ipc.js";

/**
 * Engine client (main process side, ADR 001 §4): owns the utility process,
 * sends one trusted `configure` message at fork, and maps every request to a
 * promise with a HARD timeout — on breach the process is killed and the
 * request fails loudly (never a silent pass).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Pending {
  resolve: (value: EngineResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class EngineClient {
  private child: UtilityProcess | undefined;
  private nextReqId = 1;
  private pending = new Map<number, Pending>();
  private starting: Promise<void> | undefined;

  constructor(
    private readonly dataDir: string,
    private readonly appVersion: string,
  ) {}

  /** Default timeout per op; git ingestion and apply get longer budgets. */
  private timeoutFor(op: EngineOp): number {
    if (op === "ingest.skill.git") return 150_000;
    if (op === "apply.run" || op === "undo.run") return 120_000;
    return 30_000;
  }

  private async ensureStarted(): Promise<UtilityProcess> {
    if (this.child !== undefined) return this.child;
    if (this.starting !== undefined) return this.starting.then(() => this.child as UtilityProcess);
    this.starting = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(path.join(__dirname, "engine.js"));
      let configured = false;
      const configureTimer = setTimeout(() => {
        child.kill();
        reject(new Error("engine configure timed out"));
      }, 15_000);
      child.on("message", (message: unknown) => {
        if (!configured) {
          if (
            message !== null &&
            typeof message === "object" &&
            (message as { configured?: boolean }).configured === true
          ) {
            configured = true;
            clearTimeout(configureTimer);
            this.child = child;
            resolve();
          }
          return;
        }
        const response = message as EngineResponse;
        if (response === null || typeof response !== "object" || typeof response.reqId !== "number") return;
        const pending = this.pending.get(response.reqId);
        if (pending === undefined) return;
        this.pending.delete(response.reqId);
        clearTimeout(pending.timer);
        pending.resolve(response);
      });
      child.on("exit", (code) => {
        this.child = undefined;
        this.starting = undefined;
        for (const [reqId, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`engine exited (code ${String(code)}) while request ${String(reqId)} was pending`));
        }
        this.pending.clear();
        if (!configured) {
          clearTimeout(configureTimer);
          reject(new Error(`engine exited before configure (code ${String(code)})`));
        }
      });
      child.postMessage({
        configure: { dataDir: this.dataDir, appVersion: this.appVersion },
      });
    });
    return this.starting.then(() => this.child as UtilityProcess);
  }

  async invoke(op: EngineOp, payload: unknown): Promise<unknown> {
    const child = await this.ensureStarted();
    const reqId = this.nextReqId++;
    const response = await new Promise<EngineResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        // Hard kill on timeout (ADR 001 §4) — the engine may be stuck in
        // synchronous work that cannot be interrupted; the process boundary
        // is the backstop.
        child.kill();
        this.child = undefined;
        this.starting = undefined;
        reject(new Error(`engine timeout after ${String(this.timeoutFor(op))}ms for ${op} — process killed`));
      }, this.timeoutFor(op));
      this.pending.set(reqId, { resolve, reject, timer });
      child.postMessage({ reqId, op, payload });
    });
    if (!response.ok) {
      const error = new Error(response.error?.message ?? "engine error");
      (error as Error & { code?: string }).code = response.error?.code ?? "engine_error";
      throw error;
    }
    return response.result;
  }

  kill(): void {
    this.child?.kill();
    this.child = undefined;
  }
}
