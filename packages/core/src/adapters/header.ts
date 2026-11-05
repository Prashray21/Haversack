import { GENERATED_HEADER_MARKER } from "../constants.js";
import { RUNTIME_SPEC_VERSION } from "../schema/project.js";

/** Where the header goes relative to the file's own content. */
export type HeaderPlacement = "prepend" | "after-frontmatter";

export interface HeaderCommentStyle {
  open: string;
  close: string;
}

export const HTML_COMMENT: HeaderCommentStyle = { open: "<!--", close: "-->" };

export interface GeneratedHeaderOptions {
  adapterId: string;
  adapterVersion: number;
  style?: HeaderCommentStyle;
  placement?: HeaderPlacement;
}

export function buildGeneratedHeader(
  adapterId: string,
  adapterVersion: number,
  style: HeaderCommentStyle = HTML_COMMENT,
): string {
  const lines = [
    GENERATED_HEADER_MARKER,
    `Source of truth: project.yaml (runtime spec ${RUNTIME_SPEC_VERSION}) · adapter ${adapterId} v${adapterVersion}`,
    "Edit project.yaml or the files it references, then run: runtime sync",
  ];
  const [first, ...rest] = lines;
  return `${style.open} ${first}\n${rest.map((l) => `     ${l}`).join("\n")} ${style.close}`;
}

// Matches a leading MDC/markdown frontmatter block, including its closing fence.
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Attaches the generated-file header to `content` (D5).
 *
 * `after-frontmatter` places the header after a leading `---` frontmatter
 * block (Cursor .mdc files — decision from review); falls back to prepend
 * when no frontmatter is present.
 */
export function attachGeneratedHeader(content: string, options: GeneratedHeaderOptions): string {
  const header = buildGeneratedHeader(options.adapterId, options.adapterVersion, options.style);
  if ((options.placement ?? "prepend") === "after-frontmatter") {
    const match = FRONTMATTER_RE.exec(content);
    if (match) {
      const fence = match[0].replace(/\r?\n$/, "");
      const rest = content.slice(match[0].length);
      return `${fence}\n${header}\n\n${rest}`;
    }
  }
  return `${header}\n\n${content}`;
}

/** True when `content` was produced by Runtime (drift/untracked detection). */
export function hasGeneratedHeader(content: string): boolean {
  return content.includes(GENERATED_HEADER_MARKER);
}
