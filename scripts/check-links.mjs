import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks every markdown file under docs/ and the root README for relative
 * links and image references: the target file must exist in the repo. Runs
 * with no dependencies:
 *
 *   node scripts/check-links.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// GitHub-UI relative paths (../../releases, ../../blob/...) resolve on github.com, not in the repo.
const GITHUB_UI = /^\.\.\/\.\.\/(releases|blob|tree|wiki|actions|security)/;
let failures = 0;
let checked = 0;

for (const file of await markdownFiles(root)) {
  const rel = path.relative(root, file);
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(LINK_RE)) {
    const target = match[1];
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (GITHUB_UI.test(target)) continue;
    checked++;
    const [bare] = target.split("#");
    if (bare === "") continue; // pure anchor within the page — GitHub resolves these
    const abs = path.resolve(path.dirname(file), decodeURIComponent(bare));
    if (!(await exists(abs))) {
      failures++;
      console.error(`BROKEN  ${rel} → ${target}`);
    }
  }
}

console.log(`checked ${checked} relative link(s) across all markdown files`);
if (failures > 0) {
  console.error(`${failures} broken link(s)`);
  process.exitCode = 1;
} else {
  console.log("all relative links resolve");
}
