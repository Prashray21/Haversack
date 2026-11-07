import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Renders each transcript in docs/assets/transcripts/*.txt into an SVG
 * terminal image in docs/assets/terminal/ — fixed dark background, monospace
 * text, a title bar. No dependencies; regenerate with:
 *
 *   node scripts/render-terminal.mjs
 *
 * Transcripts are captured real CLI output (see docs/TESTING.md); never edit
 * the .txt files by hand — re-capture and re-render instead.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const inDir = path.join(here, "..", "docs", "assets", "transcripts");
const outDir = path.join(here, "..", "docs", "assets", "terminal");

const CHAR_W = 7.2;
const LINE_H = 20;
const FONT = 14;
const PADDING_X = 16;
const TITLE_H = 30;
const BG = "#1e1e2e";
const TITLE_BG = "#11111b";
const FG = "#cdd6f4";
const TITLE_FG = "#a6adc8";

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const TITLES = {
  "init": "haversack init",
  "sync": "haversack sync",
  "drift": "haversack sync --verify  (after a hand edit)",
  "check-fail": "haversack check  (block rule violated)",
  "check-clean": "haversack check  (fixed)",
  "secret": "haversack sync  (secret gate)",
};

async function render(file) {
  const name = path.basename(file, ".txt");
  const text = await readFile(file, "utf8");
  const lines = text.replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  const widest = Math.max(...lines.map((l) => l.length), 40);
  const width = Math.ceil(widest * CHAR_W + PADDING_X * 2);
  const height = TITLE_H + lines.length * LINE_H + 8;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="terminal transcript: ${escapeXml(TITLES[name] ?? name)}">`,
    `<rect width="${width}" height="${height}" fill="${BG}" rx="8"/>`,
    `<rect width="${width}" height="${TITLE_H}" fill="${TITLE_BG}" rx="8"/>`,
    `<rect y="${TITLE_H - 8}" width="${width}" height="8" fill="${TITLE_BG}"/>`,
    `<circle cx="18" cy="${TITLE_H / 2}" r="5" fill="#f38ba8"/>`,
    `<circle cx="34" cy="${TITLE_H / 2}" r="5" fill="#f9e2af"/>`,
    `<circle cx="50" cy="${TITLE_H / 2}" r="5" fill="#a6e3a1"/>`,
    `<text x="66" y="${TITLE_H / 2 + 4}" font-family="ui-monospace, 'Cascadia Mono', Consolas, monospace" font-size="12" fill="${TITLE_FG}">${escapeXml(TITLES[name] ?? name)}</text>`,
  ];

  lines.forEach((line, index) => {
    const y = TITLE_H + FONT + index * LINE_H;
    parts.push(
      `<text x="${PADDING_X}" y="${y}" font-family="ui-monospace, 'Cascadia Mono', Consolas, monospace" font-size="${FONT}" fill="${FG}" xml:space="preserve">${escapeXml(line)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

await mkdir(outDir, { recursive: true });
const files = (await readdir(inDir)).filter((f) => f.endsWith(".txt")).sort();
for (const file of files) {
  const text = await readFile(path.join(inDir, file), "utf8");
  const lineCount = text.replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")).length;
  const svg = await render(path.join(inDir, file));
  const out = path.join(outDir, path.basename(file, ".txt") + ".svg");
  await writeFile(out, svg + "\n", "utf8");
  console.log(`rendered ${path.basename(file)} → ${path.relative(path.join(here, ".."), out)} (${lineCount} lines)`);
}
