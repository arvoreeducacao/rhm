import { Command } from "commander";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";
import { generateDockerCompose } from "../core/docker-compose.js";
import { checkAndAutoRegenerate } from "../core/hub-cache.js";

function run(cmd: string, cwd?: string) {
  execSync(cmd, { stdio: "inherit", cwd });
}

function runSilent(cmd: string, _cwd?: string): string {
  return execSync(cmd, { encoding: "utf-8", cwd: _cwd, stdio: ["pipe", "pipe", "pipe"] }).trim();
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

function hasMise(): boolean {
  try {
    runSilent("mise --version");
    return true;
  } catch {
    return false;
  }
}

function generateMiseToml(tools: Record<string, string>, settings?: Record<string, unknown>): string {
  const lines: string[] = ["[tools]"];
  for (const [tool, version] of Object.entries(tools)) {
    lines.push(`${tool} = "${version}"`);
  }
  if (settings && Object.keys(settings).length > 0) {
    lines.push("", "[settings]");
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === "boolean") lines.push(`${key} = ${value}`);
      else if (typeof value === "string") lines.push(`${key} = "${value}"`);
      else if (typeof value === "number") lines.push(`${key} = ${value}`);
    }
  }
  return lines.join("\n") + "\n";
}

export const setupCommand = new Command("setup")
  .description("Clone repos, start services, install tools, and install dependencies")
  .option("--skip-services", "Skip Docker services")
  .option("--skip-install", "Skip dependency installation")
  .option("--skip-tools", "Skip tool installation via mise")
  .action(async (opts: { skipServices?: boolean; skipInstall?: boolean; skipTools?: boolean }) => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);

    const useGh = !canSsh() && hasGh();
    const hasTools = config.tools || config.repos.some((r) => r.tools);
    const totalSteps = hasTools && !opts.skipTools ? 5 : 4;
    let step = 1;

    console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Cloning repositories ━━━\n`));

    for (const repo of config.repos) {
      const fullPath = join(hubDir, repo.path);
      console.log(chalk.yellow(`▸ ${repo.name}`));

      if (existsSync(fullPath)) {
        console.log(chalk.green("  Already exists, skipping"));
        continue;
      }

      if (useGh) {
        const slug = repo.url.replace("git@github.com:", "").replace(".git", "");
        run(`gh repo clone ${slug} ${fullPath}`);
      } else {
        run(`git clone ${repo.url} ${fullPath}`);
      }
      console.log(chalk.green("  Cloned"));
    }

    step++;

    if (!opts.skipServices && config.services?.length) {
      console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Starting services ━━━\n`));

      const composePath = join(hubDir, "docker-compose.yml");
      const composeContent = generateDockerCompose(config.services);
      await writeFile(composePath, composeContent, "utf-8");
      console.log(chalk.green("  Generated docker-compose.yml"));

      run("docker compose up -d", hubDir);
      console.log(chalk.green("  Services started"));

      for (const svc of config.services) {
        const port = svc.port || svc.ports?.[0];
        if (port) {
          console.log(chalk.cyan(`  ${svc.name}: localhost:${port}`));
        }
      }
    } else {
      console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Services (skipped) ━━━\n`));
    }

    step++;

    if (hasTools && !opts.skipTools) {
      console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Installing tools ━━━\n`));

      if (!hasMise()) {
        console.log(chalk.yellow("  mise not installed, skipping tool installation"));
        console.log(chalk.cyan("  Install mise: curl https://mise.run | sh"));
      } else {
        if (config.tools && Object.keys(config.tools).length > 0) {
          const content = generateMiseToml(config.tools, config.mise_settings);
          await writeFile(join(hubDir, ".mise.toml"), content, "utf-8");
          console.log(chalk.green(`  Generated .mise.toml (${Object.keys(config.tools).length} tools)`));

          try {
            run("mise trust && mise install", hubDir);
            console.log(chalk.green("  Hub tools installed"));
          } catch {
            console.log(chalk.red("  Failed to install hub tools"));
          }
        }

        for (const repo of config.repos) {
          if (!repo.tools || Object.keys(repo.tools).length === 0) continue;
          const repoDir = join(hubDir, repo.path);
          if (!existsSync(repoDir)) continue;

          const merged = { ...(config.tools || {}), ...repo.tools };
          const content = generateMiseToml(merged);
          await writeFile(join(repoDir, ".mise.toml"), content, "utf-8");

          console.log(chalk.yellow(`▸ ${repo.name}`));
          try {
            run("mise trust 2>/dev/null; mise install", repoDir);
            console.log(chalk.green("  Tools installed"));
          } catch {
            console.log(chalk.red("  Failed to install tools"));
          }
        }
      }

      step++;
    }

    console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Generating environment files ━━━\n`));

    for (const repo of config.repos) {
      if (!repo.env_file) continue;

      const envPath = join(hubDir, repo.path, repo.env_file);
      const overrides = config.env?.overrides?.["local"]?.[repo.name];

      if (overrides) {
        const dir = join(hubDir, repo.path);
        if (existsSync(dir)) {
          const lines = Object.entries(overrides).map(([k, v]) => `${k}=${v}`);
          await writeFile(envPath, lines.join("\n") + "\n", "utf-8");
          console.log(chalk.green(`  ${repo.name}: Created ${repo.env_file} (${lines.length} vars)`));
        }
      } else {
        console.log(chalk.dim(`  ${repo.name}: No local overrides`));
      }
    }

    step++;

    if (!opts.skipInstall) {
      console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Installing dependencies ━━━\n`));

      for (const repo of config.repos) {
        const fullPath = join(hubDir, repo.path);
        if (!existsSync(fullPath)) continue;

        const installCmd = repo.commands?.install;
        if (!installCmd) {
          console.log(chalk.dim(`  ${repo.name}: No install command`));
          continue;
        }

        console.log(chalk.yellow(`▸ ${repo.name}`));
        try {
          run(installCmd, fullPath);
          console.log(chalk.green("  Installed"));
        } catch {
          console.log(chalk.red(`  Failed: ${installCmd}`));
        }
      }
    } else {
      console.log(chalk.blue(`\n━━━ Step ${step}/${totalSteps}: Install (skipped) ━━━\n`));
    }

    console.log(chalk.blue("\n━━━ Setup complete ━━━\n"));

    await checkAndAutoRegenerate(hubDir);

    console.log("Next steps:");
    console.log(`  npx @arvoretech/hub generate`);
    console.log(`  Open the project in your editor and start building`);
    console.log();
  });
