import { Command } from "commander";
import { existsSync } from "node:fs";
import { readdir, readFile, cp, mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "yaml";
import chalk from "chalk";
import inquirer from "inquirer";
import { resolveConfigPath, loadHubConfig, type HubConfig } from "../core/hub-config.js";

const EDITOR_DIRS = [".kiro", ".cursor", ".opencode", ".claude"];

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

interface UnsyncedAsset {
  type: "skill" | "agent" | "steering" | "mcp";
  name: string;
  source: string;
}

async function findUnsyncedAssets(hubDir: string): Promise<UnsyncedAsset[]> {
  const unsynced: UnsyncedAsset[] = [];
  const seen = new Set<string>();

  for (const editor of EDITOR_DIRS) {
    const editorSkillsDir = join(hubDir, editor, "skills");
    if (!existsSync(editorSkillsDir)) continue;

    try {
      const folders = await readdir(editorSkillsDir);
      for (const folder of folders) {
        if (folder === "hub-docs") continue; // auto-generated, skip
        const skillFile = join(editorSkillsDir, folder, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        const canonicalSkillFile = join(hubDir, "skills", folder, "SKILL.md");
        if (existsSync(canonicalSkillFile)) continue;

        const key = `skill:${folder}`;
        if (seen.has(key)) continue;
        seen.add(key);

        unsynced.push({ type: "skill", name: folder, source: editor });
      }
    } catch {
      // skip
    }
  }

  for (const editor of EDITOR_DIRS) {
    const editorAgentsDir = join(hubDir, editor, "agents");
    if (!existsSync(editorAgentsDir)) continue;

    try {
      const files = await readdir(editorAgentsDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const canonicalFile = join(hubDir, "agents", file);
        if (existsSync(canonicalFile)) continue;

        const key = `agent:${file}`;
        if (seen.has(key)) continue;
        seen.add(key);

        unsynced.push({ type: "agent", name: file, source: editor });
      }
    } catch {
      // skip
    }
  }

  // Detect steering from .kiro/steering/
  const steeringDir = join(hubDir, ".kiro", "steering");
  if (existsSync(steeringDir)) {
    const canonicalSteeringDir = join(hubDir, "steering");
    try {
      const files = await readdir(steeringDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (file === "orchestrator.md") continue; // auto-generated
        const canonicalFile = join(canonicalSteeringDir, file);
        if (existsSync(canonicalFile)) continue;

        const key = `steering:${file}`;
        if (seen.has(key)) continue;
        seen.add(key);

        unsynced.push({ type: "steering", name: file, source: ".kiro" });
      }
    } catch {
      // skip
    }
  }

  const cursorRulesDir = join(hubDir, ".cursor", "rules");
  if (existsSync(cursorRulesDir)) {
    const canonicalSteeringDir = join(hubDir, "steering");
    try {
      const files = await readdir(cursorRulesDir);
      for (const file of files) {
        if (!file.endsWith(".mdc")) continue;
        if (file === "orchestrator.mdc") continue; // auto-generated
        const mdName = file.replace(/\.mdc$/, ".md");
        const canonicalFile = join(canonicalSteeringDir, mdName);
        if (existsSync(canonicalFile)) continue;

        const key = `steering:${mdName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        unsynced.push({ type: "steering", name: mdName, source: ".cursor" });
      }
    } catch {
      // skip
    }
  }

  const opencodeRulesDir = join(hubDir, ".opencode", "rules");
  if (existsSync(opencodeRulesDir)) {
    const canonicalSteeringDir = join(hubDir, "steering");
    try {
      const files = await readdir(opencodeRulesDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (file === "orchestrator.md") continue; // auto-generated
        const canonicalFile = join(canonicalSteeringDir, file);
        if (existsSync(canonicalFile)) continue;

        const key = `steering:${file}`;
        if (seen.has(key)) continue;
        seen.add(key);

        unsynced.push({ type: "steering", name: file, source: ".opencode" });
      }
    } catch {
      // skip
    }
  }

  const hubYamlPath = join(hubDir, "hub.yaml");
  if (existsSync(hubYamlPath)) {
    const hubContent = await readFile(hubYamlPath, "utf-8");
    const hubConfig = parse(hubContent) as HubConfig;
    const hubMcpNames = new Set((hubConfig.mcps || []).map((m) => m.name));

    const mcpConfigPaths: { path: string; source: string; key: string }[] = [
      { path: join(hubDir, ".cursor", "mcp.json"), source: ".cursor", key: "mcpServers" },
      { path: join(hubDir, ".kiro", "settings", "mcp.json"), source: ".kiro", key: "mcpServers" },
      { path: join(hubDir, ".mcp.json"), source: ".mcp.json", key: "mcpServers" },
      { path: join(hubDir, "opencode.json"), source: "opencode.json", key: "mcp" },
    ];

    for (const { path: mcpPath, source, key } of mcpConfigPaths) {
      if (!existsSync(mcpPath)) continue;
      try {
        const content = JSON.parse(await readFile(mcpPath, "utf-8"));
        const servers = content[key] as Record<string, unknown> | undefined;
        if (!servers) continue;

        for (const serverName of Object.keys(servers)) {
          if (hubMcpNames.has(serverName)) continue;

          const mcpKey = `mcp:${serverName}`;
          if (seen.has(mcpKey)) continue;
          seen.add(mcpKey);

          unsynced.push({ type: "mcp", name: serverName, source });
        }
      } catch {
        // skip
      }
    }
  }

  return unsynced;
}

function stripFrontMatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n*/);
  if (match) return content.slice(match[0].length);
  return content;
}

async function syncAssets(hubDir: string, assets: UnsyncedAsset[]): Promise<void> {
  for (const asset of assets) {
    if (asset.type === "mcp") {
      console.log(chalk.yellow(`  MCP '${asset.name}' found in ${asset.source} but not in hub.yaml — add it manually.`));
      continue;
    }
    if (asset.type === "skill") {
      const src = join(hubDir, asset.source, "skills", asset.name);
      const dest = join(hubDir, "skills", asset.name);
      await mkdir(join(hubDir, "skills"), { recursive: true });
      await cp(src, dest, { recursive: true });
      const skillMd = join(dest, "SKILL.md");
      if (existsSync(skillMd)) {
        const raw = await readFile(skillMd, "utf-8");
        const cleaned = stripFrontMatter(raw);
        if (cleaned !== raw) {
          await writeFile(skillMd, cleaned, "utf-8");
        }
      }
      console.log(chalk.green(`  Synced skill: ${asset.name} (from ${asset.source})`));
    } else if (asset.type === "agent") {
      const src = join(hubDir, asset.source, "agents", asset.name);
      const dest = join(hubDir, "agents", asset.name);
      await mkdir(join(hubDir, "agents"), { recursive: true });
      const raw = await readFile(src, "utf-8");
      const cleaned = stripFrontMatter(raw);
      await writeFile(dest, cleaned, "utf-8");
      console.log(chalk.green(`  Synced agent: ${asset.name} (from ${asset.source})`));
    } else if (asset.type === "steering") {
      const dest = join(hubDir, "steering", asset.name);
      await mkdir(join(hubDir, "steering"), { recursive: true });
      let raw: string;
      if (asset.source === ".cursor") {
        const mdcName = asset.name.replace(/\.md$/, ".mdc");
        raw = await readFile(join(hubDir, ".cursor", "rules", mdcName), "utf-8");
      } else if (asset.source === ".opencode") {
        raw = await readFile(join(hubDir, ".opencode", "rules", asset.name), "utf-8");
      } else {
        raw = await readFile(join(hubDir, asset.source, "steering", asset.name), "utf-8");
      }
      const cleaned = stripFrontMatter(raw);
      await writeFile(dest, cleaned, "utf-8");
      console.log(chalk.green(`  Synced steering: ${asset.name} (from ${asset.source})`));
    }
  }
}

export const scanCommand = new Command("scan")
  .description("Detect git repositories not registered in hub config")
  .option("-y, --yes", "Auto-add all found repos without prompting")
  .option("--check", "Check for unsynced assets without prompting (exit code 1 if found)")
  .action(async (opts: { yes?: boolean; check?: boolean }) => {
    const hubDir = process.cwd();
    const { path: configPath, format } = resolveConfigPath(hubDir);

    if (!existsSync(configPath)) {
      const configFile = format === "typescript" ? "hub.config.ts" : "hub.yaml";
      console.log(chalk.red(`No ${configFile} found in current directory.`));
      process.exit(1);
    }

    const config = await loadHubConfig(hubDir);

    if (opts.check) {
      const unregistered = await findUnregisteredRepos(hubDir, config);
      const unsyncedAssets = await findUnsyncedAssets(hubDir);
      const total = unregistered.length + unsyncedAssets.length;
      if (total > 0) {
        if (unregistered.length > 0) {
          console.log(chalk.yellow(`Found ${unregistered.length} unregistered repo(s): ${unregistered.join(", ")}`));
        }
        if (unsyncedAssets.length > 0) {
          console.log(chalk.yellow(`Found ${unsyncedAssets.length} unsynced asset(s): ${unsyncedAssets.map((a) => a.name).join(", ")}`));
        }
        console.log(chalk.yellow("Run 'hub scan' to sync."));
        process.exit(1);
      }
      console.log(chalk.green("All repos and assets are synced."));
      return;
    }

    let hasChanges = false;

    console.log(chalk.blue("\nScanning for unregistered repositories...\n"));

    const unregistered = await findUnregisteredRepos(hubDir, config);

    if (unregistered.length === 0) {
      console.log(chalk.green("All repositories are registered in hub config."));
    } else {
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

      if (format === "typescript") {
        console.log(chalk.yellow("  Auto-adding repos is not supported with hub.config.ts — edit the file directly."));
        console.log(chalk.dim("  Suggested entries:\n"));
        for (const r of repoDetails) {
          const helper = r.tech ? `repo.${r.tech}` : "repo.custom";
          console.log(chalk.dim(`    ${helper}("${r.name}", "${r.url}"),`));
        }
        console.log();
      } else {
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

        if (toAdd.length > 0) {
          const originalContent = await readFile(configPath, "utf-8");
          const insertAt = findReposInsertionPoint(originalContent);
          const before = originalContent.slice(0, insertAt);
          const after = originalContent.slice(insertAt);

          const newEntries = toAdd.map(buildRepoYaml).join("\n");
          const updatedContent = before + newEntries + "\n" + after;

          await import("node:fs/promises").then((fs) => fs.writeFile(configPath, updatedContent, "utf-8"));
          console.log(chalk.green(`Added ${toAdd.length} repo(s) to hub.yaml.`));
          hasChanges = true;
        }
      }
    }

    console.log(chalk.blue("\nScanning for unsynced skills, agents, steering, and MCPs...\n"));

    const unsyncedAssets = await findUnsyncedAssets(hubDir);

    if (unsyncedAssets.length === 0) {
      console.log(chalk.green("All assets are synced."));
    } else {
      console.log(chalk.yellow(`Found ${unsyncedAssets.length} unsynced asset(s):\n`));

      for (const asset of unsyncedAssets) {
        console.log(`  ${chalk.cyan(asset.name)} ${chalk.dim(`(${asset.type} from ${asset.source})`)}`);
      }
      console.log();

      let toSync = unsyncedAssets;

      if (!opts.yes) {
        const { selected } = await inquirer.prompt<{ selected: string[] }>([
          {
            type: "checkbox",
            name: "selected",
            message: "Select assets to sync to canonical folders:",
            choices: unsyncedAssets.map((a) => ({
              name: `${a.name} (${a.type} from ${a.source})`,
              value: `${a.type}:${a.name}`,
              checked: true,
            })),
          },
        ]);
        toSync = unsyncedAssets.filter((a) => selected.includes(`${a.type}:${a.name}`));
      }

      if (toSync.length > 0) {
        await syncAssets(hubDir, toSync);
        console.log(chalk.green(`Synced ${toSync.length} asset(s).`));
        hasChanges = true;
      }
    }

    if (hasChanges) {
      console.log(chalk.cyan(`\nRun ${chalk.bold("hub generate")} to update editor configs.\n`));
    } else {
      console.log();
    }
  });
