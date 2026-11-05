import { hasGeneratedHeader } from "../adapters/header.js";
import { hashContent } from "./manifest.js";
import { normalizeText } from "../parse/files.js";
import type { ManifestFileEntry } from "./manifest.js";

/**
 * Drift states (D5):
 * - new:          not on disk → write
 * - unchanged:    disk already matches the generated output → nothing to do
 * - stale:        disk matches the last sync (or is clearly ours) → rewrite
 * - hand-edited:  disk differs from the last sync → report drift, skip unless --force
 * - untracked:    not ours (no manifest entry, no header) → never overwrite without --force
 *
 * All comparison happens on canonical (BOM-stripped, LF-normalized) content,
 * so callers may pass raw disk bytes-in-text as-is.
 */
export type DriftState = "unchanged" | "stale" | "hand-edited" | "untracked" | "new";

export function assessGeneratedFile(opts: {
  generated: string;
  /** Raw disk content (any line endings), or undefined when the file is missing. */
  onDisk: string | undefined;
  manifestEntry: ManifestFileEntry | undefined;
}): DriftState {
  const { generated, onDisk, manifestEntry } = opts;

  if (onDisk === undefined) return "new";
  const disk = normalizeText(onDisk);
  const expected = normalizeText(generated);

  if (disk === expected) return "unchanged";
  if (manifestEntry && hashContent(disk) === manifestEntry.sha256) return "stale";
  if (manifestEntry) return "hand-edited";

  // No manifest entry. Our header is strong evidence we produced the file in
  // the past and the manifest was lost — treat it as stale (safe to rewrite).
  // Anything else is somebody else's file.
  return hasGeneratedHeader(disk) ? "stale" : "untracked";
}

/**
 * Manifest-tracked paths that are no longer generated (e.g. a target was
 * removed from project.yaml). Callers scope this to the adapters that ran.
 */
export function findOrphans(
  manifestFiles: Record<string, ManifestFileEntry>,
  generatedPaths: ReadonlySet<string>,
): string[] {
  return Object.keys(manifestFiles)
    .filter((p) => !generatedPaths.has(p))
    .sort();
}
