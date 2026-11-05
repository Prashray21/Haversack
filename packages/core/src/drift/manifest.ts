import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_REL_PATH } from "../constants.js";
import { normalizeText, sha256Hex } from "../parse/files.js";

export interface ManifestFileEntry {
  adapter: string;
  adapterVersion: number;
  /** sha256 of the normalized file content as last written by sync. */
  sha256: string;
}

/**
 * The drift manifest (D5). Committed to git so drift is detectable across
 * machines and visible in PRs. Formatting is fully deterministic:
 * recursively sorted keys, 2-space indent, trailing newline.
 */
export interface Manifest {
  runtime: number;
  /** e.g. "runtime@0.1.0" */
  generator: string;
  /** Keyed by repo-relative POSIX path. */
  files: Record<string, ManifestFileEntry>;
}

export function manifestAbsPath(repoRoot: string): string {
  return path.join(repoRoot, MANIFEST_REL_PATH);
}

/** JSON with recursively sorted keys, 2-space indent, and a trailing newline. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, val]) => [key, sortKeysDeep(val)]),
    );
  }
  return value;
}

export interface ReadManifestResult {
  manifest: Manifest | undefined;
  /** True when a manifest exists but could not be parsed. */
  corrupt: boolean;
}

export async function readManifest(repoRoot: string): Promise<ReadManifestResult> {
  let raw: string;
  try {
    raw = await readFile(manifestAbsPath(repoRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { manifest: undefined, corrupt: false };
    }
    return { manifest: undefined, corrupt: true };
  }

  try {
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
      return { manifest: parsed, corrupt: false };
    }
    return { manifest: undefined, corrupt: true };
  } catch {
    return { manifest: undefined, corrupt: true };
  }
}

/** Writes the manifest deterministically (LF, sorted keys, trailing newline). */
export async function writeManifest(repoRoot: string, manifest: Manifest): Promise<void> {
  const abs = manifestAbsPath(repoRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, stableStringify(manifest), "utf8");
}

/** Hashes any content on the canonical form: BOM-stripped, LF-normalized (D5). */
export function hashContent(content: string): string {
  return sha256Hex(normalizeText(content));
}
