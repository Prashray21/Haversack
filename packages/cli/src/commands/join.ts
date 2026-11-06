import { LoadError, loadProject, tryGetAdapter } from "@runtime/core";
import { runSync } from "./sync.js";

export interface JoinOptions {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * `runtime join` (F5.2): sets up a new teammate's machine from the committed
 * definition — syncs targets, verifies the result, and reports exactly what
 * is missing or unimplemented. Exit codes mirror sync (D6): 0 ok, 1 drift
 * remained, 2 config error, 3 secret.
 *
 * F5.3: the total wall-clock time is printed so the "under 10 minutes"
 * target is measurable on every run.
 */
export async function runJoin(options: JoinOptions): Promise<number> {
  const { stdout, stderr } = options;
  const startedAt = (options.now ?? Date.now)();
  const elapsedMs = () => Math.max(1, (options.now ?? Date.now)() - startedAt);

  // 1) Load the definition first for a clear, early failure and for the report.
  let project: Awaited<ReturnType<typeof loadProject>>;
  try {
    project = await loadProject({ cwd: options.cwd });
  } catch (error) {
    if (error instanceof LoadError) {
      stderr(error.report);
      stderr("  runtime join needs a committed project.yaml — ask the team lead, or run `runtime init` on a repo without one.");
      return 2;
    }
    throw error;
  }
  const { config } = project;

  stdout(`join: setting up '${config.project}' (runtime spec ${config.runtime})`);

  // 2) Sync targets — writes generated files for registered adapters.
  const syncCode = await runSync({ cwd: options.cwd, yes: true, verify: false, force: false, stdout, stderr });
  if (syncCode !== 0) {
    stderr(`✘ join stopped: sync did not complete cleanly (exit ${syncCode}) — resolve the output above, then re-run join.`);
    return syncCode;
  }

  // 3) Verify: a second, read-only pass must report everything in sync.
  const verifyIo = { stdout, stderr };
  const verifyCode = await runSync({ cwd: options.cwd, yes: true, verify: true, force: false, ...verifyIo });
  const verified = verifyCode === 0;

  // 4) Report what is missing or deliberately inert (F5.2).
  stdout("");
  stdout("setup report:");
  const registered = config.targets.filter((target) => tryGetAdapter(target) !== undefined);
  const missingAdapters = config.targets.filter((target) => tryGetAdapter(target) === undefined);
  stdout(`  ✓ definition loaded: ${config.context.length} context file(s), ${config.rules.length} rules file(s)`);
  if (registered.length > 0) {
    stdout(`  ✓ targets synced: ${registered.join(", ")}`);
  }
  for (const target of missingAdapters) {
    stdout(`  – target '${target}': no adapter implemented yet — nothing to sync for it (D9 lists it for the MVP)`);
  }
  if (Object.keys(config.integrations).length > 0) {
    stdout("  – integrations: validated but inert in the MVP — the gateway ships in Phase 2 (D7); no credentials were requested");
  }
  stdout(verified ? "  ✓ verified: all generated files are in sync" : `  ✘ verification failed (exit ${verifyCode}) — see drift above`);

  stdout("");
  stdout(`done in ${(elapsedMs() / 1000).toFixed(1)}s (F5.3 target: under 10 minutes)`);
  return verified ? 0 : 1;
}
