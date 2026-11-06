import { describe, expect, it } from "vitest";
import { compileIgnorePatterns, scanText } from "../src/secrets/scan.js";

const GITHUB_TOKEN = `ghp_${"A".repeat(36)}`;

describe("scanText", () => {
  it("detects known token formats", () => {
    const text = [
      "aws = AKIAIOSFODNN7EXAMPLE", // runtime:allow-secret — AWS documented example key
      `gh = ${GITHUB_TOKEN}`,
      "stripe = sk_live_" + "a".repeat(20),
      "slack = xoxb-1234567890abcdef", // runtime:allow-secret — scanner fixture
      "-----BEGIN RSA PRIVATE KEY-----", // runtime:allow-secret — scanner fixture
      `openai = sk-${"x".repeat(24)}`,
    ].join("\n");

    const rules = scanText(text).map((f) => f.ruleId);
    expect(rules).toContain("aws-access-key-id");
    expect(rules).toContain("github-token");
    expect(rules).toContain("stripe-live-key");
    expect(rules).toContain("slack-token");
    expect(rules).toContain("private-key");
    expect(rules).toContain("openai-style-key");
  });

  it("detects generic credential assignments", () => {
    const findings = scanText("password = hunter2hunter2\n"); // runtime:allow-secret — scanner fixture
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("generic-credential-assignment");
    expect(findings[0]?.line).toBe(1);
  });

  it("does not flag environment reads — the sanctioned credential pattern (BUG-008)", () => {
    // Reading credentials from the environment is exactly what the rules
    // mandate; the generic rule must not block it.
    const lines = [
      "const apiKey = process.env.OPENAI_API_KEY;",
      "const token = process.env.GH_TOKEN ?? '';",
      "if (!apiKey) throw new Error('no key');",
    ];
    expect(scanText(lines.join("\n"))).toEqual([]);
    // but a literal assignment right next to it is still caught (two rules
    // legitimately match one line — see the two-rules test above)
    expect(scanText("const apiKey = 'sk-abcdefghijklmnopqrst';")).toHaveLength(2); // runtime:allow-secret — scanner fixture
  });

  it("never includes the secret value in any snippet, even with two rules on one line", () => {
    // `token: ghp_…` matches both github-token and the generic assignment rule.
    const findings = scanText(`token: ${GITHUB_TOKEN}\n`); // runtime:allow-secret — scanner fixture
    expect(findings.length).toBe(2);
    for (const finding of findings) {
      expect(finding.snippet).toContain("[REDACTED]");
      expect(finding.snippet).not.toContain(GITHUB_TOKEN);
    }
    // the key word stays visible for context
    expect(findings[0]?.snippet).toContain("token:");
    expect(new Set(findings.map((f) => f.ruleId))).toEqual(
      new Set(["github-token", "generic-credential-assignment"]),
    );
  });

  it("skips lines carrying the runtime:allow-secret marker", () => {
    const text = `token: ${GITHUB_TOKEN} # runtime:allow-secret\n`;
    expect(scanText(text)).toEqual([]);
  });

  it("skips lines matched by the project ignore list", () => {
    const ignore = compileIgnorePatterns(["EXAMPLE_KEY"]);
    const findings = scanText("EXAMPLE_KEY = abcdefghijklmnop\n", { ignore });
    expect(findings).toEqual([]);
  });

  it("redacts the value but keeps the key for generic assignments", () => {
    const findings = scanText("password = hunter2hunter2\n"); // runtime:allow-secret — scanner fixture
    expect(findings[0]?.snippet).toContain("password = [REDACTED]");
    expect(findings[0]?.snippet).not.toContain("hunter2hunter2");
  });

  it("reports correct line numbers", () => {
    const text = "# heading\n\ntoken: " + "B".repeat(40) + "\n";
    const findings = scanText(text);
    expect(findings[0]?.line).toBe(3);
  });

  it("leaves benign text alone", () => {
    const benign = [
      "# Security rules",
      "- Secrets come from environment variables.",
      "- The Supabase service-role key must never appear in client code.",
      "supabase_url = https://example.supabase.co",
      "",
    ].join("\n");
    expect(scanText(benign)).toEqual([]);
  });
});
