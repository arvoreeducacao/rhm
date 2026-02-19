import { Command } from "commander";
import chalk from "chalk";

const BASE_URL = "https://hub.arvore.com.br/directory";

export const directoryCommand = new Command("directory")
  .alias("dir")
  .description("Browse the Repo Hub directory of skills, agents, hooks, and commands")
  .argument("[query]", "Search term")
  .option("-t, --type <type>", "Filter by type (skill, agent, hook, command)")
  .action(async (query?: string, opts?: { type?: string }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (query) params.set("q", query);

    const qs = params.toString();
    const url = qs ? `${BASE_URL}?${qs}` : BASE_URL;

    console.log(chalk.blue("\n  Repo Hub Directory\n"));
    console.log(chalk.cyan(`  ${url}\n`));
    console.log(chalk.dim("  Install examples:"));
    console.log(chalk.dim("    hub skills add <owner>/<repo>/<skill>"));
    console.log(chalk.dim("    hub agents add <owner>/<repo>"));
    console.log(chalk.dim("    hub hooks add <owner>/<repo>"));
    console.log(chalk.dim("    hub commands add <owner>/<repo>\n"));
  });
