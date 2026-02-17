import { Command } from "commander";
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

function getWorktreeBase(): string {
  return join(process.env.HOME || "~", ".cursor", "worktrees", "repo-hub");
}

function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export const worktreeCommand = new Command("worktree")
  .description("Manage git worktrees for parallel work")
  .addCommand(
    new Command("add")
      .description("Create a new worktree with environment files copied")
      .argument("<name>", "Worktree name")
      .action(async (name: string) => {
        const hubDir = process.cwd();

        if (!isGitRepo(hubDir)) {
          console.log(chalk.red("\nThis directory is not a git repository."));
          console.log(chalk.dim("Run 'git init' first or use worktrees from a repo directory.\n"));
          return;
        }

        const config = await loadHubConfig(hubDir);
        const worktreeBase = getWorktreeBase();
        const worktreePath = join(worktreeBase, name);

        console.log(chalk.blue(`\n━━━ Creating worktree: ${name} ━━━\n`));

        await mkdir(worktreeBase, { recursive: true });

        console.log(chalk.cyan("  Creating git worktree..."));
        try {
          execSync(`git worktree add "${worktreePath}" --detach`, {
            cwd: hubDir,
            stdio: "inherit",
          });
        } catch {
          console.log(chalk.red("  Failed to create worktree. Make sure you have commits in this repo.\n"));
          return;
        }

        console.log(chalk.cyan("  Copying environment files..."));
        for (const repo of config.repos) {
          if (!repo.env_file) continue;
          const srcEnv = join(hubDir, repo.path, repo.env_file);
          if (!existsSync(srcEnv)) continue;

          const destDir = join(worktreePath, repo.path);
          if (existsSync(destDir)) {
            const destEnv = join(destDir, repo.env_file);
            try {
              await cp(srcEnv, destEnv);
              console.log(chalk.green(`  ${repo.name}: Copied ${repo.env_file}`));
            } catch {
              console.log(chalk.dim(`  ${repo.name}: Could not copy env file`));
            }
          }
        }

        console.log(chalk.green(`\nWorktree created at: ${worktreePath}`));
        console.log(chalk.cyan(`Open in Cursor: cursor ${worktreePath}\n`));
      })
  )
  .addCommand(
    new Command("list")
      .description("List all worktrees")
      .action(async () => {
        const hubDir = process.cwd();

        if (!isGitRepo(hubDir)) {
          console.log(chalk.red("\nThis directory is not a git repository."));
          console.log(chalk.dim("Worktrees require a git repository.\n"));
          return;
        }

        console.log(chalk.blue("\n━━━ Git Worktrees ━━━\n"));
        execSync("git worktree list", { cwd: hubDir, stdio: "inherit" });
        console.log();
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove a worktree")
      .argument("<name>", "Worktree name")
      .action(async (name: string) => {
        const hubDir = process.cwd();

        if (!isGitRepo(hubDir)) {
          console.log(chalk.red("\nThis directory is not a git repository."));
          console.log(chalk.dim("Worktrees require a git repository.\n"));
          return;
        }

        const worktreePath = join(getWorktreeBase(), name);

        console.log(chalk.blue(`\n━━━ Removing worktree: ${name} ━━━\n`));

        try {
          execSync(`git worktree remove "${worktreePath}" --force`, {
            cwd: hubDir,
            stdio: "inherit",
          });
          console.log(chalk.green("  Worktree removed\n"));
        } catch {
          console.log(chalk.red(`  Failed to remove worktree '${name}'.\n`));
        }
      })
  )
  .addCommand(
    new Command("copy-envs")
      .description("Copy environment files to a worktree")
      .argument("[name]", "Worktree name (copies to that worktree)")
      .action(async (name?: string) => {
        const hubDir = process.cwd();
        const config = await loadHubConfig(hubDir);

        const targetDir = name ? join(getWorktreeBase(), name) : hubDir;

        if (!existsSync(targetDir)) {
          console.log(chalk.red(`\nWorktree '${name}' not found at ${targetDir}\n`));
          return;
        }

        console.log(chalk.blue("\n━━━ Copying environment files ━━━\n"));
        console.log(chalk.cyan(`  Source: ${hubDir}`));
        console.log(chalk.cyan(`  Target: ${targetDir}\n`));

        for (const repo of config.repos) {
          if (!repo.env_file) continue;
          const srcEnv = join(hubDir, repo.path, repo.env_file);
          if (!existsSync(srcEnv)) continue;

          const destDir = join(targetDir, repo.path);
          if (!existsSync(destDir)) continue;

          const destEnv = join(destDir, repo.env_file);
          try {
            await cp(srcEnv, destEnv);
            console.log(chalk.green(`  ${repo.name}: Copied ${repo.env_file}`));
          } catch {
            console.log(chalk.red(`  ${repo.name}: Failed to copy`));
          }
        }
        console.log();
      })
  );
