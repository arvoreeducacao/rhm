import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { checkAndAutoRegenerate } from "../core/hub-cache.js";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";
const DEFAULT_BRANCH = "main";

function tmpDir(): string {
  return join(process.env.TMPDIR || "/tmp", `hub-commands-${Date.now()}`);
}

async function listLocalCommands(commandsDir: string): Promise<{ name: string; description: string }[]> {
  const commands: { name: string; description: string }[] = [];

  if (!existsSync(commandsDir)) return commands;

  const files = await readdir(commandsDir);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(commandsDir, file), "utf-8");
    const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    commands.push({
      name: file.replace(/\.md$/, ""),
      description: firstLine?.trim() || "",
    });
  }

  return commands;
}

async function addFromRegistry(
  commandName: string,
  hubDir: string,
  opts: { repo?: string }
) {
  const repo = opts.repo || DEFAULT_REGISTRY_REPO;
  const fileName = commandName.endsWith(".md") ? commandName : `${commandName}.md`;
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/commands/${fileName}`;

  console.log(chalk.cyan(`  Downloading command '${commandName}' from ${repo}...`));

  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      console.log(chalk.red(`  Command '${commandName}' not found in registry (${repo})`));
      console.log(chalk.dim("  Run 'hub registry list --type command' to see available commands."));
      return;
    }

    const content = await res.text();
    const targetDir = join(hubDir, "commands");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, fileName), content, "utf-8");

    console.log(chalk.green(`  Installed: ${commandName}`));
    console.log(chalk.dim(`\n  Use it in Cursor with /${commandName}`));
    console.log(chalk.dim(`  Make sure hub.yaml has: commands_dir: ./commands\n`));
  } catch (err) {
    console.log(chalk.red(`  Failed to download command '${commandName}': ${(err as Error).message}`));
  }
}

async function addFromLocalPath(
  localPath: string,
  hubDir: string,
  opts: { command?: string }
) {
  const absPath = resolve(localPath);
  if (!existsSync(absPath)) {
    console.log(chalk.red(`  Path not found: ${absPath}`));
    return;
  }

  const stat = statSync(absPath);

  if (stat.isFile() && absPath.endsWith(".md")) {
    const targetDir = join(hubDir, "commands");
    await mkdir(targetDir, { recursive: true });
    const fileName = absPath.split("/").pop()!;
    await copyFile(absPath, join(targetDir, fileName));
    console.log(chalk.green(`  Installed: ${fileName.replace(/\.md$/, "")}`));
    console.log(chalk.green(`\n  1 command(s) installed\n`));
    return;
  }

  const sourceDir = stat.isDirectory()
    ? (existsSync(join(absPath, "commands")) ? join(absPath, "commands") : absPath)
    : absPath;

  await installCommandsFromDir(sourceDir, hubDir, opts);
}

async function installCommandsFromDir(
  sourceDir: string,
  hubDir: string,
  opts: { command?: string }
) {
  if (!existsSync(sourceDir)) {
    console.log(chalk.red("  No commands directory found in source"));
    return;
  }

  const files = await readdir(sourceDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  if (mdFiles.length === 0) {
    console.log(chalk.red("  No command files found (looking for *.md)"));
    return;
  }

  const toInstall = opts.command
    ? mdFiles.filter((f) => f === `${opts.command}.md` || f === opts.command)
    : mdFiles;

  if (opts.command && toInstall.length === 0) {
    const available = mdFiles.map((f) => f.replace(/\.md$/, "")).join(", ");
    console.log(chalk.red(`  Command '${opts.command}' not found. Available: ${available}`));
    return;
  }

  const targetDir = join(hubDir, "commands");
  await mkdir(targetDir, { recursive: true });

  for (const file of toInstall) {
    await copyFile(join(sourceDir, file), join(targetDir, file));
    console.log(chalk.green(`  Installed: ${file.replace(/\.md$/, "")}`));
  }

  console.log(chalk.green(`\n  ${toInstall.length} command(s) installed\n`));
}

async function addFromGitRepo(
  source: string,
  hubDir: string,
  opts: { command?: string }
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

    const sourceCommandsDir = join(tmp, "commands");
    await installCommandsFromDir(sourceCommandsDir, hubDir, opts);
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

export const commandsCommand = new Command("commands")
  .description("Manage slash commands (Cursor)")
  .addCommand(
    new Command("add")
      .description("Install commands from the registry, a git repository, or local path")
      .argument("<source>", "Command name (from registry), GitHub shorthand (org/repo), git URL, or local path")
      .option("-c, --command <name>", "Install a specific command only (for repo sources)")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .action(async (source: string, opts: { command?: string; repo?: string }) => {
        const hubDir = process.cwd();
        console.log(chalk.blue(`\nInstalling commands from ${source}\n`));

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

        await checkAndAutoRegenerate(hubDir);
      })
  )
  .addCommand(
    new Command("list").description("List installed commands").action(async () => {
      const hubDir = process.cwd();
      const commandsDir = join(hubDir, "commands");
      console.log(chalk.blue("\nInstalled commands\n"));

      const commands = await listLocalCommands(commandsDir);
      if (commands.length > 0) {
        for (const c of commands) {
          console.log(`  ${chalk.yellow(`/${c.name}`)}${c.description ? ` — ${c.description}` : ""}`);
        }
      } else {
        console.log(chalk.dim("  No commands installed (commands/)"));
      }
      console.log();
    })
  )
  .addCommand(
    new Command("find")
      .description("Browse curated commands in the Repo Hub directory")
      .argument("[query]", "Search term")
      .action(async (query?: string) => {
        const base = "https://hub.arvore.com.br/directory?type=command";
        const url = query
          ? `${base}&q=${encodeURIComponent(query)}`
          : base;

        console.log(chalk.blue("\n  Browse curated commands at:\n"));
        console.log(chalk.cyan(`  ${url}\n`));
        console.log(chalk.dim("  Install with: hub commands add <owner>/<repo>"));
        console.log(chalk.dim("  Example:      hub commands add obra/superpowers\n"));
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove a command")
      .argument("<name>", "Command name to remove")
      .action(async (name: string) => {
        const hubDir = process.cwd();
        const commandsDir = join(hubDir, "commands");
        const fileName = name.endsWith(".md") ? name : `${name}.md`;
        const target = join(commandsDir, fileName);

        if (!existsSync(target)) {
          console.log(chalk.red(`\nCommand '${name}' not found in commands/\n`));
          return;
        }

        await rm(target);
        console.log(chalk.green(`\nRemoved command: ${name}\n`));

        await checkAndAutoRegenerate(hubDir);
      })
  );
