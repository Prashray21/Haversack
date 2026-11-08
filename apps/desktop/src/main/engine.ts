import path from "node:path";
import { APP_IDENTITY } from "../shared/identity.js";
import type { EngineOp, EngineRequest, EngineResponse } from "../shared/ipc.js";
import { engineOps, requestSchemas } from "../shared/ipc.js";

/**
 * Utility-process entry (ADR 001 §4): all @haversackhq/core operations run
 * HERE, never in the main process; the main process kills this process on
 * timeout. This file is our own code, but it still validates every request
 * against the same zod schemas — defense in depth across the boundary.
 *
 * The MAIN process sends exactly one internal `configure` message after fork
 * (data dir + app version). That message is NOT in the renderer-facing op
 * set, so the renderer can never influence where the ledger lives.
 */

interface Config {
  dataDir: string;
  appVersion: string;
}

let config: Config | undefined;

process.parentPort.on("message", (event: { data: unknown }) => {
  const data = event.data;
  if (
    data !== null &&
    typeof data === "object" &&
    "configure" in (data as Record<string, unknown>) &&
    typeof (data as Record<string, unknown>).configure === "object"
  ) {
    const configure = (data as { configure: { dataDir?: unknown; appVersion?: unknown } }).configure;
    if (typeof configure.dataDir !== "string" || !path.isAbsolute(configure.dataDir)) {
      process.parentPort.postMessage({ ok: false, error: { code: "engine_error", message: "configure: dataDir must be absolute" } });
      return;
    }
    if (typeof configure.appVersion !== "string") {
      process.parentPort.postMessage({ ok: false, error: { code: "engine_error", message: "configure: appVersion missing" } });
      return;
    }
    config = { dataDir: configure.dataDir, appVersion: configure.appVersion };
    process.parentPort.postMessage({ configured: true });
    return;
  }
  const request = data as { reqId: number; op: EngineOp; payload: unknown } | undefined;
  if (
    request === undefined ||
    typeof request !== "object" ||
    typeof request.reqId !== "number" ||
    typeof request.op !== "string"
  ) {
    return; // malformed framing — ignore
  }
  handle(request)
    .then((result) => process.parentPort.postMessage({ reqId: request.reqId, ok: true, result } satisfies EngineResponse))
    .catch((error: unknown) =>
      process.parentPort.postMessage({
        reqId: request.reqId,
        ok: false,
        error: {
          code: (error as { code?: string }).code ?? "engine_error",
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies EngineResponse),
    );
});

async function handle(request: { reqId: number; op: EngineOp; payload: unknown }): Promise<unknown> {
  if (!(engineOps as readonly string[]).includes(request.op)) {
    throw Object.assign(new Error(`unknown op: ${request.op}`), { code: "unknown_op" });
  }
  const schema = requestSchemas[request.op];
  const payload = schema.parse(request.payload) as EngineRequest;
  const core = await import("@haversackhq/core");
  return run(request.op, payload, core);
}

function ledger(core: typeof import("@haversackhq/core")): import("@haversackhq/core").AppliedItemsLedger {
  if (config === undefined) {
    throw Object.assign(new Error("engine not configured"), { code: "engine_error" });
  }
  return new core.AppliedItemsLedger(path.join(config.dataDir, "applied-items.json"));
}

// Op dispatch — each arm maps to ONE explicit core call (no eval, no dynamic fn names).
async function run(op: EngineOp, payload: EngineRequest, core: typeof import("@haversackhq/core")): Promise<unknown> {
  switch (op) {
    case "engine.ping": {
      return { product: APP_IDENTITY.productName, appVersion: config?.appVersion, engine: "utility-process" };
    }
    case "inventory.list": {
      const { home, projectRoot } = payload as { home: string; projectRoot?: string };
      return core.inventoryClaudeCode(core.claudeCodePaths({ home, projectRoot }));
    }
    case "ingest.skill.folder": {
      const { dir, name } = payload as { dir: string; name?: string };
      return core.ingestSkillFolder(dir, { name });
    }
    case "ingest.skill.zip": {
      const { fileBase64, name } = payload as { fileBase64: string; name: string };
      const bytes = Uint8Array.from(Buffer.from(fileBase64, "base64"));
      return core.ingestSkillZip(bytes, name);
    }
    case "ingest.skill.git": {
      const { url, commit, name, workDir } = payload as {
        url: string;
        commit: string;
        name?: string;
        workDir?: string;
      };
      return core.ingestSkillGit(url, commit, { name, workDir });
    }
    case "plan.skills": {
      const { items, scope, home, projectRoot } = payload as {
        items: import("@haversackhq/core").SkillItem[];
        scope: import("@haversackhq/core").InstallScope;
        home: string;
        projectRoot?: string;
      };
      const paths = core.claudeCodePaths({ home, projectRoot });
      const steps: import("@haversackhq/core").PlanStep[] = [];
      for (const item of items) steps.push(await core.planSkillInstall(item, scope, paths));
      return steps;
    }
    case "plan.mcp": {
      const { item, scope, home, projectRoot, secretValues } = payload as {
        item: import("@haversackhq/core").McpItem;
        scope: import("@haversackhq/core").InstallScope;
        home: string;
        projectRoot?: string;
        secretValues?: Record<string, string>;
      };
      return core.planMcpInstall(item, scope, core.claudeCodePaths({ home, projectRoot }), { secretValues });
    }
    case "apply.run": {
      const { steps } = payload as { steps: import("@haversackhq/core").PlanStep[] };
      return core.applyPlan(steps, { ledger: ledger(core) });
    }
    case "undo.run": {
      const { records } = payload as { records: import("@haversackhq/core").AppliedRecord[] };
      return core.undoApplied(records, { ledger: ledger(core) });
    }
    case "uninstall.skill": {
      const { name, scope, force } = payload as {
        name: string;
        scope: import("@haversackhq/core").InstallScope;
        force?: boolean;
      };
      const appliedLedger = ledger(core);
      return core.uninstallSkill(name, scope, appliedLedger, { ledger: appliedLedger, force });
    }
    case "uninstall.mcp": {
      const { name, scope, force } = payload as {
        name: string;
        scope: import("@haversackhq/core").InstallScope;
        force?: boolean;
      };
      const appliedLedger = ledger(core);
      return core.uninstallMcp(name, scope, appliedLedger, { ledger: appliedLedger, force });
    }
  }
}

export {};
