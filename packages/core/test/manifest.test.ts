import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashContent,
  manifestAbsPath,
  readManifest,
  stableStringify,
  writeManifest,
  type Manifest,
} from "../src/drift/manifest.js";

describe("stableStringify", () => {
  it("sorts object keys at every level, regardless of insertion order", () => {
    const a = stableStringify({ b: 2, a: { d: 4, c: 3 } });
    const b = stableStringify({ a: { c: 3, d: 4 }, b: 2 });
    expect(a).toBe(b);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
    expect(a.indexOf('"c"')).toBeLessThan(a.indexOf('"d"'));
  });

  it("uses 2-space indentation and a trailing newline", () => {
    const out = stableStringify({ files: {} });
    expect(out).toBe('{\n  "files": {}\n}\n');
  });

  it("preserves array order", () => {
    expect(stableStringify({ items: ["b", "a"] })).toBe('{\n  "items": [\n    "b",\n    "a"\n  ]\n}\n');
  });
});

describe("manifest read/write", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const sample: Manifest = {
    runtime: 1,
    generator: "runtime@0.1.0",
    files: {
      "CLAUDE.md": { adapter: "claude-code", adapterVersion: 1, sha256: "abc" },
    },
  };

  it("round-trips through disk and is byte-stable", async () => {
    dir = path.join(tmpdir(), `runtime-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await writeManifest(dir, sample);
    const { manifest, corrupt } = await readManifest(dir);
    expect(corrupt).toBe(false);
    expect(manifest).toEqual(sample);

    // writing the same manifest again yields identical content
    await writeManifest(dir, sample);
    const again = await readManifest(dir);
    expect(again.manifest).toEqual(sample);
  });

  it("reports a missing manifest as undefined (not corrupt)", async () => {
    dir = path.join(tmpdir(), `runtime-manifest-missing-${Date.now()}`);
    const { manifest, corrupt } = await readManifest(dir);
    expect(manifest).toBeUndefined();
    expect(corrupt).toBe(false);
  });

  it("flags a corrupt manifest", async () => {
    dir = path.join(tmpdir(), `runtime-manifest-bad-${Date.now()}`);
    await writeManifest(dir, sample);
    const fs = await import("node:fs/promises");
    await fs.writeFile(manifestAbsPath(dir), "{ not json", "utf8");
    const { manifest, corrupt } = await readManifest(dir);
    expect(manifest).toBeUndefined();
    expect(corrupt).toBe(true);
  });
});

describe("hashContent", () => {
  it("normalizes CRLF and BOM before hashing", () => {
    expect(hashContent("\uFEFFa\r\nb\r\n")).toBe(hashContent("a\nb\n"));
  });
});
