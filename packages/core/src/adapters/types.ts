import type { ProjectConfig, TargetId } from "../schema/project.js";
import type { SourceFile } from "../parse/load.js";

/** A project definition fully resolved: validated config + inlined source files. */
export interface CompiledProject {
  config: ProjectConfig;
  /** context + rules files, LF-normalized, in project.yaml order. */
  sources: SourceFile[];
  /** sha256 over the canonical config + source hashes — changes whenever the definition changes. */
  definitionHash: string;
}

/** One file an adapter wants on disk. Repo-relative POSIX path, LF content. */
export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * A target adapter compiles a CompiledProject into a tool's native config.
 *
 * Adapters are PURE: no filesystem, no clock, no randomness — the same
 * CompiledProject must always produce the same files (the drift manifest
 * depends on it).
 *
 * Adding a target: one new file in adapters/ plus one line in registry.ts
 * (PRD F1.5).
 */
export interface TargetAdapter {
  readonly id: TargetId;
  /** Bump when the output format changes in a way that matters for drift. */
  readonly version: number;
  generate(project: CompiledProject): GeneratedFile[];
}
