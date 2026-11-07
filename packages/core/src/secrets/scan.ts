import { ALLOW_SECRET_MARKER, LEGACY_ALLOW_SECRET_MARKER } from "../constants.js";

export interface SecretFinding {
  ruleId: string;
  /** 1-based line number. */
  line: number;
  /** The line with EVERY matched secret replaced by [REDACTED] — no secret value ever leaves this function. */
  snippet: string;
}

interface SecretPattern {
  id: string;
  regex: RegExp;
}

/**
 * Hand-rolled pattern list (no dependency). Ordered specific → generic; the
 * generic assignment rule catches whatever the specific rules miss.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { id: "aws-access-key-id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "github-fine-grained-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { id: "stripe-live-key", regex: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g },
  { id: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "openai-style-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  {
    id: "generic-credential-assignment",
    regex: /\b(api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?([^"'\s]{12,})/gi,
  },
];

/** Compiles the project-level ignore list (schema has already validated these). */
export function compileIgnorePatterns(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern));
}

export interface FileSecretFinding extends SecretFinding {
  file: string;
}

/** Scans a set of files with the project ignore list applied; findings are redacted. */
export function scanFiles(files: ReadonlyArray<{ path: string; content: string }>, ignore: RegExp[]): FileSecretFinding[] {
  const findings: FileSecretFinding[] = [];
  for (const file of files) {
    for (const finding of scanText(file.content, { ignore })) {
      findings.push({ file: file.path, ...finding });
    }
  }
  return findings;
}

/**
 * Scans text line by line. A line is skipped when it contains the
 * `haversack:allow-secret` marker (the legacy `runtime:allow-secret` marker is
 * honored too, ADR 002 §3.6) or matches an ignore pattern (D8).
 *
 * For each line, all pattern matches are collected first and the snippet is
 * redacted against ALL of them — so a line matching multiple rules never
 * leaks one rule's secret through another rule's snippet. One finding is
 * emitted per matched rule.
 */
export function scanText(text: string, options: { ignore?: RegExp[] } = {}): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || line.length === 0) continue;
    if (line.includes(ALLOW_SECRET_MARKER) || line.includes(LEGACY_ALLOW_SECRET_MARKER)) continue;
    if (options.ignore?.some((re) => re.test(line))) continue;

    interface Match {
      ruleId: string;
      value: string;
    }
    const matches: Match[] = [];
    const ruleIds = new Set<string>();

    for (const { id, regex } of SECRET_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        // For grouped patterns (the generic assignment rule) only the value
        // group is the secret; for the rest the whole match is.
        const value = match.length > 1 ? (match[match.length - 1] ?? match[0]) : match[0];
        // Reading a credential from the environment is the sanctioned pattern
        // (BUG-008): `const apiKey = process.env.OPENAI_API_KEY` holds no
        // secret in source — never flag it.
        if (value.startsWith("process.env.")) {
          if (match[0].length === 0) regex.lastIndex++;
          continue;
        }
        if (value.length > 0) {
          matches.push({ ruleId: id, value });
          ruleIds.add(id);
        }
        if (match[0].length === 0) regex.lastIndex++; // zero-width safety
      }
    }
    if (matches.length === 0) continue;

    let snippet = line;
    for (const { value } of matches) {
      snippet = snippet.split(value).join("[REDACTED]");
    }
    for (const ruleId of ruleIds) {
      findings.push({ ruleId, line: index + 1, snippet });
    }
  }
  return findings;
}
