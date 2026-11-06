import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type SourceFileErrorCode = "missing" | "not_a_file" | "too_large" | "unsafe_path" | "unreadable";

export class SourceFileError extends Error {
  constructor(
    public readonly code: SourceFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SourceFileError";
  }
}

/**
 * Canonical text form: BOM stripped, CRLF/CR folded to LF. All hashing and
 * comparison happens on this form so hashes are stable across platforms
 * (decision D5).
 */
export function normalizeText(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return withoutBom.replace(/\r\n?/g, "\n");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface RepoTextFile {
  content: string; // LF-normalized
  sha256: string; // sha256 of the normalized content
  bytes: number; // raw byte size on disk
}

/** Reads a UTF-8 text file from the repo, normalized and hashed. */
export async function readRepoTextFile(
  repoRoot: string,
  relPath: string,
  maxBytes: number,
): Promise<RepoTextFile> {
  const rootAbs = path.resolve(repoRoot);
  const abs = path.resolve(rootAbs, relPath);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new SourceFileError("unsafe_path", `${relPath} resolves outside the repo root`);
  }

  // Symlink safety: resolve the real location of the root and the file BEFORE
  // any content is read. A link (symlink or Windows junction) that lands
  // outside the real repo root is rejected without its content being read.
  // realpath also normalizes 8.3 short paths and case, keeping the comparison
  // reliable on Windows CI.
  let realRoot: string;
  let realAbs: string;
  try {
    [realRoot, realAbs] = await Promise.all([realpath(rootAbs), realpath(abs)]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new SourceFileError("missing", `${relPath} does not exist in this repo (typo? check the path)`);
    }
    throw new SourceFileError("unreadable", `${relPath} could not be resolved: ${String(error)}`);
  }
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
    throw new SourceFileError("unsafe_path", `${relPath} resolves outside the repo root (symlink?)`);
  }

  let raw: Buffer;
  try {
    raw = await readFile(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EISDIR") {
      throw new SourceFileError("not_a_file", `${relPath} is a directory, not a file`);
    }
    throw new SourceFileError("unreadable", `${relPath} could not be read: ${String(error)}`);
  }

  if (raw.byteLength > maxBytes) {
    throw new SourceFileError(
      "too_large",
      `${relPath} is ${(raw.byteLength / 1024).toFixed(1)} KB — the per-file cap is ${Math.round(maxBytes / 1024)} KB (split the file or raise the cap)`,
    );
  }

  const content = normalizeText(raw.toString("utf8"));
  return { content, sha256: sha256Hex(content), bytes: raw.byteLength };
}
