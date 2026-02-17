import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

interface Check {
  name: string;
  command: string;
  versionFlag?: string;
  required: boolean;
}

const CHECKS: Check[] = [
  { name: "git", command: "git", versionFlag: "--version", required: true },
  { name: "docker", command: "docker", versionFlag: "--version", required: true },
  { name: "node", command: "node", versionFlag: "--version", required: true },
  { name: "pnpm", command: "pnpm", versionFlag: "--version", required: false },
  { name: "mise", command: "mise", versionFlag: "--version", required: false },
  { name: "gh", command: "gh", versionFlag: "--version", required: false },
  { name: "aws", command: "aws", versionFlag: "--version", required: false },
];

function checkCommand(check: Check): { found: boolean; version?: string } {
  try {
    const output = execSync(`${check.command} ${check.versionFlag || "--version"}`, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    const version = output.split("\n")[0];
    return { found: true, version };
  } catch {
    return { found: false };
  }
}

function getToolVersion(tool: string): string | null {
  const versionFlags: Record<string, string> = {
    node: "--version",
    pnpm: "--version",
    yarn: "--version",
    erlang: "+V",
    elixir: "--version",
    ruby: "--version",
    python: "--version",
    go: "version",
    rust: "--version",
    direnv: "--version",
  };

  const flag = versionFlags[tool] || "--version";

  try {
    const cmd = tool === "erlang" ? "erl" : tool;
    const output = execSync(`${cmd} ${flag}`, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    return output.split("\n")[0];
  } catch {
    return null;
  }
}

function versionMatches(actual: string, expected: string): boolean {
  const extractVersion = (s: string): string => {
    const match = s.match(/(\d+\.\d+[.\d]*)/);
    return match?.[1] || s;
  };

  const actualClean = extractVersion(actual);
  return actualClean.startsWith(expected) || expected.startsWith(actualClean);
}

export const doctorCommand = new Command("doctor")
  .description("Check required dependencies and tool versions from hub.yaml")
  .action(async () => {
    const hubDir = process.cwd();
    let config;
    try {
      config = await loadHubConfig(hubDir);
    } catch {
      config = null;
    }

    console.log(chalk.blue("\nChecking dependencies\n"));

    let allOk = true;
    const required = CHECKS.filter((c) => c.required);
    const recommended = CHECKS.filter((c) => !c.required);

    console.log(chalk.cyan("Required:"));
    for (const check of required) {
      const result = checkCommand(check);
      if (result.found) {
        console.log(chalk.green(`  ✓ ${check.name}: ${result.version}`));
      } else {
        console.log(chalk.red(`  ✗ ${check.name}: not found`));
        allOk = false;
      }
    }

    console.log();
    console.log(chalk.cyan("Recommended:"));
    for (const check of recommended) {
      const result = checkCommand(check);
      if (result.found) {
        console.log(chalk.green(`  ✓ ${check.name}: ${result.version}`));
      } else {
        console.log(chalk.dim(`  - ${check.name}: not found`));
      }
    }

    if (config?.tools && Object.keys(config.tools).length > 0) {
      console.log();
      console.log(chalk.cyan("Hub tools (from hub.yaml):"));

      for (const [tool, expected] of Object.entries(config.tools)) {
        const actual = getToolVersion(tool);
        if (!actual) {
          console.log(chalk.red(`  ✗ ${tool}: not found (expected ${expected})`));
          allOk = false;
        } else if (versionMatches(actual, expected)) {
          console.log(chalk.green(`  ✓ ${tool}: ${actual} (expected ${expected})`));
        } else {
          console.log(chalk.yellow(`  ⚠ ${tool}: ${actual} (expected ${expected})`));
        }
      }
    }

    if (config?.repos) {
      const reposWithTools = config.repos.filter(
        (r) => r.tools && Object.keys(r.tools).length > 0
      );

      if (reposWithTools.length > 0) {
        console.log();
        console.log(chalk.cyan("Repo-specific tools:"));

        for (const repo of reposWithTools) {
          const repoDir = join(hubDir, repo.path);
          if (!existsSync(repoDir)) {
            console.log(chalk.dim(`  ${repo.name}: not cloned, skipping`));
            continue;
          }

          console.log(chalk.yellow(`  ▸ ${repo.name}`));
          for (const [tool, expected] of Object.entries(repo.tools!)) {
            const actual = getToolVersion(tool);
            if (!actual) {
              console.log(chalk.red(`    ✗ ${tool}: not found (expected ${expected})`));
            } else if (versionMatches(actual, expected)) {
              console.log(chalk.green(`    ✓ ${tool}: ${actual} (expected ${expected})`));
            } else {
              console.log(chalk.yellow(`    ⚠ ${tool}: ${actual} (expected ${expected})`));
            }
          }
        }
      }
    }

    console.log();
    if (allOk) {
      console.log(chalk.green("All checks passed!\n"));
    } else {
      console.log(chalk.red("Some checks failed.\n"));
      if (config?.tools) {
        console.log(chalk.cyan("Fix with: hub tools install\n"));
      }
      process.exit(1);
    }
  });
