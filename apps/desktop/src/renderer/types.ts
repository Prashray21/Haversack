/** Local types mirroring the shapes that cross the engine boundary. The
 *  renderer treats items/steps/records as opaque except for display fields —
 *  all validation happens in main/core. */

export interface EnvInfo {
  home: string;
  userData: string;
  appVersion: string;
  productName: string;
}

export interface InventorySkillEntry {
  kind: "skill";
  name: string;
  scope: "user" | "project";
  dir: string;
  ours: boolean;
  itemHash?: string;
  symlink?: boolean;
}

export interface InventoryMcpEntry {
  kind: "mcp";
  name: string;
  scope: "user" | "project";
  configPath: string;
  entry: { type?: string; command?: string; args?: string[]; url?: string };
  ours: boolean;
  itemHash?: string;
}

export interface Inventory {
  skills: InventorySkillEntry[];
  mcp: InventoryMcpEntry[];
  configErrors: string[];
}

export interface IngestFlag {
  code: string;
  path: string;
  detail: string;
}

export interface IngestResult {
  item: { kind: "skill"; name: string; description?: string; contentHash: string; files: Array<{ path: string }> };
  flags: IngestFlag[];
}

export interface SkillPlanWrite {
  relPath: string;
  absPath: string;
  before: "absent" | { sha256: string };
  afterSha256: string;
}

export interface SkillPlanStep {
  kind: "skill";
  action: "add" | "update";
  scope: "user" | "project";
  name: string;
  itemHash: string;
  targetRoot: string;
  writes: SkillPlanWrite[];
}

export interface McpPlanStep {
  kind: "mcp";
  action: "add" | "update";
  scope: "user" | "project";
  name: string;
  itemHash: string;
  entryJson: string;
  configPath: string;
  cliArgv: string[];
  prevState: "absent" | { entryJson: string };
  secretsInline: boolean;
}

export type PlanStep = SkillPlanStep | McpPlanStep;

export interface McpTestResult {
  approved: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
