import { describe, expect, it } from "vitest";
import { getAdapter, registeredAdapterIds, tryGetAdapter } from "../src/adapters/registry.js";

describe("adapter registry", () => {
  // NOTE: updated in the next step when the claude-code adapter registers.
  it("starts with no adapters registered", () => {
    expect(registeredAdapterIds()).toEqual([]);
    expect(tryGetAdapter("claude-code")).toBeUndefined();
  });

  it("throws a clear error for an unregistered target", () => {
    expect(() => getAdapter("claude-code")).toThrow(/no adapter registered for target 'claude-code'/);
  });
});
