// Pre-push secret audit: scans the working tree and full git history with the
// SAME scanner `runtime sync` uses (@runtime/core), so the rules are identical.
// Findings are always redacted. Exit code 1 when anything is found — gate or
// review manually. Usage: node scripts/scan-secrets.mjs   (build core first)
import { readdir, readFile, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanText } from "../packages/core/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", "build"]);
const MAX_BYTES = 1_000_000;

let findings = 0;

function report(where, finding) {
  findings++;
  console.log(`${where}:${finding.line} — ${finding.ruleId}`);
  console.log(`    ${finding.snippet}`);
}

async function scanTree() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rel = path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name));
    const segments = rel.split(path.sep);
    if (segments.some((s) => SKIP_DIRS.has(s))) continue;
    const abs = path.join(root, rel);
    try {
      if ((await stat(abs)).size > MAX_BYTES) continue;
      const text = await readFile(abs, "utf8");
      for (const finding of scanText(text)) {
        report(`tree/${rel.split(path.sep).join("/")}`, finding);
      }
    } catch {
      // unreadable (binary/locked) — skip
    }
  }
}

function scanHistory() {
  const patch = execSync("git log -p --no-color --no-ext-diff", {
    cwd: root,
    maxBuffer: 512 * 1024 * 1024,
  }).toString();
  for (const finding of scanText(patch)) {
    report("history(patch line)", finding);
  }
}

await scanTree();
scanHistory();
console.log(`\n${findings} finding(s). Every value above is already redacted.`);
process.exitCode = findings > 0 ? 1 : 0;
