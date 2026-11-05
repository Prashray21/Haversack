#!/usr/bin/env node
import { Command } from "commander";
import { runSync } from "./commands/sync.js";
import { CLI_VERSION } from "./version.js";

const program = new Command();

program
  .name("runtime")
  .description("Project Runtime — write your project's AI setup once. Sync it to every tool. Enforce it.")
  .version(CLI_VERSION);

program
  .command("sync")
  .description("compile project.yaml into each target's native config (diff preview, drift detection)")
  .option("-y, --yes", "write without prompting")
  .option("--verify", "verify only: report changes and drift, write nothing")
  .option("--target <id>", "limit to one target")
  .option("--force", "overwrite hand-edited or unmanaged files")
  .action(async (options) => {
    const exitCode = await runSync({
      cwd: process.cwd(),
      yes: options.yes ?? false,
      verify: options.verify ?? false,
      target: options.target,
      force: options.force ?? false,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    process.exitCode = exitCode;
  });

await program.parseAsync(process.argv);
