import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import { MAX_SOURCE_FILE_BYTES } from "../constants.js";
import { RUNTIME_SPEC_VERSION, projectConfigSchema, TOP_LEVEL_KEYS } from "../schema/project.js";
import type { ProjectConfig } from "../schema/project.js";
import { readRepoTextFile, SourceFileError } from "./files.js";
import { findNodePos, formatSchemaPath, parseYamlWithPositions, posAt } from "./positions.js";
import type { PositionedDocument } from "./positions.js";

export const DEFAULT_CONFIG_FILE = "project.yaml";

export interface SourceFile {
  /** Repo-relative POSIX path, as written in project.yaml. */
  path: string;
  /** File content, LF-normalized (D5). */
  content: string;
  /** sha256 of the normalized content. */
  sha256: string;
}

export interface RuntimeWarning {
  code: string;
  message: string;
}

export interface LoadResult {
  config: ProjectConfig;
  /** context + rules files, in project.yaml order. */
  sources: SourceFile[];
  /** sha256 over the canonical config + source hashes; changes whenever the definition changes. */
  definitionHash: string;
  warnings: RuntimeWarning[];
  /** Repo-relative path of the config file that was loaded. */
  configPath: string;
}

export class LoadError extends Error {
  constructor(public readonly report: string) {
    super(report);
    this.name = "LoadError";
  }
}

/** The file declares a `runtime:` spec version this CLI does not support (exit code 2). */
export class SpecVersionError extends LoadError {
  constructor(
    report: string,
    public readonly received: unknown,
  ) {
    super(report);
    this.name = "SpecVersionError";
  }
}

export interface LoadOptions {
  /** Repo root; project.yaml is resolved against it. */
  cwd: string;
  fileName?: string;
}

export async function loadProject(options: LoadOptions): Promise<LoadResult> {
  const fileName = options.fileName ?? DEFAULT_CONFIG_FILE;
  const absPath = path.resolve(options.cwd, fileName);

  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new LoadError(
        `✘ ${fileName} not found in ${options.cwd}\n  create a ${fileName} to define this project for Runtime`,
      );
    }
    throw new LoadError(`✘ ${fileName} could not be read (error code: ${code ?? "unknown"})`);
  }

  const positioned = parseYamlWithPositions(raw);
  if (positioned.doc.errors.length > 0) {
    throw new LoadError(formatYamlErrors(positioned, fileName));
  }

  const json = positioned.doc.toJS();
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new LoadError(
      `✘ ${fileName}\n  the file must contain a YAML mapping (key: value), not ${describeValue(json)}`,
    );
  }

  const parsed = projectConfigSchema.safeParse(json);
  if (!parsed.success) {
    const specError = findSpecVersionIssue(parsed.error.issues, json as Record<string, unknown>);
    if (specError) throw specError;
    throw new LoadError(formatSchemaIssues(positioned, parsed.error.issues, fileName));
  }

  const config = parsed.data;

  const crossErrors = [
    ...duplicateCheckIdErrors(positioned, config.checks.map((c) => c.id)),
    ...duplicateTargetErrors(positioned, config.targets),
    ...regexDetailErrors(positioned, config.checks),
  ];
  if (crossErrors.length > 0) throw new LoadError(crossErrors.join("\n"));

  const { sources, errors: sourceErrors, warnings: sourceWarnings } = await loadSources(
    options.cwd,
    positioned,
    config,
  );
  if (sourceErrors.length > 0) throw new LoadError(sourceErrors.join("\n"));

  const warnings: RuntimeWarning[] = sourceWarnings;
  if (Object.keys(config.integrations).length > 0) {
    warnings.push({
      code: "integrations_inert",
      message: "integrations are validated but not enforced in this MVP (the gateway ships in Phase 2)",
    });
  }

  return {
    config,
    sources,
    definitionHash: computeDefinitionHash(config, sources),
    warnings,
    configPath: fileName,
  };
}

/* ── definition hash ────────────────────────────────────────── */

