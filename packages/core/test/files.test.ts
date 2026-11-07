import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeText, readRepoTextFile, sha256Hex, SourceFileError } from "../src/parse/files.js";
import { writeTextFileAtomic } from "../src/parse/write.js";

describe("normalizeText", () => {
  it("strips a BOM and folds CRLF/CR to LF", () => {
    expect(normalizeText("\uFEFFa\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("leaves LF-only text untouched", () => {
    expect(normalizeText("a\nb\n")).toBe("a\nb\n");
  });
});

describe("sha256Hex", () => {
  it("matches the known empty-input vector", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is stable for the same input", () => {
    expect(sha256Hex("runtime\n")).toBe(sha256Hex("runtime\n"));
  });
});

describe("readRepoTextFile", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function setup(files: Record<string, string>): Promise<string> {
    dir = path.join(tmpdir(), `runtime-files-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return dir;
  }

  it("reads and normalizes a file", async () => {
    const root = await setup({ "ctx/a.md": "b\r\n" });
    const file = await readRepoTextFile(root, "ctx/a.md", 128 * 1024);
    expect(file.content).toBe("b\n");
    expect(file.sha256).toBe(sha256Hex("b\n"));
  });

  it("reports missing files with a typed error", async () => {
    const root = await setup({});
    await expect(readRepoTextFile(root, "nope.md", 128 * 1024)).rejects.toMatchObject({
      code: "missing",
    } satisfies Partial<SourceFileError>);
  });

  it("reports directories as not-a-file", async () => {
    const root = await setup({ "ctx/keep.md": "x\n" });
    await expect(readRepoTextFile(root, "ctx", 128 * 1024)).rejects.toMatchObject({
      code: "not_a_file",
    } satisfies Partial<SourceFileError>);
  });

  it("enforces the size cap", async () => {
    const root = await setup({ "big.md": "y".repeat(129 * 1024) });
    await expect(readRepoTextFile(root, "big.md", 128 * 1024)).rejects.toMatchObject({
      code: "too_large",
    } satisfies Partial<SourceFileError>);
  });

  it("refuses paths that escape the repo root", async () => {
    const root = await setup({});
    await expect(readRepoTextFile(root, "../escape.md", 128 * 1024)).rejects.toMatchObject({
      code: "unsafe_path",
    } satisfies Partial<SourceFileError>);
  });

  it("refuses a symlink/junction that points outside the repo root — its content is never read", async () => {
    const root = await setup({ "ctx/keep.md": "x\n" });
    const outsideDir = path.join(
      tmpdir(),
      `runtime-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(outsideDir, { recursive: true });
    const secretPath = path.join(outsideDir, "secret.txt");
    await writeFile(secretPath, "TOP SECRET OUTSIDE\n");

    let linkCreated = false;
    try {
      if (process.platform === "win32") {
        // Directory junctions need no privilege on Windows and resolve exactly
        // like symlinks; they exercise the same escape.
        await symlink(outsideDir, path.join(root, "ctx/outside-link"), "junction");
      } else {
        await symlink(secretPath, path.join(root, "ctx/link.md"), "file");
      }
      linkCreated = true;
    } catch {
      // The platform refuses link creation entirely; the scenario is
      // exercised wherever it is possible (linux CI).
    }
    if (!linkCreated) {
      await rm(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      const rel = process.platform === "win32" ? path.join("ctx", "outside-link", "secret.txt") : "ctx/link.md";
      await expect(readRepoTextFile(root, rel, 128 * 1024)).rejects.toMatchObject({
        code: "unsafe_path",
      } satisfies Partial<SourceFileError>);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("writeTextFileAtomic", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function mkRoot(files: Record<string, string> = {}): Promise<string> {
    dir = path.join(tmpdir(), `runtime-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return dir;
  }

  it("writes the target exactly and leaves no temp files", async () => {
    const root = await mkRoot();
    await writeTextFileAtomic(root, "gen/CLAUDE.md", "# hi\r\n");
    expect(await readFile(path.join(root, "gen", "CLAUDE.md"), "utf8")).toBe("# hi\r\n");
    const names = await readdir(path.join(root, "gen"));
    expect(names).toEqual(["CLAUDE.md"]);
  });

  it("overwrites an existing file atomically, still without temp litter", async () => {
    const root = await mkRoot({ "out.md": "old\n" });
    await writeTextFileAtomic(root, "out.md", "new\n");
    expect(await readFile(path.join(root, "out.md"), "utf8")).toBe("new\n");
    const names = await readdir(root);
    expect(names.filter((name) => name.includes(".haversack-tmp-"))).toEqual([]);
  });

  it("a failed rename rejects and leaves no temp litter behind", async () => {
    // A directory at the target path makes the final rename fail on every
    // platform — reproducing the failure without platform-specific tricks.
    const root = await mkRoot({ "CLAUDE.md/keep": "x\n" });
    await expect(writeTextFileAtomic(root, "CLAUDE.md", "# hi\n")).rejects.toThrow();
    const names = await readdir(root);
    expect(names.filter((name) => name.includes(".haversack-tmp-"))).toEqual([]);
    // the directory is untouched
    expect(await readFile(path.join(root, "CLAUDE.md", "keep"), "utf8")).toBe("x\n");
  });
});
