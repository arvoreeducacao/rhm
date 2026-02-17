import { Command } from "commander";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig, type HubConfig, type MiseSettings } from "../core/hub-config.js";

function hasMise(): boolean {
  try {
    execSync("mise --version", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function generateMiseToml(
  tools: Record<string, string>,
  settings?: MiseSettings
): string {
  const lines: string[] = [];

  lines.push("[tools]");
  for (const [tool, version] of Object.entries(tools)) {
    lines.push(`${tool} = "${version}"`);
  }

  if (settings && Object.keys(settings).length > 0) {
    lines.push("");
    lines.push("[settings]");
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === "boolean") {
        lines.push(`${key} = ${value}`);
      } else if (typeof value === "string") {
        lines.push(`${key} = "${value}"`);
      } else if (typeof value === "number") {
        lines.push(`${key} = ${value}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function mergeTools(
  global: Record<string, string>,
  local: Record<string, string>
): Record<string, string> {
  return { ...global, ...local };
}

async function generateMiseFiles(config: HubConfig, hubDir: string) {
  let count = 0;

  if (config.tools && Object.keys(config.tools).length > 0) {
    const content = generateMiseToml(config.tools, config.mise_settings);
    await writeFile(join(hubDir, ".mise.toml"), content, "utf-8");
    console.log(chalk.green(`  Generated .mise.toml (${Object.keys(config.tools).length} tools)`));
    count++;
  }

  for (const repo of config.repos) {
    if (!repo.tools || Object.keys(repo.tools).length === 0) continue;

    const repoDir = join(hubDir, repo.path);
    if (!existsSync(repoDir)) {
      console.log(chalk.dim(`  ${repo.name}: not cloned, skipping`));
      continue;
    }

    const merged = mergeTools(config.tools || {}, repo.tools);
    const content = generateMiseToml(merged);
    await writeFile(join(repoDir, ".mise.toml"), content, "utf-8");
    console.log(chalk.green(`  ${repo.name}: Generated .mise.toml (${Object.keys(merged).length} tools)`));
    count++;
  }

  return count;
}

export const toolsCommand = new Command("tools")
  .description("Manage development tool versions via mise")
  .addCommand(
    new Command("install")
      .description("Install all tools defined in hub.yaml using mise")
      .option("--generate", "Generate .mise.toml files before installing")
      .action(async (opts: { generate?: boolean }) => {
        const hubDir = process.cwd();
        const config = await loadHubConfig(hubDir);

        if (!hasMise()) {
          console.log(chalk.red("\nmise is not installed."));
          console.log(chalk.cyan("Install with: curl https://mise.run | sh"));
          console.log(chalk.cyan("Or: brew install mise\n"));
          return;
        }

        if (!config.tools && !config.repos.some((r) => r.tools)) {
          console.log(chalk.yellow("\nNo tools defined in hub.yaml\n"));
          return;
        }

        console.log(chalk.blue("\n━━━ Installing tools ━━━\n"));

        if (opts.generate) {
          await generateMiseFiles(config, hubDir);
          console.log();
        }

        if (config.tools && Object.keys(config.tools).length > 0) {
          console.log(chalk.cyan("Installing hub-level tools..."));
          try {
            execSync("mise trust && mise install", {
              cwd: hubDir,
              stdio: "inherit",
            });
            console.log(chalk.green("  Hub tools installed\n"));
          } catch {
            console.log(chalk.red("  Failed to install hub tools\n"));
          }
        }

        for (const repo of config.repos) {
          if (!repo.tools || Object.keys(repo.tools).length === 0) continue;

          const repoDir = join(hubDir, repo.path);
          if (!existsSync(repoDir)) {
            console.log(chalk.dim(`  ${repo.name}: not cloned, skipping`));
            continue;
          }

          console.log(chalk.yellow(`▸ ${repo.name}`));
          try {
            execSync("mise trust 2>/dev/null; mise install", {
              cwd: repoDir,
              stdio: "inherit",
            });
            console.log(chalk.green("  Tools installed"));
          } catch {
            console.log(chalk.red("  Failed to install tools"));
          }
        }

        console.log(chalk.green("\nAll tools installed!\n"));
        console.log(chalk.cyan("Make sure mise is activated in your shell:"));
        console.log('  eval "$(mise activate zsh)"   # zsh');
        console.log('  eval "$(mise activate bash)"  # bash\n');
      })
  )
  .addCommand(
    new Command("generate")
      .description("Generate .mise.toml files from hub.yaml")
      .action(async () => {
        const hubDir = process.cwd();
        const config = await loadHubConfig(hubDir);

        if (!config.tools && !config.repos.some((r) => r.tools)) {
          console.log(chalk.yellow("\nNo tools defined in hub.yaml\n"));
          return;
        }

        console.log(chalk.blue("\n━━━ Generating .mise.toml files ━━━\n"));

        const count = await generateMiseFiles(config, hubDir);

        console.log(chalk.green(`\nGenerated ${count} .mise.toml file(s)\n`));
        console.log(chalk.cyan("Install with: hub tools install\n"));
      })
  )
  .addCommand(
    new Command("check")
      .description("Verify installed tool versions match hub.yaml")
      .action(async () => {
        const hubDir = process.cwd();
        const config = await loadHubConfig(hubDir);

        if (!config.tools && !config.repos.some((r) => r.tools)) {
          console.log(chalk.yellow("\nNo tools defined in hub.yaml\n"));
          return;
        }

        console.log(chalk.blue("\n━━━ Checking tool versions ━━━\n"));

        let allOk = true;

        if (config.tools) {
          console.log(chalk.cyan("Hub tools:"));
          for (const [tool, expected] of Object.entries(config.tools)) {
            const actual = getInstalledVersion(tool);
            if (!actual) {
              console.log(chalk.red(`  ✗ ${tool}: not found (expected ${expected})`));
              allOk = false;
            } else if (actual.includes(expected) || expected.includes(extractVersion(actual))) {
              console.log(chalk.green(`  ✓ ${tool} ${expected}`));
            } else {
              console.log(chalk.yellow(`  ⚠ ${tool}: ${extractVersion(actual)} (expected ${expected})`));
              allOk = false;
            }
          }
        }

        for (const repo of config.repos) {
          if (!repo.tools || Object.keys(repo.tools).length === 0) continue;

          const repoDir = join(hubDir, repo.path);
          if (!existsSync(repoDir)) {
            console.log(chalk.dim(`\n  ${repo.name}: not cloned`));
            continue;
          }

          console.log(chalk.yellow(`\n  ▸ ${repo.name}`));
          for (const [tool, expected] of Object.entries(repo.tools)) {
            const actual = getInstalledVersion(tool);
            if (!actual) {
              console.log(chalk.red(`    ✗ ${tool}: not found (expected ${expected})`));
              allOk = false;
            } else if (actual.includes(expected) || expected.includes(extractVersion(actual))) {
              console.log(chalk.green(`    ✓ ${tool} ${expected}`));
            } else {
              console.log(chalk.yellow(`    ⚠ ${tool}: ${extractVersion(actual)} (expected ${expected})`));
              allOk = false;
            }
          }
        }

        console.log();
        if (allOk) {
          console.log(chalk.green("All tool versions match!\n"));
        } else {
          console.log(chalk.red("Some tools are missing or have wrong versions.\n"));
          console.log(chalk.cyan("Fix with: hub tools install --generate\n"));
        }
      })
  );

function getInstalledVersion(tool: string): string | null {
  const cmds: Record<string, string> = {
    node: "node --version",
    pnpm: "pnpm --version",
    yarn: "yarn --version",
    erlang: "erl +V 2>&1",
    elixir: "elixir --version",
    ruby: "ruby --version",
    python: "python3 --version",
    go: "go version",
    rust: "rustc --version",
    direnv: "direnv --version",
    java: "java --version",
  };

  const cmd = cmds[tool] || `${tool} --version`;

  try {
    return execSync(cmd, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function extractVersion(s: string): string {
  const match = s.match(/(\d+\.\d+[.\d]*)/);
  return match?.[1] || s;
}