function computeDefinitionHash(config: ProjectConfig, sources: SourceFile[]): string {
  const canonical = JSON.stringify({
    config,
    sources: sources.map((s) => ({ path: s.path, sha256: s.sha256 })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/* ── YAML-level errors ──────────────────────────────────────── */

function formatYamlErrors(positioned: PositionedDocument, fileName: string): string {
  return positioned.doc.errors
    .map((error) => {
      const pos = errorPos(positioned, error);
      return `✘ ${fileName}${pos ? `:${pos.line}:${pos.col}` : ""}\n  YAML parse error: ${error.message}`;
    })
    .join("\n");
}

function errorPos(positioned: PositionedDocument, error: unknown): { line: number; col: number } | undefined {
  const pos = (error as { pos?: [number, number] }).pos;
  const start = pos?.[0];
  if (typeof start !== "number") return undefined;
  return posAt(positioned, start);
}

function describeValue(value: unknown): string {
  if (value === null) return "nothing (the file is empty or only comments)";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/* ── schema-level errors ────────────────────────────────────── */

function findSpecVersionIssue(
  issues: ZodIssue[],
  json: Record<string, unknown>,
): SpecVersionError | undefined {
  const runtimeIssue = issues.find((i) => i.path.length === 1 && String(i.path[0]) === "runtime");
  if (!runtimeIssue) return undefined;
  const received = json.runtime;
  if (received === undefined) return undefined; // missing field: a normal required-field error
  const report = [
    `✘ project.yaml — runtime`,
    `  this file declares runtime spec version ${JSON.stringify(received)}`,
    `  this CLI supports spec version ${RUNTIME_SPEC_VERSION} — upgrade the CLI, or set 'runtime: ${RUNTIME_SPEC_VERSION}'`,
  ].join("\n");
  return new SpecVersionError(report, received);
}

function formatSchemaIssues(
  positioned: PositionedDocument,
  issues: ZodIssue[],
  fileName: string,
): string {
  return issues
    .map((issue) => {
      const schemaPath = issue.path as ReadonlyArray<string | number>;
      const pos = findNodePos(positioned, schemaPath);
      const where = `${fileName}${pos ? `:${pos.line}:${pos.col}` : ""}`;
      const label = formatSchemaPath(schemaPath);
      let text = `✘ ${where}${label ? ` — ${label}` : ""}\n  ${issue.message}`;

      if (issue.code === "unrecognized_keys" && schemaPath.length === 0) {
        const keys = (issue as unknown as { keys?: string[] }).keys ?? [];
        for (const key of keys) {
          const suggestion = didYouMean(key, TOP_LEVEL_KEYS);
          text += suggestion
            ? `\n  hint: unknown field '${key}' — did you mean '${suggestion}'?`
            : `\n  hint: unknown field '${key}' — allowed fields: ${TOP_LEVEL_KEYS.join(", ")}`;
        }
      }
      return text;
    })
    .join("\n");
}

/* ── cross-field validation (after the schema, with positions) ─ */

function duplicateCheckIdErrors(positioned: PositionedDocument, ids: string[]): string[] {
  const byId = new Map<string, number[]>();
  ids.forEach((id, index) => {
    const list = byId.get(id) ?? [];
    list.push(index);
    byId.set(id, list);
  });

  const errors: string[] = [];
  for (const [id, indexes] of byId) {
    if (indexes.length < 2) continue;
    const positions = indexes.map((i) => {
      const pos = findNodePos(positioned, ["checks", i, "id"]);
      return pos ? `project.yaml:${pos.line}:${pos.col}` : `checks[${i}]`;
    });
    errors.push(
      `✘ ${positions.join(", ")} — checks[].id\n  duplicate check id '${id}' — ids must be unique across all checks`,
    );
  }
  return errors;
}

function duplicateTargetErrors(positioned: PositionedDocument, targets: string[]): string[] {
  const seen = new Map<string, number>();
  const errors: string[] = [];
  targets.forEach((target, index) => {
    const first = seen.get(target);
    if (first === undefined) {
      seen.set(target, index);
      return;
    }
    const pos = findNodePos(positioned, ["targets", index]);
    errors.push(
      `✘ project.yaml${pos ? `:${pos.line}:${pos.col}` : ""} — targets[${index}]\n  duplicate target '${target}' (first listed at targets[${first}])`,
    );
  });
  return errors;
}

function regexDetailErrors(positioned: PositionedDocument, checks: ProjectConfig["checks"]): string[] {
  const errors: string[] = [];
  checks.forEach((check, index) => {
    if (check.type !== "static") return;
    try {
      new RegExp(check.pattern, check.flags.join(""));
    } catch (error) {
      const pos = findNodePos(positioned, ["checks", index, "pattern"]);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(
        `✘ project.yaml${pos ? `:${pos.line}:${pos.col}` : ""} — checks[${index}].pattern\n  '${check.pattern}' is not a valid regular expression: ${message}`,
      );
    }
  });
  return errors;
}

/* ── source files (context + rules) ─────────────────────────── */

async function loadSources(
  cwd: string,
  positioned: PositionedDocument,
  config: ProjectConfig,
): Promise<{ sources: SourceFile[]; errors: string[]; warnings: RuntimeWarning[] }> {
  const sources: SourceFile[] = [];
  const errors: string[] = [];
  const warnings: RuntimeWarning[] = [];
  const seen = new Map<string, string>();

  for (const kind of ["context", "rules"] as const) {
    const list = config[kind];
    for (let index = 0; index < list.length; index++) {
      const relPath = list[index];
      if (relPath === undefined) continue;

      const earlier = seen.get(relPath);
      if (earlier !== undefined) {
        warnings.push({
          code: "duplicate_reference",
          message: `${relPath} is referenced by both '${earlier}' and '${kind}' — it will be inlined twice`,
        });
      } else {
        seen.set(relPath, kind);
      }

      try {
        const file = await readRepoTextFile(cwd, relPath, MAX_SOURCE_FILE_BYTES);
        sources.push({ path: relPath, content: file.content, sha256: file.sha256 });
      } catch (error) {
        if (error instanceof SourceFileError) {
          const pos = findNodePos(positioned, [kind, index]);
          errors.push(
            `✘ project.yaml${pos ? `:${pos.line}:${pos.col}` : ""} — ${kind}[${index}]\n  ${error.message}`,
          );
        } else {
          throw error;
        }
      }
    }
  }
  return { sources, errors, warnings };
}

/* ── did-you-mean ───────────────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n] ?? Math.max(m, n);
}

export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== undefined && bestDistance <= 2 ? best : undefined;
}
