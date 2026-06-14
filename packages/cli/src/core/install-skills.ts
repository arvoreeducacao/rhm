import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { HubConfig } from "./hub-config.js";
import { downloadDirFromGitHub } from "../commands/registry.js";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";

export function collectConfigSkills(config: HubConfig): string[] {
  const names = new Set<string>();
  for (const name of config.skills ?? []) names.add(name);
  for (const repo of config.repos ?? []) {
    for (const name of repo.skills ?? []) names.add(name);
  }
  return [...names];
}

const SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && !name.includes("..");
}

export interface InstallSkillsResult {
  installed: string[];
  skipped: string[];
  failed: string[];
}

export async function installConfigSkills(
  config: HubConfig,
  hubDir: string,
  opts: { repo?: string; force?: boolean } = {},
): Promise<InstallSkillsResult> {
  const repo = opts.repo || DEFAULT_REGISTRY_REPO;
  const skillsDir = join(hubDir, "skills");
  const result: InstallSkillsResult = { installed: [], skipped: [], failed: [] };

  for (const name of collectConfigSkills(config)) {
    if (!isValidSkillName(name)) {
      result.failed.push(name);
      console.log(chalk.red(`  ✗ ${name} (invalid skill name — must match [a-zA-Z0-9._-] and not contain '..')`));
      continue;
    }
    const dest = join(skillsDir, name);

    if (!opts.force && existsSync(join(dest, "SKILL.md"))) {
      result.skipped.push(name);
      console.log(chalk.dim(`  ✓ ${name} (already present)`));
      continue;
    }

    try {
      await downloadDirFromGitHub(repo, `skills/${name}`, dest);
      if (!existsSync(join(dest, "SKILL.md"))) {
        await rm(dest, { recursive: true }).catch(() => {});
        result.failed.push(name);
        console.log(chalk.red(`  ✗ ${name} (not found in registry ${repo})`));
        continue;
      }
      result.installed.push(name);
      console.log(chalk.green(`  ✓ ${name} (installed)`));
    } catch (err) {
      result.failed.push(name);
      console.log(chalk.red(`  ✗ ${name}: ${(err as Error).message}`));
    }
  }

  return result;
}
