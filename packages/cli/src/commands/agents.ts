import { Command } from "commander";
import chalk from "chalk";

function printDeprecation() {
  console.log(
    chalk.yellow(
      "\n`hub agents` is deprecated. Agents were replaced by skills in the skills-centered model.\n",
    ),
  );
  console.log("Use the equivalent skills commands instead:");
  console.log(`  ${chalk.cyan("hub skills add <name>")}      install a skill`);
  console.log(`  ${chalk.cyan("hub skills list")}            list installed skills`);
  console.log(`  ${chalk.cyan("hub skills find <query>")}     browse the registry`);
  console.log(`  ${chalk.cyan("hub skills remove <name>")}    remove a skill`);
  console.log();
  console.log(
    chalk.dim(
      "Declare workspace skills in your config under `skills: [...]` (or per-repo `skills:`), then run `hub generate`.",
    ),
  );
  console.log();
}

export const agentsCommand = new Command("agents")
  .description("Deprecated — use `hub skills` (agents were replaced by skills)")
  .allowUnknownOption()
  .argument("[args...]", "deprecated")
  .action(async () => {
    printDeprecation();
    process.exitCode = 1;
  });
