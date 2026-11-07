import { describe, expect, it } from "vitest";
import { projectConfigSchema } from "../src/schema/project.js";

const validConfig = {
  runtime: 1,
  project: "acme-storefront",
  context: ["context/product.md"],
  rules: ["rules/coding.md"],
  targets: ["claude-code"],
  checks: [
    {
      id: "no-console-log-in-prod",
      type: "static",
      pattern: "console\\.log\\(",
      message: "no console.log",
    },
    {
      id: "rls-required",
      type: "llm",
      paths: ["db/**"],
      prompt: "every new table must enable row-level security",
    },
  ],
};

describe("projectConfigSchema", () => {
  it("accepts a valid config and applies defaults", () => {
    const parsed = projectConfigSchema.parse(validConfig);

    expect(parsed.runtime).toBe(1);
    expect(parsed.context).toEqual(["context/product.md"]);
    expect(parsed.rules).toEqual(["rules/coding.md"]);
    expect(parsed.integrations).toEqual({});
    expect(parsed.model_policy).toEqual({ pin: true });
    expect(parsed.secrets).toEqual({ ignore: [] });

    const staticCheck = parsed.checks[0];
    if (staticCheck?.type !== "static") throw new Error("expected a static check");
    expect(staticCheck.severity).toBe("warn"); // D3
    expect(staticCheck.path).toBe("**");
    expect(staticCheck.exclude).toEqual([]);
    expect(staticCheck.flags).toEqual([]);

    const llmCheck = parsed.checks[1];
    if (llmCheck?.type !== "llm") throw new Error("expected an llm check");
    expect(llmCheck.severity).toBe("warn");
    expect(llmCheck.paths).toEqual(["db/**"]);
  });

  it("rejects a non-kebab project name", () => {
    const result = projectConfigSchema.safeParse({ ...validConfig, project: "Acme Store" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("kebab-case");
    }
  });

  it("rejects unsafe repo paths", () => {
    for (const bad of ["../outside.md", "/abs.md", "C:\\x.md", "a//b.md", "./x.md"]) {
      const result = projectConfigSchema.safeParse({ ...validConfig, context: [bad] });
      expect(result.success, `expected '${bad}' to be rejected`).toBe(false);
    }
  });

  it("rejects unknown top-level fields (strictObject)", () => {
    const result = projectConfigSchema.safeParse({ ...validConfig, workspaces: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects a regex pattern that does not compile", () => {
    const config = {
      ...validConfig,
      checks: [
        {
          id: "bad-regex",
          type: "static",
          pattern: "console.log(",
          message: "m",
        },
      ],
    };
    const result = projectConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("valid JavaScript regular expression");
    }
  });

  it("rejects an unknown check type (discriminated union)", () => {
    const config = {
      ...validConfig,
      checks: [{ id: "weird-rule", type: "regex", pattern: "x", message: "m" }],
    };
    const result = projectConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("rejects non-kebab check ids", () => {
    const config = {
      ...validConfig,
      checks: [{ id: "Bad_ID", type: "static", pattern: "x", message: "m" }],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects unsupported regex flags", () => {
    const config = {
      ...validConfig,
      checks: [{ id: "flagged", type: "static", pattern: "x", flags: ["g"], message: "m" }],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects an llm check without paths or prompt", () => {
    const config = {
      ...validConfig,
      checks: [{ id: "no-body", type: "llm" }],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects an unknown runtime spec version at the schema level", () => {
    const result = projectConfigSchema.safeParse({ ...validConfig, runtime: 2 });
    expect(result.success).toBe(false);
  });
});

describe("spec key (ADR 002 rename)", () => {
  const base = {
    project: "acme-storefront",
    targets: ["claude-code"],
    checks: [],
  };

  it("accepts `haversack: 1`", () => {
    const parsed = projectConfigSchema.parse({ ...base, haversack: 1 });
    expect(parsed.haversack).toBe(1);
    expect(parsed.runtime).toBeUndefined();
  });

  it("accepts the legacy `runtime: 1` key", () => {
    const parsed = projectConfigSchema.parse({ ...base, runtime: 1 });
    expect(parsed.runtime).toBe(1);
    expect(parsed.haversack).toBeUndefined();
  });

  it("rejects both spec keys at once (ambiguity)", () => {
    expect(() => projectConfigSchema.parse({ ...base, haversack: 1, runtime: 1 })).toThrowError(/exactly one/);
  });

  it("rejects a missing spec key", () => {
    expect(() => projectConfigSchema.parse({ ...base })).toThrowError(/exactly one/);
  });

  it("rejects `haversack: 2` (unsupported spec version)", () => {
    expect(() => projectConfigSchema.parse({ ...base, haversack: 2 })).toThrowError();
  });
});
