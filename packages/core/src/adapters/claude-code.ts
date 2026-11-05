import { attachGeneratedHeader } from "./header.js";
import type { CompiledProject, GeneratedFile, TargetAdapter } from "./types.js";
import type { SourceFile } from "../parse/load.js";

export const CLAUDE_MD_PATH = "CLAUDE.md";
export const CLAUDE_CODE_ADAPTER_VERSION = 1;

function inlineSection(title: string, files: SourceFile[]): string {
  if (files.length === 0) return "";
  const blocks = files.map((file) => `### ${file.path}\n\n${file.content.trimEnd()}`);
  return `## ${title}\n\n${blocks.join("\n\n")}\n`;
}

/**
 * Compiles the definition into Claude Code's native project memory
 * (CLAUDE.md): generated header, project title/description, then context and
 * rules inlined in project.yaml order.
 *
 * Output is deterministic (D5): the same CompiledProject always produces the
 * same bytes, which the drift manifest depends on.
 */
export const claudeCodeAdapter: TargetAdapter = {
  id: "claude-code",
  version: CLAUDE_CODE_ADAPTER_VERSION,

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

    const content = attachGeneratedHeader(body, {
      adapterId: "claude-code",
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
      placement: "prepend",
    });

    return [{ path: CLAUDE_MD_PATH, content }];
  },
};
