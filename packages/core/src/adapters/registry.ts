import type { TargetAdapter } from "./types.js";
import type { TargetId } from "../schema/project.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { cursorAdapter } from "./cursor.js";
import { copilotAdapter } from "./copilot.js";

/**
 * The only wiring point for a new target: add an adapter file under
 * adapters/, import it here, and add one line to this record (PRD F1.5).
 * Cursor and Copilot formats are verified against official docs
 * (docs/agents-md-findings.md) before registration.
 */
const ADAPTERS: Partial<Record<TargetId, TargetAdapter>> = {
  "claude-code": claudeCodeAdapter,
  cursor: cursorAdapter,
  copilot: copilotAdapter,
};

export function tryGetAdapter(id: TargetId): TargetAdapter | undefined {
  return ADAPTERS[id];
}

export function getAdapter(id: TargetId): TargetAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) {
    throw new Error(
      `no adapter registered for target '${id}' (registered: ${registeredAdapterIds().join(", ") || "none"})`,
    );
  }
  return adapter;
}

export function registeredAdapterIds(): TargetId[] {
  return Object.entries(ADAPTERS)
    .filter((entry): entry is [TargetId, TargetAdapter] => entry[1] !== undefined)
    .map(([id]) => id);
}
