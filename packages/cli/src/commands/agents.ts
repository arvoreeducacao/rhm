import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";
const DEFAULT_BRANCH = "main";

function tmpDir(): string {
  return join(process.env.TMPDIR || "/tmp", `hub-agents-${Date.now()}`);
}

async function listLocalAgents(agentsDir: string): Promise<{ name: string; description: string }[]> {
  const agents: { name: string; description: string }[] = [];

  if (!existsSync(agentsDir)) return agents;

  const files = await readdir(agentsDir);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(agentsDir, file), "utf-8");
    const descMatch = content.match(/^description:\s*(.+)$/m);
    agents.push({
      name: file.replace(/\.md$/, ""),
      description: descMatch?.[1]?.replace(/^["']|["']$/g, "") || "",
    });
  }

  return agents;
}

async function addFromRegistry(
  agentName: string,
  hubDir: string,
  opts: { global?: boolean; repo?: string }
) {
  const repo = opts.repo || DEFAULT_REGISTRY_REPO;
  const fileName = agentName.endsWith(".md") ? agentName : `${agentName}.md`;
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/agents/${fileName}`;

  console.log(chalk.cyan(`  Downloading ${agentName} from ${repo}...`));

  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      console.log(chalk.red(`  Agent '${agentName}' not found in registry (${repo})`));
      console.log(chalk.dim("  Run 'hub registry list' to see available agents."));
      return;
    }

    const content = await res.text();
    const targetBase = opts.global
      ? join(process.env.HOME || "~", ".cursor", "agents")
      : join(hubDir, "agents");

    await mkdir(targetBase, { recursive: true });
    await writeFile(join(targetBase, fileName), content, "utf-8");

    console.log(chalk.green(`  Installed: ${agentName}`));
    console.log(chalk.green(`\n  1 agent(s) installed to ${opts.global ? "global" : "project"}\n`));
  } catch (err) {
    console.log(chalk.red(`  Failed to download agent '${agentName}': ${(err as Error).message}`));
  }
}

async function addFromLocalPath(
  localPath: string,
  hubDir: string,
  opts: { agent?: string; global?: boolean }
) {
  const absPath = resolve(localPath);
  if (!existsSync(absPath)) {
    console.log(chalk.red(`  Path not found: ${absPath}`));
    return;
  }

  const sourceAgentsDir = statSync(absPath).isDirectory()
    ? join(absPath, "agents")
    : absPath;

  await installAgentsFromDir(sourceAgentsDir, hubDir, opts);
}

async function installAgentsFromDir(
  sourceAgentsDir: string,
  hubDir: string,
  opts: { agent?: string; global?: boolean }
) {
  if (!existsSync(sourceAgentsDir)) {
    console.log(chalk.red("  No agents/ directory found in source"));
    return;
  }

  const files = await readdir(sourceAgentsDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  if (mdFiles.length === 0) {
    console.log(chalk.red("  No agent files found (looking for agents/*.md)"));
    return;
  }

  const toInstall = opts.agent
    ? mdFiles.filter((f) => f === `${opts.agent}.md` || f === opts.agent)
    : mdFiles;

  if (opts.agent && toInstall.length === 0) {
    const available = mdFiles.map((f) => f.replace(/\.md$/, "")).join(", ");
    console.log(chalk.red(`  Agent '${opts.agent}' not found. Available: ${available}`));
    return;
  }

  const targetBase = opts.global
    ? join(process.env.HOME || "~", ".cursor", "agents")
    : join(hubDir, "agents");

  await mkdir(targetBase, { recursive: true });

  for (const file of toInstall) {
    await copyFile(join(sourceAgentsDir, file), join(targetBase, file));
    console.log(chalk.green(`  Installed: ${file.replace(/\.md$/, "")}`));
  }

  console.log(
    chalk.green(
      `\n  ${toInstall.length} agent(s) installed to ${opts.global ? "global" : "project"}\n`
    )
  );
}

async function addFromGitRepo(
  source: string,
  hubDir: string,
  opts: { agent?: string; global?: boolean }
) {
  const tmp = tmpDir();

  try {
    console.log(chalk.cyan(`  Cloning ${source}...`));
    try {
      execSync(`git clone --depth 1 ${source} ${tmp}`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      console.log(chalk.red(`  Repository not found or not accessible: ${source}`));
      return;
    }

    const sourceAgentsDir = join(tmp, "agents");
    await installAgentsFromDir(sourceAgentsDir, hubDir, opts);
  } finally {
    if (existsSync(tmp)) {
      await rm(tmp, { recursive: true });
    }
  }
}

function isLocalPath(source: string): boolean {
  return (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("~")
  );
}

function isRepoReference(source: string): boolean {
  return (
    source.startsWith("git@") ||
    source.startsWith("https://") ||
    source.includes("/")
  );
}

export const agentsCommand = new Command("agents")
  .description("Manage agent definitions")
  .addCommand(
    new Command("add")
      .description("Install agents from the registry, a git repository, or local path")
      .argument("<source>", "Agent name (from registry), GitHub shorthand (org/repo), git URL, or local path")
      .option("-a, --agent <name>", "Install a specific agent only (for repo sources)")
      .option("-g, --global", "Install to global ~/.cursor/agents/")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .action(async (source: string, opts: { agent?: string; global?: boolean; repo?: string }) => {
        const hubDir = process.cwd();
        console.log(chalk.blue(`\nInstalling agents from ${source}\n`));

        if (isLocalPath(source)) {
          await addFromLocalPath(source, hubDir, opts);
        } else if (isRepoReference(source)) {
          if (source.startsWith("git@") || source.startsWith("https://")) {
            await addFromGitRepo(source, hubDir, opts);
          } else {
            const url = `https://github.com/${source}.git`;
            await addFromGitRepo(url, hubDir, opts);
          }
        } else {
          await addFromRegistry(source, hubDir, opts);
        }
      })
  )
  .addCommand(
    new Command("list").description("List installed agents").action(async () => {
      const hubDir = process.cwd();
      console.log(chalk.blue("\nInstalled agents\n"));

      const projectAgents = await listLocalAgents(join(hubDir, "agents"));
      if (projectAgents.length > 0) {
        console.log(chalk.cyan("Project:"));
        for (const a of projectAgents) {
          console.log(`  ${chalk.yellow(a.name)}${a.description ? ` — ${a.description}` : ""}`);
        }
      } else {
        console.log(chalk.dim("  No project agents (agents/)"));
      }

      const globalDir = join(process.env.HOME || "~", ".cursor", "agents");
      const globalAgents = await listLocalAgents(globalDir);
      console.log();
      if (globalAgents.length > 0) {
        console.log(chalk.cyan("Global:"));
        for (const a of globalAgents) {
          console.log(`  ${chalk.yellow(a.name)}${a.description ? ` — ${a.description}` : ""}`);
        }
      } else {
        console.log(chalk.dim("  No global agents (~/.cursor/agents/)"));
      }
      console.log();
    })
  )
  .addCommand(
    new Command("remove")
      .description("Remove an agent")
      .argument("<name>", "Agent name to remove")
      .option("-g, --global", "Remove from global agents")
      .action(async (name: string, opts: { global?: boolean }) => {
        const hubDir = process.cwd();
        const base = opts.global
          ? join(process.env.HOME || "~", ".cursor", "agents")
          : join(hubDir, "agents");

        const fileName = name.endsWith(".md") ? name : `${name}.md`;
        const target = join(base, fileName);
        if (!existsSync(target)) {
          console.log(chalk.red(`\nAgent '${name}' not found in ${opts.global ? "global" : "project"}\n`));
          return;
        }

        await rm(target);
        console.log(chalk.green(`\nRemoved agent: ${name}\n`));
      })
  )
  .addCommand(
    new Command("sync")
      .description("Install all agents referenced in hub.yaml from the registry")
      .option("-g, --global", "Install to global ~/.cursor/agents/")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .option("-f, --force", "Re-install even if the agent already exists locally")
      .action(async (opts: { global?: boolean; repo?: string; force?: boolean }) => {
        const hubDir = process.cwd();

        let config;
        try {
          config = await loadHubConfig(hubDir);
        } catch {
          console.log(chalk.red("\n  Could not load hub.yaml in the current directory.\n"));
          return;
        }

        const steps = config.workflow?.pipeline || [];
        const agentNames = new Set<string>();

        for (const step of steps) {
          if (step.agent) agentNames.add(step.agent);
          if (Array.isArray(step.agents)) {
            for (const a of step.agents) {
              agentNames.add(typeof a === "string" ? a : a.agent);
            }
          }
        }

        if (agentNames.size === 0) {
          console.log(chalk.yellow("\n  No agents found in hub.yaml workflow pipeline.\n"));
          return;
        }

        console.log(chalk.blue(`\n━━━ Syncing ${agentNames.size} agent(s) from hub.yaml ━━━\n`));

        const targetBase = opts.global
          ? join(process.env.HOME || "~", ".cursor", "agents")
          : join(hubDir, "agents");

        let installed = 0;
        let skipped = 0;

        for (const name of agentNames) {
          const fileName = name.endsWith(".md") ? name : `${name}.md`;
          const targetPath = join(targetBase, fileName);

          if (!opts.force && existsSync(targetPath)) {
            console.log(chalk.dim(`  ✓ ${name} (already installed)`));
            skipped++;
            continue;
          }

          await addFromRegistry(name, hubDir, { global: opts.global, repo: opts.repo });
          installed++;
        }

        console.log();
        if (installed > 0) console.log(chalk.green(`  ${installed} agent(s) installed`));
        if (skipped > 0) console.log(chalk.dim(`  ${skipped} agent(s) already up to date`));
        if (installed === 0 && skipped > 0) {
          console.log(chalk.green("  All agents are already installed. Use --force to re-install."));
        }
        console.log();
      })
  );
