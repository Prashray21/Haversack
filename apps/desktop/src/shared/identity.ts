/**
 * THE app identity constant (ADR 001 §11, owner decision #5): everything that
 * names the app derives from here and nothing else hard-codes a name.
 * Owner confirmed "Haversack" 2026-11-08 (P3 pause gate; working name per PRD v0.3).
 */
export const APP_IDENTITY = {
  appId: "io.github.prashray21.haversack",
  productName: "Haversack",
  exeName: "Haversack.exe",
  userDataDirName: "Haversack",
} as const;
