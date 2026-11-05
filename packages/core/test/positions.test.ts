import { describe, expect, it } from "vitest";
import { findNodePos, formatSchemaPath, parseYamlWithPositions } from "../src/parse/positions.js";

const FIXTURE = `runtime: 1
project: demo
targets: [claude-code]
checks:
  - id: first-rule
    type: static
    pattern: abc
    message: m
  - id: second-rule
    type: static
    pattern: xyz
    message: m
`;

describe("positions", () => {
  it("maps a schema path to the value's line", () => {
    const positioned = parseYamlWithPositions(FIXTURE);

    const firstId = findNodePos(positioned, ["checks", 0, "id"]);
    expect(firstId?.line).toBe(5);

    const secondPattern = findNodePos(positioned, ["checks", 1, "pattern"]);
    expect(secondPattern?.line).toBe(11);
  });

  it("reports the same column for parallel fields", () => {
    const positioned = parseYamlWithPositions(FIXTURE);
    const first = findNodePos(positioned, ["checks", 0, "pattern"]);
    const second = findNodePos(positioned, ["checks", 1, "pattern"]);
    expect(first?.col).toBe(second?.col);
  });

  it("maps top-level scalar values", () => {
    const positioned = parseYamlWithPositions(FIXTURE);
    const runtime = findNodePos(positioned, ["runtime"]);
    expect(runtime?.line).toBe(1);
    expect(runtime?.col).toBeGreaterThan("runtime:".length);
  });

  it("returns a position (best effort) for a missing key's parent", () => {
    const positioned = parseYamlWithPositions(FIXTURE);
    // "nope" does not exist; the walk stops at the document root's mapping.
    const pos = findNodePos(positioned, ["nope", "deeper"]);
    expect(pos).toBeDefined();
  });

  it("formats schema paths for error output", () => {
    expect(formatSchemaPath([])).toBe("");
    expect(formatSchemaPath(["runtime"])).toBe("runtime");
    expect(formatSchemaPath(["checks", 1, "pattern"])).toBe("checks[1].pattern");
    expect(formatSchemaPath(["model_policy", "budget", "usd_per_run"])).toBe(
      "model_policy.budget.usd_per_run",
    );
  });
});
