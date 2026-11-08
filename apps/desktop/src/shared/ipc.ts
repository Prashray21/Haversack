import { z } from "zod";

/**
 * The FIXED IPC channel set (ADR 001 §5: fixed channels, sender-frame +
 * zod validation in the main process on every message). The renderer never
 * gets Node, fs, or network authority — it can only invoke these ops with
 * payloads that validate here.
 */

/** Ops the utility process (engine) implements — one zod schema each; the
 *  main process forwards nothing that does not validate. Paths are absolute
 *  and decided by the main process or the user's own folder picker; the
 *  engine never receives free-form "run this" instructions. */
export const engineOps = [
  "engine.ping",
  "inventory.list",
  "ingest.skill.folder",
  "ingest.skill.zip",
  "ingest.skill.git",
  "plan.skills",
  "plan.mcp",
  "apply.run",
  "undo.run",
  "uninstall.skill",
  "uninstall.mcp",
] as const;

export type EngineOp = (typeof engineOps)[number];

const absolutePath = z.string().min(1).max(1024);

export const scopeSchema = z.enum(["user", "project"]);

export const ingestResultSchema = z.object({
  item: z.any(), // full validation happened inside core; the UI renders a preview
  flags: z.array(
    z.object({
      code: z.string(),
      path: z.string(),
      detail: z.string(),
    }),
  ),
});

export const requestSchemas = {
  "engine.ping": z.object({}).strict(),
  "inventory.list": z
    .object({
      home: absolutePath,
      projectRoot: absolutePath.optional(),
    })
    .strict(),
  "ingest.skill.folder": z.object({ dir: absolutePath, name: z.string().min(1).max(64).optional() }).strict(),
  "ingest.skill.zip": z
    .object({
      /** base64 of the zip bytes (file picker result). Capped at the 20 MB compressed limit + b64 slack. */
      fileBase64: z.string().max(28 * 1024 * 1024),
      name: z.string().min(1).max(64),
    })
    .strict(),
  "ingest.skill.git": z
    .object({
      url: z.string().min(1).max(2048),
      commit: z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i),
      name: z.string().min(1).max(64).optional(),
      workDir: absolutePath.optional(),
    })
    .strict(),
  "plan.skills": z
    .object({
      items: z.array(z.any()).min(1).max(50), // SkillItems built by ingest; core re-validates
      scope: scopeSchema,
      home: absolutePath,
      projectRoot: absolutePath.optional(),
    })
    .strict(),
  "plan.mcp": z
    .object({
      item: z.any(),
      scope: scopeSchema,
      home: absolutePath,
      projectRoot: absolutePath.optional(),
      /** Placeholder values come from the OS-protected store in the MAIN process and are
       *  passed here only for user scope; project scope always expands placeholders. */
      secretValues: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  "apply.run": z.object({ steps: z.array(z.any()).min(1).max(50) }).strict(),
  "undo.run": z.object({ records: z.array(z.any()).min(1).max(50) }).strict(),
  "uninstall.skill": z
    .object({
      name: z.string().min(1).max(64),
      scope: scopeSchema,
      home: absolutePath,
      force: z.boolean().optional(),
    })
    .strict(),
  "uninstall.mcp": z
    .object({
      name: z.string().min(1).max(64),
      scope: scopeSchema,
      home: absolutePath,
      force: z.boolean().optional(),
    })
    .strict(),
} as const;

export type EngineRequest = { [K in EngineOp]: z.infer<(typeof requestSchemas)[K]> }[EngineOp];

export interface EngineResponse {
  reqId: number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}
