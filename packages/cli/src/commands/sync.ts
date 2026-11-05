import { LoadError, loadProject } from "@runtime/core";

export interface SyncOptions {
  cwd: string;
  yes: boolean;
  verify: boolean;
  target?: string;
  force: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * Step-2 scope: load and validate the definition, surface warnings, and exit
 * with the contract codes (D6). The writer — diff preview, drift detection,
 * manifest update — lands in the next step.
 */
export async function runSync(options: SyncOptions): Promise<number> {
  try {
    const result = await loadProject({ cwd: options.cwd });
    const { config, warnings } = result;

    const staticCount = config.checks.filter((c) => c.type === "static").length;
    const llmCount = config.checks.length - staticCount;

    options.stdout(`project: ${config.project} (runtime spec ${config.runtime})`);
    options.stdout(`targets: ${config.targets.join(", ")}`);
    options.stdout(
      `context: ${config.context.length} file(s) · rules: ${config.rules.length} file(s) · checks: ${config.checks.length} (${staticCount} static, ${llmCount} llm)`,
    );
    for (const warning of warnings) {
      options.stdout(`⚠ ${warning.message}`);
    }
    options.stdout("sync writer is not implemented yet — it lands in the next step");
    return 0;
  } catch (error) {
    if (error instanceof LoadError) {
      options.stderr(error.report);
      return 2; // configuration error (D6)
    }
    throw error;
  }
}
