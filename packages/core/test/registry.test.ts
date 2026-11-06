import { describe, expect, it } from "vitest";
import { getAdapter, registeredAdapterIds, tryGetAdapter } from "../src/adapters/registry.js";

describe("adapter registry", () => {
  it("registers all three MVP targets (F1.1, D9)", () => {
    expect(registeredAdapterIds()).toEqual(["claude-code", "cursor", "copilot"]);
    expect(tryGetAdapter("claude-code")?.id).toBe("claude-code");
    expect(tryGetAdapter("cursor")?.id).toBe("cursor");
    expect(tryGetAdapter("copilot")?.id).toBe("copilot");
    expect(getAdapter("cursor").version).toBe(1);
    expect(getAdapter("copilot").version).toBe(1);
  });

  it("throws a clear error for an unregistered target", () => {
    expect(() => getAdapter("nope" as never)).toThrow(/no adapter registered for target 'nope'/);
  });
});
