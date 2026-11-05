import { LineCounter, parseDocument } from "yaml";
import type { Document, Node } from "yaml";

export interface SourcePos {
  /** 1-based line number */
  line: number;
  /** 1-based column */
  col: number;
}

export interface PositionedDocument {
  doc: Document;
  counter: LineCounter;
}

export function parseYamlWithPositions(src: string): PositionedDocument {
  const counter = new LineCounter();
  const doc = parseDocument(src, { lineCounter: counter });
  return { doc, counter };
}

export function posAt(positioned: PositionedDocument, index: number): SourcePos {
  const { line, col } = positioned.counter.linePos(index);
  return { line, col };
}

/**
 * Renders a schema path (`["checks", 1, "pattern"]`) for error output:
 * `checks[1].pattern`.
 */
export function formatSchemaPath(path: ReadonlyArray<string | number>): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out;
}

/**
 * Walks the YAML AST along a schema path and returns the start position of
 * the value found there. Best effort: if a segment cannot be resolved, the
 * position of the deepest resolved node is used; `undefined` when even the
 * document root has no range (e.g. an empty document).
 */
export function findNodePos(
  positioned: PositionedDocument,
  path: ReadonlyArray<string | number>,
): SourcePos | undefined {
  let node: Node | undefined = positioned.doc.contents ?? undefined;
  for (const segment of path) {
    if (node === undefined) break;
    const container = node as { get?: (key: unknown, keepNode?: boolean) => Node | undefined };
    if (typeof container.get !== "function") break;
    const next = container.get(segment, true);
    if (next === undefined || next === null) break;
    node = next;
  }
  if (node === undefined || node.range == null) return undefined;
  return posAt(positioned, node.range[0]);
}
