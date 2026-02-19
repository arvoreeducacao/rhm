import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, copyFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { downloadDirFromGitHub } from "./registry.js";
import { checkAndAutoRegenerate } from "../core/hub-cache.js";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";

function tmpDir(): string {
  return join(process.env.TMPDIR || "/tmp", `hub-hooks-${Date.now()}`);
}

async function listLocalHooks(hooksDir: string): Promise<{ name: string; description: string }[]> {
  const hooks: { name: string; description: string }[] = [];

  if (!existsSync(hooksDir)) return hooks;

  const entries = await readdir(hooksDir);
  for (const entry of entries) {
    const entryPath = join(hooksDir, entry);
    const stat = statSync(entryPath);

    if (stat.isFile() && entry.endsWith(".sh")) {
      hooks.push({ name: entry.replace(/\.sh$/, ""), description: "" });
    } else if (stat.isDirectory()) {
      const readmePath = join(entryPath, "README.md");
      let description = "";
      if (existsSync(readmePath)) {
        const content = await readFile(readmePath, "utf-8");
        const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
        description = firstLine?.trim() || "";
      }
      hooks.push({ name: entry, description });
    }
  }

  return hooks;
}

async function addFromRegistry(
  hookName: string,
  hubDir: string,
  opts: { repo?: string }
) {
  const repo = opts.repo || DEFAULT_REGISTRY_REPO;
  const targetDir = join(hubDir, "hooks", hookName);

  console.log(chalk.cyan(`  Downloading hook '${hookName}' from ${repo}...`));

  try {
    await downloadDirFromGitHub(repo, `hooks/${hookName}`, targetDir);
    console.log(chalk.green(`  Installed: ${hookName}`));
    console.log(chalk.dim("\n  Add the hook to hub.yaml to bind it to an event. Example:"));
    console.log(chalk.dim(`  hooks:`));
    console.log(chalk.dim(`    after_file_edit:`));
    console.log(chalk.dim(`      - type: command`));
    console.log(chalk.dim(`        command: "./hooks/${hookName}/hook.sh"\n`));
  } catch {
    console.log(chalk.red(`  Hook '${hookName}' not found in registry (${repo})`));
    console.log(chalk.dim("  Run 'hub registry list --type hook' to see available hooks."));
  }
}

async function addFromLocalPath(
  localPath: string,
  hubDir: string,
  opts: { hook?: string }
) {
  const absPath = resolve(localPath);
  if (!existsSync(absPath)) {
    console.log(chalk.red(`  Path not found: ${absPath}`));
    return;
  }

  const stat = statSync(absPath);
  const sourceHooksDir = stat.isDirectory()
    ? (existsSync(join(absPath, "hooks")) ? join(absPath, "hooks") : absPath)
    : absPath;

  await installHooksFromDir(sourceHooksDir, hubDir, opts);
}

async function installHooksFromDir(
  sourceDir: string,
  hubDir: string,
  opts: { hook?: string }
) {
  if (!existsSync(sourceDir)) {
    console.log(chalk.red("  No hooks directory found in source"));
    return;
  }

  const entries = await readdir(sourceDir);
  const hookEntries = entries.filter((e) => {
    const p = join(sourceDir, e);
    return e.endsWith(".sh") || statSync(p).isDirectory();
  });

  if (hookEntries.length === 0) {
    console.log(chalk.red("  No hook files found"));
    return;
  }

  const toInstall = opts.hook
    ? hookEntries.filter((e) => e === opts.hook || e === `${opts.hook}.sh` || e.replace(/\.sh$/, "") === opts.hook)
    : hookEntries;

  if (opts.hook && toInstall.length === 0) {
    const available = hookEntries.map((e) => e.replace(/\.sh$/, "")).join(", ");
    console.log(chalk.red(`  Hook '${opts.hook}' not found. Available: ${available}`));
    return;
  }

  const targetBase = join(hubDir, "hooks");
  await mkdir(targetBase, { recursive: true });

  for (const entry of toInstall) {
    const src = join(sourceDir, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) {
      await cp(src, join(targetBase, entry), { recursive: true });
    } else {
      await copyFile(src, join(targetBase, entry));
    }
    console.log(chalk.green(`  Installed: ${entry.replace(/\.sh$/, "")}`));
  }

  console.log(chalk.green(`\n  ${toInstall.length} hook(s) installed\n`));
}

async function addFromGitRepo(
  source: string,
  hubDir: string,
  opts: { hook?: string }
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

    const sourceHooksDir = join(tmp, "hooks");
    await installHooksFromDir(sourceHooksDir, hubDir, opts);
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

export const hooksCommand = new Command("hooks")
  .description("Manage editor hooks")
  .addCommand(
    new Command("add")
      .description("Install hooks from the registry, a git repository, or local path")
      .argument("<source>", "Hook name (from registry), GitHub shorthand (org/repo), git URL, or local path")
      .option("--hook <name>", "Install a specific hook only (for repo sources)")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .action(async (source: string, opts: { hook?: string; repo?: string }) => {
        const hubDir = process.cwd();
        console.log(chalk.blue(`\nInstalling hooks from ${source}\n`));

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
    new Command("list").description("List installed hooks").action(async () => {
      const hubDir = process.cwd();
      const hooksDir = join(hubDir, "hooks");
      console.log(chalk.blue("\nInstalled hooks\n"));

      const hooks = await listLocalHooks(hooksDir);
      if (hooks.length > 0) {
        for (const h of hooks) {
          console.log(`  ${chalk.yellow(h.name)}${h.description ? ` — ${h.description}` : ""}`);
        }
      } else {
        console.log(chalk.dim("  No hooks installed (hooks/)"));
      }
      console.log();
    })
  )
  .addCommand(
    new Command("find")
      .description("Browse curated hooks in the Repo Hub directory")
      .argument("[query]", "Search term")
      .action(async (query?: string) => {
        const base = "https://rhm-website.vercel.app/directory?type=hook";
        const url = query
          ? `${base}&q=${encodeURIComponent(query)}`
          : base;

        console.log(chalk.blue("\n  Browse curated hooks at:\n"));
        console.log(chalk.cyan(`  ${url}\n`));
        console.log(chalk.dim("  Install with: hub hooks add <owner>/<repo>"));
        console.log(chalk.dim("  Example:      hub hooks add obra/superpowers\n"));
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove a hook")
      .argument("<name>", "Hook name to remove")
      .action(async (name: string) => {
        const hubDir = process.cwd();
        const hooksDir = join(hubDir, "hooks");

        const shFile = join(hooksDir, `${name}.sh`);
        const dirPath = join(hooksDir, name);

        if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
          await rm(dirPath, { recursive: true });
          console.log(chalk.green(`\nRemoved hook: ${name}\n`));
        } else if (existsSync(shFile)) {
          await rm(shFile);
          console.log(chalk.green(`\nRemoved hook: ${name}\n`));
        } else {
          console.log(chalk.red(`\nHook '${name}' not found in hooks/\n`));
          return;
        }

        await checkAndAutoRegenerate(hubDir);
      })
  );
