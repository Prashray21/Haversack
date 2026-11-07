import { attachGeneratedHeader } from "./header.js";
import type { CompiledProject, GeneratedFile, TargetAdapter } from "./types.js";
import type { SourceFile } from "../parse/load.js";

export const CURSOR_MDC_PATH = ".cursor/rules/haversack.mdc";

/** Legacy output path from the Project Runtime era — migrated by sync (ADR 002 §3.4). */
export const LEGACY_CURSOR_MDC_PATH = ".cursor/rules/runtime.mdc";

export const CURSOR_ADAPTER_VERSION = 1;

function inlineSection(title: string, files: SourceFile[]): string {
  if (files.length === 0) return "";
  const blocks = files.map((file) => `### ${file.path}\n\n${file.content.trimEnd()}`);
  return `## ${title}\n\n${blocks.join("\n\n")}\n`;
}

/**
 * Compiles the definition into Cursor's native project rules
 * (.cursor/rules/haversack.mdc — format verified against
 * https://cursor.com/docs/context/rules).
 *
 * The .mdc structure is: frontmatter first, generated header second (D5 —
 * header-after-frontmatter placement), then context and rules inlined in
 * project.yaml order. `alwaysApply: true` makes the compiled definition the
 * project's always-on baseline ("Always included. Globs and description are
 * ignored.").
 *
 * Output is deterministic (D5): the same CompiledProject always produces the
 * same bytes, which the drift manifest depends on.
 */
export const cursorAdapter: TargetAdapter = {
  id: "cursor",
  version: CURSOR_ADAPTER_VERSION,

  generate(project: CompiledProject): GeneratedFile[] {
    const { config, sources } = project;

    const context = sources.filter((s) => config.context.includes(s.path));
    const rules = sources.filter((s) => config.rules.includes(s.path));

    const parts = [
      `# ${config.project}`,
      config.description ?? "",
      inlineSection("Project context", context),
      inlineSection("Rules", rules),
    ].filter((part) => part !== "");

    const joined = parts.join("\n\n");
    const body = joined.endsWith("\n") ? joined : `${joined}\n`;

    // Frontmatter first, so after-frontmatter placement puts the generated
    // header directly after the closing fence (the documented .mdc structure).
    const withFrontmatter = `---\nalwaysApply: true\n---\n\n${body}`;
    const content = attachGeneratedHeader(withFrontmatter, {
      adapterId: "cursor",
      adapterVersion: CURSOR_ADAPTER_VERSION,
      placement: "after-frontmatter",
    });
    return [{ path: CURSOR_MDC_PATH, content }];
  },
};
