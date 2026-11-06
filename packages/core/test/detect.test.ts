import { describe, expect, it } from "vitest";
import { GENERATED_HEADER_MARKER } from "../src/constants.js";
import { assessGeneratedFile, findOrphans } from "../src/drift/detect.js";
import { hashContent } from "../src/drift/manifest.js";

const ENTRY = (content: string) => ({
  adapter: "claude-code",
  adapterVersion: 1,
  sha256: hashContent(content),
});

describe("assessGeneratedFile", () => {
  const generated = "v2 content\n";
  const lastSynced = "v1 content\n";

  it("new: not on disk", () => {
    expect(assessGeneratedFile({ generated, onDisk: undefined, manifestEntry: undefined })).toBe("new");
    expect(assessGeneratedFile({ generated, onDisk: undefined, manifestEntry: ENTRY(lastSynced) })).toBe("new");
  });

  it("unchanged: disk equals generated", () => {
    expect(assessGeneratedFile({ generated, onDisk: generated, manifestEntry: ENTRY(generated) })).toBe("unchanged");
    expect(assessGeneratedFile({ generated, onDisk: generated, manifestEntry: undefined })).toBe("unchanged");
  });

  it("stale: disk matches the last sync but the definition moved on", () => {
    expect(
      assessGeneratedFile({ generated, onDisk: lastSynced, manifestEntry: ENTRY(lastSynced) }),
    ).toBe("stale");
  });

  it("stale: our header without a manifest entry (manifest lost)", () => {
    const ours = `<!-- ${GENERATED_HEADER_MARKER} ...\nold content\n`;
    expect(assessGeneratedFile({ generated, onDisk: ours, manifestEntry: undefined })).toBe("stale");
  });

  it("stale: our header after frontmatter without a manifest entry (mdc-style, manifest lost)", () => {
    const ours = `---\ntitle: x\n---\n<!-- ${GENERATED_HEADER_MARKER} ...\nold content\n`;
    expect(assessGeneratedFile({ generated, onDisk: ours, manifestEntry: undefined })).toBe("stale");
  });

  it("untracked: a foreign file that only MENTIONS the header text is never treated as ours", () => {
    // Header spoofing (M3): quoting the marker mid-file must not make sync
    // believe it produced this file — untracked, so sync never overwrites it
    // without --force.
    const foreign = `# my own notes\n\nlike a "${GENERATED_HEADER_MARKER}" file\n`;
    expect(assessGeneratedFile({ generated, onDisk: foreign, manifestEntry: undefined })).toBe("untracked");
  });

  it("untracked: header text at the start without a comment opener is not ours (prose, not header)", () => {
    const foreign = `${GENERATED_HEADER_MARKER} was here\n`;
    expect(assessGeneratedFile({ generated, onDisk: foreign, manifestEntry: undefined })).toBe("untracked");
  });

  it("hand-edited: disk differs from the last sync", () => {
    expect(
      assessGeneratedFile({ generated, onDisk: "v1 content edited\n", manifestEntry: ENTRY(lastSynced) }),
    ).toBe("hand-edited");
  });

  it("untracked: not ours and no manifest entry", () => {
    expect(assessGeneratedFile({ generated, onDisk: "# my own notes\n", manifestEntry: undefined })).toBe(
      "untracked",
    );
  });

  it("comparison happens on normalized content (CRLF disk files)", () => {
    expect(
      assessGeneratedFile({
        generated: "a\nb\n",
        onDisk: "a\r\nb\r\n",
        manifestEntry: { adapter: "claude-code", adapterVersion: 1, sha256: hashContent("a\nb\n") },
      }),
    ).toBe("unchanged");
  });
});

describe("findOrphans", () => {
  it("lists manifest paths that are no longer generated, sorted", () => {
    const manifestFiles = {
      "CLAUDE.md": ENTRY("x\n"),
      "OLD.md": ENTRY("y\n"),
      "another-old.md": ENTRY("z\n"),
    };
    expect(findOrphans(manifestFiles, new Set(["CLAUDE.md"]))).toEqual(["OLD.md", "another-old.md"]);
    expect(findOrphans(manifestFiles, new Set(["CLAUDE.md", "OLD.md", "another-old.md"]))).toEqual([]);
  });
});
