import { attachGeneratedHeader } from "./header.js";
import type { CompiledProject, GeneratedFile, TargetAdapter } from "./types.js";
import type { SourceFile } from "../parse/load.js";

export const COPILOT_INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
export const COPILOT_ADAPTER_VERSION = 1;

function inlineSection(title: string, files: SourceFile[]): string {
  if (files.length === 0) return "";
  const blocks = files.map((file) => `### ${file.path}\n\n${file.content.trimEnd()}`);
  return `## ${title}\n\n${blocks.join("\n\n")}\n`;
}

/**
 * Compiles the definition into GitHub Copilot's repository-wide custom
 * instructions (.github/copilot-instructions.md — file name, location, and
 * plain-Markdown format verified against docs.github.com).
 *
 * The docs document no frontmatter for this file, so the generated header is
 * prepended and context + rules are inlined in project.yaml order. Output is
 * deterministic (D5).
 */
export const copilotAdapter: TargetAdapter = {
  id: "copilot",
  version: COPILOT_ADAPTER_VERSION,

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
      adapterId: "copilot",
      adapterVersion: COPILOT_ADAPTER_VERSION,
    });
    return [{ path: COPILOT_INSTRUCTIONS_PATH, content }];
  },
};
