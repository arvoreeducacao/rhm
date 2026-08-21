import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { downloadDirFromGitHub } from "@arvoretech/hub-core";
import { checkAndAutoRegenerate } from "../core/auto-regenerate.js";
import { loadHubConfig } from "../core/hub-config.js";
import { collectConfigSkills, installConfigSkills } from "../core/install-skills.js";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";

function tmpDir(): string {
  return join(process.env.TMPDIR || "/tmp", `hub-skills-${Date.now()}`);
}

async function listLocalSkills(hubDir: string): Promise<{ name: string; description: string }[]> {
  const skillsDir = join(hubDir, "skills");
  const skills: { name: string; description: string }[] = [];

  if (!existsSync(skillsDir)) return skills;

  const folders = await readdir(skillsDir);
  for (const folder of folders) {
    const skillFile = join(skillsDir, folder, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = await readFile(skillFile, "utf-8");
    const descMatch = content.match(/^description:\s*(.+)$/m);
    skills.push({
      name: folder,
      description: descMatch?.[1] || "",
    });
  }

  return skills;
}

async function findSkillFolders(rootDir: string): Promise<{ dir: string; folders: string[] }> {
  const skillsDir = join(rootDir, "skills");
  if (existsSync(skillsDir)) {
    const entries = await readdir(skillsDir);
    const folders = entries.filter((f) =>
      existsSync(join(skillsDir, f, "SKILL.md"))
    );
    if (folders.length > 0) return { dir: skillsDir, folders };
  }

  if (existsSync(rootDir)) {
    const entries = await readdir(rootDir);
    const folders = entries.filter(
      (f) =>
        !f.startsWith(".") &&
        f !== "node_modules" &&
        existsSync(join(rootDir, f, "SKILL.md"))
    );
    if (folders.length > 0) return { dir: rootDir, folders };
  }

  if (existsSync(join(rootDir, "SKILL.md"))) {
    return { dir: join(rootDir, ".."), folders: [rootDir.split("/").pop()!] };
  }

  return { dir: skillsDir, folders: [] };
}

async function installSkillsFromDir(
  sourceSkillsDir: string,
  hubDir: string,
  opts: { skill?: string; global?: boolean }
) {
  const rootDir = sourceSkillsDir.endsWith("/skills")
    ? sourceSkillsDir.replace(/\/skills$/, "")
    : sourceSkillsDir;

  const { dir, folders: skillFolders } = await findSkillFolders(rootDir);

  if (skillFolders.length === 0) {
    console.log(chalk.red("  No skills found (looked in skills/, root dirs, and SKILL.md)"));
    return;
  }

  const toInstall = opts.skill
    ? skillFolders.filter((s) => s === opts.skill)
    : skillFolders;

  if (opts.skill && toInstall.length === 0) {
    console.log(chalk.red(`  Skill '${opts.skill}' not found. Available: ${skillFolders.join(", ")}`));
    return;
  }

  const targetBase = opts.global
    ? join(process.env.HOME || "~", ".cursor", "skills")
    : join(hubDir, "skills");

  await mkdir(targetBase, { recursive: true });

  for (const skill of toInstall) {
    const src = join(dir, skill);
    const dest = join(targetBase, skill);

    await cp(src, dest, { recursive: true });
    console.log(chalk.green(`  Installed: ${skill}`));
  }

  console.log(
    chalk.green(
      `\n  ${toInstall.length} skill(s) installed to ${opts.global ? "global" : "project"}\n`
    )
  );
}

async function addFromRegistry(
  skillName: string,
  hubDir: string,
  opts: { global?: boolean; repo?: string }
) {
  const repo = opts.repo || DEFAULT_REGISTRY_REPO;
  const remotePath = `skills/${skillName}`;
  const targetBase = opts.global
    ? join(process.env.HOME || "~", ".cursor", "skills")
    : join(hubDir, "skills");
  const dest = join(targetBase, skillName);

  console.log(chalk.cyan(`  Downloading ${skillName} from ${repo}...`));

  try {
    await downloadDirFromGitHub(repo, remotePath, dest);

    if (!existsSync(join(dest, "SKILL.md"))) {
      await rm(dest, { recursive: true }).catch(() => {});
      console.log(chalk.red(`  Skill '${skillName}' not found in registry (${repo})`));
      console.log(chalk.dim("  Run 'hub registry list' to see available skills."));
      return;
    }

    console.log(chalk.green(`  Installed: ${skillName}`));
    console.log(chalk.green(`\n  1 skill(s) installed to ${opts.global ? "global" : "project"}\n`));
  } catch (err) {
    console.log(chalk.red(`  Failed to download skill '${skillName}': ${(err as Error).message}`));
    console.log(chalk.dim("  Run 'hub registry list' to see available skills."));
  }
}

async function addFromGitHubSkill(
  owner: string,
  repo: string,
  skillName: string,
  hubDir: string,
  opts: { global?: boolean }
) {
  const fullRepo = `${owner}/${repo}`;
  const targetBase = opts.global
    ? join(process.env.HOME || "~", ".cursor", "skills")
    : join(hubDir, "skills");
  const dest = join(targetBase, skillName);

  const pathsToTry = [
    `skills/${skillName}`,
    skillName,
  ];

  console.log(chalk.cyan(`  Downloading ${skillName} from ${fullRepo} via GitHub API...`));

  for (const remotePath of pathsToTry) {
    try {
      await downloadDirFromGitHub(fullRepo, remotePath, dest);

      if (existsSync(join(dest, "SKILL.md"))) {
        console.log(chalk.green(`  Installed: ${skillName} (from ${fullRepo})`));
        console.log(chalk.green(`\n  1 skill(s) installed to ${opts.global ? "global" : "project"}\n`));
        return;
      }

      await rm(dest, { recursive: true }).catch(() => {});
    } catch {
      await rm(dest, { recursive: true }).catch(() => {});
    }
  }

  console.log(chalk.red(`  Skill '${skillName}' not found in ${fullRepo}`));
  console.log(chalk.dim(`  Check available skills: hub skills add ${fullRepo} --list`));
}

async function listRemoteSkills(owner: string, repo: string): Promise<void> {
  const fullRepo = `${owner}/${repo}`;
  console.log(chalk.cyan(`  Fetching skills from ${fullRepo}...\n`));

  const headers = { Accept: "application/vnd.github.v3+json" };

  try {
    let dirs: { name: string }[] = [];

    const skillsRes = await fetch(
      `https://api.github.com/repos/${fullRepo}/contents/skills`,
      { headers }
    );

    if (skillsRes.ok) {
      const items = (await skillsRes.json()) as { name: string; type: string }[];
      dirs = items.filter((i) => i.type === "dir");
    }

    if (dirs.length === 0) {
      const rootRes = await fetch(
        `https://api.github.com/repos/${fullRepo}/contents`,
        { headers }
      );

      if (rootRes.ok) {
        const items = (await rootRes.json()) as { name: string; type: string }[];
        const candidates = items.filter(
          (i) => i.type === "dir" && !i.name.startsWith(".")
        );

        for (const c of candidates) {
          const checkRes = await fetch(
            `https://api.github.com/repos/${fullRepo}/contents/${c.name}/SKILL.md`,
            { headers }
          );
          if (checkRes.ok) dirs.push({ name: c.name });
        }
      }
    }

    if (dirs.length === 0) {
      const rootSkill = await fetch(
        `https://api.github.com/repos/${fullRepo}/contents/SKILL.md`,
        { headers }
      );
      if (rootSkill.ok) {
        console.log(chalk.green(`  This repo is a single skill.\n`));
        console.log(chalk.dim(`  Install with: hub skills add ${fullRepo}\n`));
        return;
      }
    }

    if (dirs.length === 0) {
      console.log(chalk.dim("  No skills found."));
      return;
    }

    console.log(chalk.green(`  Available skills (${dirs.length}):\n`));
    for (const dir of dirs) {
      console.log(`    ${chalk.yellow(dir.name)}`);
    }
    console.log(chalk.dim(`\n  Install with: hub skills add ${fullRepo}/<skill-name>`));
    console.log(chalk.dim(`  Install all:  hub skills add ${fullRepo}\n`));
  } catch {
    console.log(chalk.red(`  Failed to fetch skill list from ${fullRepo}`));
  }
}

async function addFromLocalPath(
  localPath: string,
  hubDir: string,
  opts: { skill?: string; global?: boolean }
) {
  const absPath = resolve(localPath);

  if (!existsSync(absPath)) {
    console.log(chalk.red(`  Path not found: ${absPath}`));
    return;
  }

  if (!statSync(absPath).isDirectory()) {
    console.log(chalk.red(`  Path is not a directory: ${absPath}`));
    return;
  }

  await installSkillsFromDir(absPath, hubDir, opts);
}

async function addFromGitRepo(
  source: string,
  hubDir: string,
  opts: { skill?: string; global?: boolean }
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
      console.log(chalk.dim("  Make sure the URL is correct and you have access to the repository."));
      return;
    }

    await installSkillsFromDir(tmp, hubDir, opts);
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

function parseGitHubSource(source: string): { owner: string; repo: string; skill?: string } | null {
  const parts = source.split("/");
  if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
  if (parts.length === 3) return { owner: parts[0], repo: parts[1], skill: parts[2] };
  return null;
}

export const skillsCommand = new Command("skills")
  .description("Manage agent skills")
  .addCommand(
    new Command("sync")
      .description("Install all skills declared in the hub config (config.skills + per-repo skills)")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .option("-f, --force", "Re-install even if the skill already exists locally")
      .action(async (opts: { repo?: string; force?: boolean }) => {
        const hubDir = process.cwd();
        let config;
        try {
          config = await loadHubConfig(hubDir);
        } catch {
          console.log(chalk.red("\n  Could not load hub config in the current directory.\n"));
          process.exitCode = 1;
          return;
        }
        const declared = collectConfigSkills(config);
        if (declared.length === 0) {
          console.log(chalk.yellow("\n  No skills declared in config (top-level `skills` or per-repo `skills`).\n"));
          return;
        }
        console.log(chalk.blue(`\n━━━ Syncing ${declared.length} skill(s) from config ━━━\n`));
        const res = await installConfigSkills(config, hubDir, opts);
        console.log();
        const summary = [
          res.installed.length ? `${res.installed.length} installed` : "",
          res.skipped.length ? `${res.skipped.length} already present` : "",
          res.failed.length ? `${res.failed.length} failed` : "",
        ].filter(Boolean).join(", ");
        if (summary) console.log(chalk.green(`  ${summary}`));
        console.log();
        if (res.failed.length > 0) process.exitCode = 1;
        if (res.installed.length > 0) await checkAndAutoRegenerate(hubDir);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Install skills from registry, GitHub, git URL, or local path")
      .argument("<source>", "Skill name, owner/repo, owner/repo/skill, git URL, or local path")
      .option("-s, --skill <name>", "Install a specific skill only (for repo sources)")
      .option("-g, --global", "Install to global ~/.cursor/skills/")
      .option("-r, --repo <repo>", "Registry repository (owner/repo)")
      .option("-l, --list", "List available skills without installing")
      .action(async (source: string, opts: { skill?: string; global?: boolean; repo?: string; list?: boolean }) => {
        const hubDir = process.cwd();

        if (isLocalPath(source)) {
          console.log(chalk.blue(`\nInstalling skills from ${source}\n`));
          await addFromLocalPath(source, hubDir, opts);
          if (!opts.global) await checkAndAutoRegenerate(hubDir);
          return;
        }

        if (source.startsWith("git@") || source.startsWith("https://")) {
          console.log(chalk.blue(`\nInstalling skills from ${source}\n`));
          await addFromGitRepo(source, hubDir, opts);
          if (!opts.global) await checkAndAutoRegenerate(hubDir);
          return;
        }

        const parsed = parseGitHubSource(source);

        if (parsed && opts.list) {
          console.log(chalk.blue(`\nListing skills from ${parsed.owner}/${parsed.repo}\n`));
          await listRemoteSkills(parsed.owner, parsed.repo);
          return;
        }

        if (parsed?.skill) {
          console.log(chalk.blue(`\nInstalling skill ${parsed.skill} from ${parsed.owner}/${parsed.repo}\n`));
          await addFromGitHubSkill(parsed.owner, parsed.repo, parsed.skill, hubDir, opts);
          if (!opts.global) await checkAndAutoRegenerate(hubDir);
          return;
        }

        if (parsed && !parsed.skill) {
          console.log(chalk.blue(`\nInstalling skills from ${source}\n`));
          const url = `https://github.com/${source}.git`;
          await addFromGitRepo(url, hubDir, opts);
          if (!opts.global) await checkAndAutoRegenerate(hubDir);
          return;
        }

        console.log(chalk.blue(`\nInstalling skill ${source} from registry\n`));
        await addFromRegistry(source, hubDir, opts);
        if (!opts.global) await checkAndAutoRegenerate(hubDir);
      })
  )
  .addCommand(
    new Command("find")
      .description("Browse curated skills in the Repo Hub directory")
      .argument("[query]", "Search term")
      .action(async (query?: string) => {
        const base = "https://hub.arvore.com.br/directory?type=skill";
        const url = query
          ? `${base}&q=${encodeURIComponent(query)}`
          : base;

        console.log(chalk.blue("\n  Browse curated skills at:\n"));
        console.log(chalk.cyan(`  ${url}\n`));
        console.log(chalk.dim("  Install with: hub skills add <owner>/<repo>/<skill-name>"));
        console.log(chalk.dim("  Example:      hub skills add vercel-labs/agent-skills/react-best-practices\n"));
      })
  )
  .addCommand(
    new Command("list").description("List installed skills").action(async () => {
      const hubDir = process.cwd();
      console.log(chalk.blue("\nInstalled skills\n"));

      const projectSkills = await listLocalSkills(hubDir);
      if (projectSkills.length > 0) {
        console.log(chalk.cyan("Project:"));
        for (const s of projectSkills) {
          console.log(`  ${chalk.yellow(s.name)} — ${s.description}`);
        }
      } else {
        console.log(chalk.dim("  No project skills (skills/)"));
      }

      const globalDir = join(process.env.HOME || "~", ".cursor", "skills");
      const globalSkills = await listLocalSkills(join(globalDir, ".."));
      console.log();
      if (globalSkills.length > 0) {
        console.log(chalk.cyan("Global:"));
        for (const s of globalSkills) {
          console.log(`  ${chalk.yellow(s.name)} — ${s.description}`);
        }
      } else {
        console.log(chalk.dim("  No global skills (~/.cursor/skills/)"));
      }
      console.log();
    })
  )
  .addCommand(
    new Command("remove")
      .description("Remove a skill")
      .argument("<name>", "Skill name to remove")
      .option("-g, --global", "Remove from global skills")
      .action(async (name: string, opts: { global?: boolean }) => {
        const hubDir = process.cwd();
        const base = opts.global
          ? join(process.env.HOME || "~", ".cursor", "skills")
          : join(hubDir, "skills");

        const target = join(base, name);
        if (!existsSync(target)) {
          console.log(chalk.red(`\nSkill '${name}' not found in ${opts.global ? "global" : "project"}\n`));
          return;
        }

        await rm(target, { recursive: true });
        console.log(chalk.green(`\nRemoved skill: ${name}\n`));

        if (!opts.global) await checkAndAutoRegenerate(hubDir);
      })
  );
