import { Command } from "commander";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "yaml";
import chalk from "chalk";
import inquirer from "inquirer";
import type { HubConfig } from "../core/hub-config.js";

async function findUnregisteredRepos(hubDir: string, config: HubConfig): Promise<string[]> {
  const registeredPaths = new Set(
    config.repos.map((r) => r.path.replace(/^\.\//, ""))
  );

  const entries = await readdir(hubDir);
  const unregistered: string[] = [];

  for (const entry of entries) {
    if (registeredPaths.has(entry)) continue;

    const gitDir = join(hubDir, entry, ".git");
    if (existsSync(gitDir)) {
      unregistered.push(entry);
    }
  }

  return unregistered;
}

function detectTech(repoDir: string): string | undefined {
  if (existsSync(join(repoDir, "mix.exs"))) return "elixir";
  if (existsSync(join(repoDir, "next.config.js")) || existsSync(join(repoDir, "next.config.ts")) || existsSync(join(repoDir, "next.config.mjs"))) return "nextjs";
  if (existsSync(join(repoDir, "nest-cli.json"))) return "nestjs";
  if (existsSync(join(repoDir, "angular.json"))) return "angular";
  if (existsSync(join(repoDir, "svelte.config.js"))) return "svelte";
  if (existsSync(join(repoDir, "nuxt.config.ts")) || existsSync(join(repoDir, "nuxt.config.js"))) return "vue";
  if (existsSync(join(repoDir, "go.mod"))) return "go";
  if (existsSync(join(repoDir, "Gemfile"))) return "rails";
  if (existsSync(join(repoDir, "manage.py"))) return "django";
  if (existsSync(join(repoDir, "package.json"))) return "react";
  return undefined;
}

function getGitRemote(repoDir: string): string {
  try {
    return execSync("git remote get-url origin", { cwd: repoDir, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function buildRepoYaml(repo: { name: string; path: string; url: string; tech?: string }): string {
  const lines: string[] = [];
  lines.push(`  - name: ${repo.name}`);
  lines.push(`    path: ${repo.path}`);
  lines.push(`    url: ${repo.url}`);
  if (repo.tech) lines.push(`    tech: ${repo.tech}`);
  return lines.join("\n");
}

function findReposInsertionPoint(content: string): number {
  const lines = content.split("\n");
  let lastRepoLine = -1;
  let inRepos = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^repos:/.test(line)) {
      inRepos = true;
      continue;
    }
    if (inRepos) {
      if (/^[a-z]/.test(line) || /^[A-Z]/.test(line)) break;
      if (line.trim() !== "") lastRepoLine = i;
    }
  }

  if (lastRepoLine === -1) return content.length;

  let offset = 0;
  for (let i = 0; i <= lastRepoLine; i++) {
    offset += lines[i].length + 1;
  }
  return offset;
}

export const scanCommand = new Command("scan")
  .description("Detect git repositories not registered in hub.yaml")
  .option("-y, --yes", "Auto-add all found repos without prompting")
  .action(async (opts: { yes?: boolean }) => {
    const hubDir = process.cwd();
    const configPath = join(hubDir, "hub.yaml");

    if (!existsSync(configPath)) {
      console.log(chalk.red("No hub.yaml found in current directory."));
      process.exit(1);
    }

    const content = await readFile(configPath, "utf-8");
    const config = parse(content) as HubConfig;

    console.log(chalk.blue("\nScanning for unregistered repositories...\n"));

    const unregistered = await findUnregisteredRepos(hubDir, config);

    if (unregistered.length === 0) {
      console.log(chalk.green("All repositories are registered in hub.yaml.\n"));
      return;
    }

    console.log(chalk.yellow(`Found ${unregistered.length} unregistered repo(s):\n`));

    const repoDetails = unregistered.map((name) => {
      const repoDir = join(hubDir, name);
      const tech = detectTech(repoDir);
      const url = getGitRemote(repoDir);
      return { name, tech, url, path: `./${name}` };
    });

    for (const repo of repoDetails) {
      const techLabel = repo.tech ? chalk.dim(` (${repo.tech})`) : "";
      console.log(`  ${chalk.cyan(repo.name)}${techLabel}`);
    }
    console.log();

    let toAdd = repoDetails;

    if (!opts.yes) {
      const { selected } = await inquirer.prompt<{ selected: string[] }>([
        {
          type: "checkbox",
          name: "selected",
          message: "Select repos to add to hub.yaml:",
          choices: repoDetails.map((r) => ({
            name: `${r.name}${r.tech ? ` (${r.tech})` : ""}`,
            value: r.name,
            checked: true,
          })),
        },
      ]);
      toAdd = repoDetails.filter((r) => selected.includes(r.name));
    }

    if (toAdd.length === 0) {
      console.log(chalk.dim("No repos selected.\n"));
      return;
    }

    const originalContent = await readFile(configPath, "utf-8");
    const insertAt = findReposInsertionPoint(originalContent);
    const before = originalContent.slice(0, insertAt);
    const after = originalContent.slice(insertAt);

    const newEntries = toAdd.map(buildRepoYaml).join("\n");
    const updatedContent = before + newEntries + "\n" + after;

    await import("node:fs/promises").then((fs) => fs.writeFile(configPath, updatedContent, "utf-8"));
    console.log(chalk.green(`\nAdded ${toAdd.length} repo(s) to hub.yaml.`));
    console.log(chalk.cyan(`Run ${chalk.bold("hub generate")} to update editor configs.\n`));
  });
