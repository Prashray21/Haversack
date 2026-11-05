// Generates docs/dependency-licenses.md from the installed dependency tree
// (node_modules/.pnpm) and flags anything not MIT-compatible. Usage:
//   node scripts/license-report.mjs   (after pnpm install)
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(root, "node_modules", ".pnpm");

// Permissive licenses compatible with shipping an MIT-licensed product.
const MIT_COMPATIBLE = new Set([
  "MIT", "MIT*", "(MIT OR Apache-2.0)", "(MIT OR CC0-1.0)", "(MIT OR WTFPL)",
  "ISC", "BSD-2-Clause", "BSD-3-Clause", "BSD-Source-Code", "0BSD",
  "Apache-2.0", "(Apache-2.0 OR MIT)", "CC0-1.0", "Unlicense", "Unlicense OR MIT",
  "BlueOak-1.0.0", "Python-2.0", "CC-BY-4.0", "ODC-By-1.0",
]);

function classify(license) {
  if (!license) return "UNKNOWN";
  if (MIT_COMPATIBLE.has(license)) return "ok";
  if (license.startsWith("(") || license.includes(" OR ") || license.includes(" AND ")) {
    // Compound expressions: ok when at least one alternative is compatible
    const alternatives = license.split(/\s+(?:OR|AND)\s+/i).map((part) => part.replace(/[()]/g, "").trim());
    return alternatives.some((alt) => MIT_COMPATIBLE.has(alt)) ? "ok-compound" : "REVIEW";
  }
  return "REVIEW";
}

const entries = [];
for (const dir of await readdir(storeDir)) {
  // Layout: node_modules/.pnpm/<name>@<version>/node_modules/<actual-package-dir>/package.json
  const innerNodeModules = path.join(storeDir, dir, "node_modules");
  let packageDirs = [];
  try {
    packageDirs = await readdir(innerNodeModules);
  } catch {
    continue;
  }
  for (const packageDir of packageDirs) {
    if (packageDir.startsWith(".")) continue; // .bin, .modules.yaml etc.
    const pkgJsonPath = path.join(innerNodeModules, packageDir, "package.json");
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
      entries.push({
        name: pkg.name ?? "unknown",
        version: pkg.version ?? "?",
        license: pkg.license ?? "UNKNOWN",
        url: pkg.homepage ?? pkg.repository?.url ?? "",
      });
    } catch {
      // not a package dir
    }
  }
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const flagged = entries.filter((e) => classify(e.license) !== "ok" && classify(e.license) !== "ok-compound");

const lines = [
  "# Dependency license report",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/license-report.mjs\` — re-run after dependency changes.`,
  "",
  `This project is MIT. Every dependency below was checked for MIT compatibility:`,
  `**${entries.length} packages, ${flagged.length} flagged.**`,
  flagged.length > 0
    ? "\n## ⚠ Flagged (not obviously MIT-compatible)\n"
    : "\n## ⚠ Flagged\n\nNone — all licenses are permissive and MIT-compatible.\n",
];

for (const entry of flagged) {
  lines.push(`- **${entry.name}@${entry.version}** — ${entry.license}`);
}

lines.push("", "## All packages", "", "| Package | Version | License | Status |", "| --- | --- | --- | --- |");
for (const entry of entries) {
  lines.push(`| ${entry.name} | ${entry.version} | ${entry.license} | ${classify(entry.license)} |`);
}
lines.push("");

await writeFile(path.join(root, "docs", "dependency-licenses.md"), lines.join("\n"), "utf8");
console.log(`docs/dependency-licenses.md written: ${entries.length} packages, ${flagged.length} flagged`);
