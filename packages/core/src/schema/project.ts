import { z } from "zod";

export const RUNTIME_SPEC_VERSION = 1;

/* ── predicates (used in schema refinements) ────────────────── */

/** Repo-relative POSIX path; no traversal, no absolute paths, no empty segments. */
export function isSafeRepoPath(p: string): boolean {
  if (p.length === 0 || p.length > 260) return false;
  if (p.includes("\\")) return false;
  if (p.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Forward-slash glob relative to the repo root. */
export function isSaneGlob(g: string): boolean {
  if (g.length === 0 || g.includes("\\")) return false;
  if (g.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(g)) return false;
  return true;
}

export function compilesAsRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/* ── primitives ─────────────────────────────────────────────── */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const identifierSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(KEBAB, "must be kebab-case (lowercase letters, digits, dashes)");

export const checkIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(KEBAB, "check id must be kebab-case");

export const repoPathSchema = z.string().refine(isSafeRepoPath, {
  message: "must be a relative repo path with forward slashes (no '..', no leading '/')",
});

export const globSchema = z.string().refine(isSaneGlob, {
  message: "must be a forward-slash glob relative to the repo root",
});

export const severitySchema = z.enum(["block", "warn", "info"]);

export const targetIdSchema = z.enum(["claude-code", "cursor", "copilot"]);

const regexField = (what: string) =>
  z
    .string()
    .max(500, `${what} must be at most 500 characters (bounds evaluation work)`)
    .refine(compilesAsRegex, {
      message: `${what} must be a valid JavaScript regular expression`,
    });

/* ── checks (F2) ────────────────────────────────────────────── */

export const staticCheckSchema = z.strictObject({
  id: checkIdSchema,
  type: z.literal("static"),
  severity: severitySchema.default("warn"),
  description: z.string().optional(),
  path: z.union([globSchema, z.array(globSchema).min(1)]).default("**"),
  exclude: z.array(globSchema).default([]),
  pattern: regexField("pattern"),
  flags: z.array(z.enum(["i", "m", "s", "u"])).default([]),
  message: z.string().min(1),
  fix: z.string().optional(),
});

export const llmCheckSchema = z.strictObject({
  id: checkIdSchema,
  type: z.literal("llm"),
  severity: severitySchema.default("warn"),
  description: z.string().optional(),
  /** Cost control (F2.6): only changed files matching these globs reach the judge. */
  paths: z.array(globSchema).min(1),
  prompt: z.string().min(1).max(4_000),
  fix: z.string().optional(),
});

export const checkSchema = z.discriminatedUnion("type", [staticCheckSchema, llmCheckSchema]);

/* ── secret scanning config (D8) ────────────────────────────── */

export const secretsConfigSchema = z.strictObject({
  /** Regexes matched against each scanned LINE; a match skips that line. */
  ignore: z
    .array(
      z.strictObject({
        pattern: regexField("ignore pattern"),
        reason: z.string().max(200).optional(),
      }),
    )
    .max(50)
    .default([]),
});

/* ── integrations (validated but inert in MVP; gateway = Phase 2, D7) ── */

export const integrationSchema = z.strictObject({
  scopes: z.array(z.string().min(1)).default([]),
});

/* ── model policy (F2.6, §11, D4) ───────────────────────────── */

export const modelPolicySchema = z.strictObject({
  pin: z.boolean().default(true),
  /** Judge model id (F2.2). Comes from config — never hardcoded. Pinned and recorded per run. */
  model: z.string().min(1).max(120).optional(),
  budget: z
    .strictObject({
      /** USD cap for one check run. */
      usd_per_run: z.number().positive().optional(),
      /** USD cap per project per calendar month (UTC). */
      usd_per_month: z.number().positive().optional(),
      /** Per-1M-token prices used to compute USD from token usage; recorded per run (D4). */
      usd_per_1m_input: z.number().positive().optional(),
      usd_per_1m_output: z.number().positive().optional(),
    })
    .optional(),
});

/* ── top level ──────────────────────────────────────────────── */

export const projectConfigSchema = z.strictObject({
  runtime: z.literal(RUNTIME_SPEC_VERSION),
  project: identifierSchema,
  description: z.string().max(280).optional(),
  context: z.array(repoPathSchema).max(50).default([]),
  rules: z.array(repoPathSchema).max(50).default([]),
  targets: z.array(targetIdSchema).min(1).max(10),
  integrations: z.record(identifierSchema, integrationSchema).default({}),
  checks: z.array(checkSchema).max(200).default([]),
  model_policy: modelPolicySchema.default({ pin: true }),
  secrets: secretsConfigSchema.default({ ignore: [] }),
});

export const TOP_LEVEL_KEYS: string[] = Object.keys(projectConfigSchema.shape);

/* ── inferred types (post-defaults) ─────────────────────────── */

export type Severity = z.output<typeof severitySchema>;
export type TargetId = z.output<typeof targetIdSchema>;
export type StaticCheck = z.output<typeof staticCheckSchema>;
export type LlmCheck = z.output<typeof llmCheckSchema>;
export type Check = z.output<typeof checkSchema>;
export type Integration = z.output<typeof integrationSchema>;
export type ModelPolicy = z.output<typeof modelPolicySchema>;
export type SecretsConfig = z.output<typeof secretsConfigSchema>;
export type ProjectConfig = z.output<typeof projectConfigSchema>;
