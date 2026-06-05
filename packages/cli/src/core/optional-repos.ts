import { existsSync } from "node:fs";
import { join } from "node:path";
import inquirer from "inquirer";
import chalk from "chalk";
import type { Repo } from "./hub-config.js";

export interface OptionalReposOptions {
  withOptional?: boolean;
  skipOptional?: boolean;
}

export function partitionOptional(repos: Repo[]): {
  required: Repo[];
  optional: Repo[];
} {
  const required: Repo[] = [];
  const optional: Repo[] = [];
  for (const repo of repos) {
    if (repo.optional) {
      optional.push(repo);
    } else {
      required.push(repo);
    }
  }
  return { required, optional };
}

function groupByLabel(repos: Repo[]): Map<string, Repo[]> {
  const groups = new Map<string, Repo[]>();
  for (const repo of repos) {
    const key = repo.group ?? "";
    const list = groups.get(key) ?? [];
    list.push(repo);
    groups.set(key, list);
  }
  return groups;
}

export async function resolveOptionalRepos(
  optional: Repo[],
  hubDir: string,
  opts: OptionalReposOptions = {},
): Promise<Repo[]> {
  const pending = optional.filter(
    (repo) => !existsSync(join(hubDir, repo.path)),
  );
  if (pending.length === 0) return [];
  if (opts.skipOptional) return [];
  if (opts.withOptional) return pending;
  if (!process.stdout.isTTY) return [];

  const selected: Repo[] = [];
  for (const [group, repos] of groupByLabel(pending)) {
    const names = repos.map((repo) => repo.name).join(", ");
    const label = group ? `optional repos for "${group}"` : "optional repos";
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: "confirm",
        name: "confirmed",
        message: `Clone ${label}? (${names})`,
        default: false,
      },
    ]);
    if (confirmed) {
      selected.push(...repos);
    } else {
      console.log(chalk.dim(`  Skipping ${label}`));
    }
  }
  return selected;
}
