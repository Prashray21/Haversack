import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { LEGACY_MANIFEST_REL_PATH, MANIFEST_REL_PATH } from "../constants.js";
import { normalizeText, sha256Hex } from "../parse/files.js";
import { writeTextFileAtomic } from "../parse/write.js";

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
  /** Spec version recorded by the writing CLI (ADR 002). */
  haversack?: number;
  /** Legacy field from the Project Runtime era — accepted on read (ADR 002 §3.1). */
  runtime?: number;
  /** e.g. "haversack@0.2.0" (was "runtime@0.1.0") */
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
  /** Repo-relative path the manifest was read from (legacy .runtime/ when adopted). */
  sourcePath: string;
}

export async function readManifest(repoRoot: string): Promise<ReadManifestResult> {
  // Current location first; the legacy Project Runtime location is adopted
  // when the new one does not exist yet (ADR 002 §3.1).
  let raw: string;
  let sourcePath = MANIFEST_REL_PATH;
  try {
    raw = await readFile(manifestAbsPath(repoRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { manifest: undefined, corrupt: true, sourcePath };
    }
    sourcePath = LEGACY_MANIFEST_REL_PATH;
    try {
      raw = await readFile(path.join(repoRoot, LEGACY_MANIFEST_REL_PATH), "utf8");
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
        return { manifest: undefined, corrupt: false, sourcePath: MANIFEST_REL_PATH };
      }
      return { manifest: undefined, corrupt: true, sourcePath };
    }
  }

  try {
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
      return { manifest: parsed, corrupt: false, sourcePath };
    }
    return { manifest: undefined, corrupt: true, sourcePath };
  } catch {
    return { manifest: undefined, corrupt: true, sourcePath };
  }
}

/** Writes the manifest deterministically (LF, sorted keys, trailing newline) and atomically. */
export async function writeManifest(repoRoot: string, manifest: Manifest): Promise<void> {
  const abs = manifestAbsPath(repoRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeTextFileAtomic(repoRoot, path.relative(repoRoot, abs), stableStringify(manifest));
}

/** Hashes any content on the canonical form: BOM-stripped, LF-normalized (D5). */
export function hashContent(content: string): string {
  return sha256Hex(normalizeText(content));
}
