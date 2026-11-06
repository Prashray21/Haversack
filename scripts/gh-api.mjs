// Minimal GitHub API caller that borrows the local Git Credential Manager
// token. The token is fetched at call time, piped straight into the request
// header, and NEVER printed, logged, or written anywhere.
//
// Usage: node scripts/gh-api.mjs <METHOD> <api-path> [json-body]
//   node scripts/gh-api.mjs GET "repos/OWNER/REPO/actions/runs?per_page=5"
// NOTE: pass the path WITHOUT a leading slash — Git Bash (MSYS) rewrites
// leading-slash arguments into Windows paths, which corrupts the URL.
import { execFileSync } from "node:child_process";

const [, , method = "GET", rawPath = "", bodyArg] = process.argv;
const apiPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

const cred = execFileSync(
  "git",
  ["credential", "fill"],
  { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", windowsHide: true },
);
const token = /^password=(.*)$/m.exec(cred)?.[1]; // runtime:allow-secret — extracts the stored credential, never embeds one
if (!token) {
  console.error("no stored GitHub credential found (git credential fill)");
  process.exit(1);
}

const response = await fetch(`https://api.github.com${apiPath}`, {
  method,
  headers: {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "project-runtime-maintenance",
    "x-github-api-version": "2022-11-28",
  },
  body: bodyArg ? JSON.stringify(JSON.parse(bodyArg)) : undefined,
});

console.log(`HTTP ${response.status}`);
const text = await response.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
