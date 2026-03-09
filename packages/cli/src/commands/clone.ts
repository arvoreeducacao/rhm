import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

function run(cmd: string, cwd?: string) {
  execSync(cmd, { stdio: "inherit", cwd });
}

function runSilent(cmd: string, cwd?: string): string {
  return execSync(cmd, { encoding: "utf-8", cwd, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function canSsh(): boolean {
  try {
    const out = runSilent("ssh -T git@github.com 2>&1 || true");
    return out.includes("successfully authenticated");
  } catch {
    return false;
  }
}

function hasGh(): boolean {
  try {
    runSilent("gh auth status");
    return true;
  } catch {
    return false;
  }
}

export const cloneCommand = new Command("clone")
  .description("Clone all repositories without running full setup")
  .option("--ssh", "Force SSH clone (default if SSH is available)")
  .option("--https", "Force HTTPS clone via gh CLI")
  .action(async (opts: { ssh?: boolean; https?: boolean }) => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);

    const useGh = opts.https || (!opts.ssh && !canSsh() && hasGh());

    console.log(chalk.blue("\n━━━ Cloning repositories ━━━\n"));

    let cloned = 0;
    let skipped = 0;

    for (const repo of config.repos) {
      const fullPath = join(hubDir, repo.path);
      console.log(chalk.yellow(`▸ ${repo.name}`));

      if (existsSync(fullPath)) {
        console.log(chalk.green("  Already exists, skipping"));
        skipped++;
        continue;
      }

      if (useGh) {
        const slug = repo.url.replace("git@github.com:", "").replace(".git", "");
        run(`gh repo clone ${slug} ${fullPath}`);
      } else {
        run(`git clone ${repo.url} ${fullPath}`);
      }
      console.log(chalk.green("  Cloned"));
      cloned++;
    }

    console.log(chalk.blue("\n━━━ Done ━━━\n"));
    console.log(`  ${chalk.green(`${cloned} cloned`)}, ${chalk.dim(`${skipped} already existed`)}`);
    console.log();
  });
