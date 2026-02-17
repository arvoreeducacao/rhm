import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

export const pullCommand = new Command("pull")
  .description("Pull latest changes in all repositories")
  .action(async () => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);

    console.log(chalk.blue("\n━━━ Pulling latest changes ━━━\n"));

    for (const repo of config.repos) {
      const fullPath = join(hubDir, repo.path);
      if (!existsSync(fullPath)) {
        console.log(chalk.red(`  ${repo.name}: not cloned`));
        continue;
      }

      console.log(chalk.yellow(`▸ ${repo.name}`));
      try {
        execSync("git pull --rebase", { cwd: fullPath, stdio: "inherit" });
        console.log(chalk.green("  Updated"));
      } catch {
        console.log(chalk.red("  Failed to pull"));
      }
    }
    console.log();
  });

export const statusCommand = new Command("status")
  .description("Show git status for all repositories")
  .action(async () => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);

    console.log(chalk.blue("\n━━━ Git status ━━━\n"));

    for (const repo of config.repos) {
      const fullPath = join(hubDir, repo.path);
      if (!existsSync(fullPath)) {
        console.log(chalk.red(`  ${repo.name}: not cloned`));
        continue;
      }

      console.log(chalk.yellow(`▸ ${repo.name}`));

      try {
        const branch = execSync("git branch --show-current", {
          cwd: fullPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();

        const changes = execSync("git status --porcelain", {
          cwd: fullPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        })
          .trim()
          .split("\n")
          .filter(Boolean).length;

        let ahead = "0";
        let behind = "0";
        try {
          ahead = execSync("git rev-list --count @{u}..HEAD", {
            cwd: fullPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          behind = execSync("git rev-list --count HEAD..@{u}", {
            cwd: fullPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
        } catch {
          // no upstream
        }

        console.log(`  Branch: ${branch}`);
        console.log(`  Changes: ${changes} file(s)`);
        console.log(`  Ahead: ${ahead} | Behind: ${behind}`);
      } catch {
        console.log(chalk.red("  Failed to get status"));
      }
      console.log();
    }
  });

export const execCommand = new Command("exec")
  .description("Execute a command in all repositories")
  .argument("<cmd...>", "Command to execute")
  .passThroughOptions()
  .allowUnknownOption()
  .action(async (cmd: string[]) => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);
    const command = cmd.join(" ");

    console.log(chalk.blue(`\n━━━ Executing: ${command} ━━━\n`));

    for (const repo of config.repos) {
      const fullPath = join(hubDir, repo.path);
      if (!existsSync(fullPath)) {
        console.log(chalk.red(`  ${repo.name}: not cloned`));
        continue;
      }

      console.log(chalk.yellow(`▸ ${repo.name}`));
      try {
        execSync(command, { cwd: fullPath, stdio: "inherit" });
      } catch {
        console.log(chalk.red(`  Command failed in ${repo.name}`));
      }
    }
    console.log();
  });
