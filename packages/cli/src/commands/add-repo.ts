import { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { parse, stringify } from "yaml";
import chalk from "chalk";
import { resolveConfigPath, type HubConfig } from "../core/hub-config.js";

const SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/arvoreeducacao/rhm/main/schemas/hub.schema.json\n";

export const addRepoCommand = new Command("add-repo")
  .description("Add a repository to the hub")
  .argument("<url>", "Git repository URL")
  .option("-n, --name <name>", "Repository name (defaults to repo name from URL)")
  .option("-t, --tech <tech>", "Technology (nestjs, nextjs, elixir, react, etc)")
  .action(async (url: string, opts: { name?: string; tech?: string }) => {
    const hubDir = process.cwd();
    const { path: configPath, format } = resolveConfigPath(hubDir);

    if (format === "typescript") {
      console.log(chalk.yellow("add-repo is not supported with hub.config.ts — edit the file directly."));
      process.exit(1);
    }

    const content = await readFile(configPath, "utf-8");
    const config = parse(content) as HubConfig;

    const repoName =
      opts.name || basename(url).replace(/\.git$/, "");
    const repoPath = `./${repoName}`;

    if (config.repos.some((r) => r.name === repoName)) {
      console.log(chalk.yellow(`Repository ${repoName} already exists in hub.yaml`));
      return;
    }

    config.repos.push({
      name: repoName,
      path: repoPath,
      url,
      ...(opts.tech && { tech: opts.tech }),
    });

    await writeFile(configPath, SCHEMA_COMMENT + stringify(config), "utf-8");

    const gitignorePath = join(hubDir, ".gitignore");
    await appendFile(gitignorePath, `${repoName}\n`);

    const cursorignorePath = join(hubDir, ".cursorignore");
    if (existsSync(cursorignorePath)) {
      await appendFile(cursorignorePath, `!${repoName}/\n`);
      console.log(chalk.cyan("  Updated: .cursorignore"));
    }

    console.log(chalk.green(`\nAdded ${repoName} to hub`));
    console.log(chalk.cyan("  Updated: hub.yaml"));
    console.log(chalk.cyan("  Updated: .gitignore"));
    console.log();
    console.log(`Run ${chalk.bold("npx @arvoretech/hub setup")} to clone and install.`);
    console.log();
  });
