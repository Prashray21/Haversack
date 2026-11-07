import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a repo file atomically (M3 write safety): the content lands in a
 * sibling temp file first, then a single rename moves it into place. A crash
 * or failure mid-write can never leave a half-written target — the rename is
 * atomic on all supported platforms. The temp file is always removed on
 * failure, so no litter is left behind. Parent directories are created as
 * needed.
 */
export async function writeTextFileAtomic(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = path.resolve(root, relPath);
  const tmp = `${abs}.haversack-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(tmp, content, "utf8");
    await rename(tmp, abs);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
