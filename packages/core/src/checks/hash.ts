import { stableStringify } from "../drift/manifest.js";
import { sha256Hex } from "../parse/files.js";
import type { LlmCheck, StaticCheck } from "../schema/project.js";

/**
 * sha256 over the canonical check body (F2.2): recorded in every run result so
 * a PR run can be tied to the exact rule text it evaluated. stableStringify
 * sorts keys recursively, so the hash is stable across runs and machines.
 */
export function hashCheckBody(check: StaticCheck | LlmCheck): string {
  return sha256Hex(stableStringify(check));
}
