import { describe, expect, it } from "vitest";
import { getAdapter, registeredAdapterIds, tryGetAdapter } from "../src/adapters/registry.js";

describe("adapter registry", () => {
  it("registers claude-code", () => {
    expect(registeredAdapterIds()).toEqual(["claude-code"]);
    expect(tryGetAdapter("claude-code")?.id).toBe("claude-code");
    expect(getAdapter("claude-code").version).toBe(1);
  });

  it("throws a clear error for an unregistered target", () => {
    expect(() => getAdapter("cursor")).toThrow(/no adapter registered for target 'cursor'/);
  });
});
