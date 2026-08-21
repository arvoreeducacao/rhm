import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir, copyFile, readFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadHubConfig, type HubConfig } from "../core/hub-config.js";
import { getSavedEditor, saveGenerateState, getKiroMode, saveKiroMode, readCache, writeCache, checkOutdated, type KiroMode } from "../core/hub-cache.js";
import { fetchRemoteSources } from "../core/design-sources.js";
import { loadPersona } from "./persona.js";
import { applyPlannedFiles, readSteeringInputs, writeManagedFile } from "../core/plan-apply.js";
import { generateEnvExample } from "./env-example.js";
import {
  buildGitignoreLines,
  planClaudeCodeFiles,
  HUB_PI_PACKAGE,
  planCodexFiles,
  planCursorFiles,
  planKiroFiles,
  planOpenCodeFiles,
  planPiFiles,
  type KiroSteeringInput,
  resolvePiConfig,
} from "@arvoretech/hub-core";

const HUB_DOCS_URL = "https://hub.arvore.com.br/llms-full.txt";

async function syncRemoteSources(config: HubConfig, hubDir: string, skillsDir: string, steeringDir: string): Promise<void> {
  if (!config.remote_sources?.length) return;
  console.log(chalk.blue("  Syncing remote sources..."));
  const result = await fetchRemoteSources(config.remote_sources, hubDir, skillsDir, steeringDir);
  if (result.skills > 0 || result.steering > 0) {
    console.log(chalk.green(`  Synced ${result.skills} skill(s) and ${result.steering} steering file(s) from remote sources`));
  }
  if (result.errors.length > 0) {
    console.log(chalk.yellow(`  ${result.errors.length} remote source(s) failed`));
  }
}

function getRemoteSkillNames(config: HubConfig): Set<string> {
  const names = new Set<string>();
  for (const source of config.remote_sources ?? []) {
    if (source.type === "skill") names.add(source.name);
  }
  return names;
}

async function fetchHubDocsSkill(skillsDir: string): Promise<void> {
  try {
    const res = await fetch(HUB_DOCS_URL);
    if (!res.ok) {
      console.log(chalk.yellow(`  Could not fetch hub docs (${res.status}), skipping hub-docs skill`));
      return;
    }
    const content = await res.text();
    const hubSkillDir = join(skillsDir, "hub-docs");
    await mkdir(hubSkillDir, { recursive: true });
    const skillContent = `---
name: hub-docs
description: Repo Hub (rhm) documentation. Use when working with hub.yaml, hub CLI commands, agent orchestration, MCP configuration, skills, workflows, or multi-repo workspace setup.
triggers: [hub, rhm, hub.yaml, generate, scan, setup, orchestrator, multi-repo, workspace]
---

${content}`;
    await writeFile(join(hubSkillDir, "SKILL.md"), skillContent, "utf-8");
    console.log(chalk.green("  Fetched hub-docs skill from hub.arvore.com.br"));
  } catch {
    console.log(chalk.yellow(`  Could not fetch hub docs, skipping hub-docs skill`));
  }
}


async function generateEditorCommands(config: HubConfig, hubDir: string, targetDir: string, editorName: string) {
  const commandsDir = join(targetDir, "commands");
  let count = 0;

  if (config.commands_dir) {
    const srcDir = resolve(hubDir, config.commands_dir);
    try {
      const files = await readdir(srcDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));
      if (mdFiles.length > 0) {
        await mkdir(commandsDir, { recursive: true });
        for (const file of mdFiles) {
          await copyFile(join(srcDir, file), join(commandsDir, file));
          count++;
        }
      }
    } catch {
      console.log(chalk.yellow(`  Commands directory ${config.commands_dir} not found, skipping`));
    }
  }

  if (config.commands) {
    await mkdir(commandsDir, { recursive: true });
    for (const [name, filePath] of Object.entries(config.commands)) {
      const src = resolve(hubDir, filePath);
      const dest = join(commandsDir, name.endsWith(".md") ? name : `${name}.md`);
      try {
        await copyFile(src, dest);
        count++;
      } catch {
        console.log(chalk.yellow(`  Command file ${filePath} not found, skipping`));
      }
    }
  }

  if (count > 0) {
    console.log(chalk.green(`  Copied ${count} commands to ${editorName}`));
  }
}

interface Generator {
  name: string;
  generate: (config: HubConfig, hubDir: string) => Promise<void>;
}

async function generateCursor(config: HubConfig, hubDir: string) {
  const cursorDir = join(hubDir, ".cursor");
  await mkdir(join(cursorDir, "rules"), { recursive: true });

  const personaCursor = await loadPersona(hubDir);
  const steering = await readSteeringInputs(hubDir);

  const plan = planCursorFiles(config, { steering, persona: personaCursor });
  await applyPlannedFiles(hubDir, plan.files);

  if (personaCursor) {
    console.log(chalk.green(`  Applied persona: ${personaCursor.name} (${personaCursor.role})`));
  }
  if (steering.length > 0) {
    console.log(chalk.green(`  Copied ${steering.length} steering files to .cursor/rules/`));
  }

  const skillsDir = resolve(hubDir, "skills");
  const remoteSkillsCursor = getRemoteSkillNames(config);
  try {
    const skillFolders = await readdir(skillsDir);
    const cursorSkillsDir = join(cursorDir, "skills");
    await mkdir(cursorSkillsDir, { recursive: true });
    let count = 0;
    for (const folder of skillFolders) {
      if (remoteSkillsCursor.has(folder)) continue;
      const skillFile = join(skillsDir, folder, "SKILL.md");
      try {
        await readFile(skillFile);
        await cp(join(skillsDir, folder), join(cursorSkillsDir, folder), { recursive: true });
        count++;
      } catch {
        // skip
      }
    }
    if (count > 0) {
      console.log(chalk.green(`  Copied ${count} skills`));
    }
  } catch {
    // no skills dir
  }

  const cursorSkillsDirForDocs = join(cursorDir, "skills");
  await mkdir(cursorSkillsDirForDocs, { recursive: true });
  await fetchHubDocsSkill(cursorSkillsDirForDocs);

  await syncRemoteSources(config, hubDir, join(cursorDir, "skills"), join(cursorDir, "rules"));

  await generateEditorCommands(config, hubDir, cursorDir, ".cursor/commands/");
  await generateVSCodeSettings(config, hubDir);
}


async function generateOpenCode(config: HubConfig, hubDir: string) {
  const opencodeDir = join(hubDir, ".opencode");
  await mkdir(join(opencodeDir, "agents"), { recursive: true });
  await mkdir(join(opencodeDir, "rules"), { recursive: true });
  await mkdir(join(opencodeDir, "skills"), { recursive: true });
  await mkdir(join(opencodeDir, "commands"), { recursive: true });
  await mkdir(join(opencodeDir, "plugins"), { recursive: true });

  const personaOC = await loadPersona(hubDir);
  const steering = await readSteeringInputs(hubDir);

  const plan = planOpenCodeFiles(config, { steering, persona: personaOC });
  await applyPlannedFiles(hubDir, plan.files);
  await rm(join(opencodeDir, "rules", "orchestrator.md")).catch(() => {});

  if (personaOC) {
    console.log(chalk.green(`  Applied persona: ${personaOC.name} (${personaOC.role})`));
  }
  if (steering.length > 0) {
    console.log(chalk.green(`  Copied ${steering.length} steering files to .opencode/rules/`));
  }

  const skillsDir = resolve(hubDir, "skills");
  const remoteSkillsOC = getRemoteSkillNames(config);
  try {
    const skillFolders = await readdir(skillsDir);
    let count = 0;
    for (const folder of skillFolders) {
      if (remoteSkillsOC.has(folder)) continue;
      const skillFile = join(skillsDir, folder, "SKILL.md");
      try {
        await readFile(skillFile);
        await cp(join(skillsDir, folder), join(opencodeDir, "skills", folder), { recursive: true });
        count++;
      } catch {
        // skip
      }
    }
    if (count > 0) {
      console.log(chalk.green(`  Copied ${count} skills to .opencode/skills/`));
    }
  } catch {
    // no skills dir
  }

  await fetchHubDocsSkill(join(opencodeDir, "skills"));

  await syncRemoteSources(config, hubDir, join(opencodeDir, "skills"), join(opencodeDir, "rules"));

  await generateEditorCommands(config, hubDir, opencodeDir, ".opencode/commands/");

  await generateVSCodeSettings(config, hubDir);
}



async function generateClaudeCode(config: HubConfig, hubDir: string) {
  const claudeDir = join(hubDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const personaClaude = await loadPersona(hubDir);

  const skillsDir = resolve(hubDir, "skills");
  const remoteSkillsClaude = getRemoteSkillNames(config);
  try {
    const skillFolders = await readdir(skillsDir);
    const claudeSkillsDir = join(claudeDir, "skills");
    await mkdir(claudeSkillsDir, { recursive: true });
    let count = 0;

    for (const folder of skillFolders) {
      if (remoteSkillsClaude.has(folder)) continue;
      const skillFile = join(skillsDir, folder, "SKILL.md");
      try {
        await readFile(skillFile);
        const srcDir = join(skillsDir, folder);
        const targetDir = join(claudeSkillsDir, folder);
        await cp(srcDir, targetDir, { recursive: true });
        count++;
      } catch {
        // skip
      }
    }

    if (count > 0) {
      console.log(chalk.green(`  Copied ${count} skills to .claude/skills/`));
    }
  } catch {
    // no skills dir
  }

  const claudeSkillsDirForDocs = join(claudeDir, "skills");
  await mkdir(claudeSkillsDirForDocs, { recursive: true });
  await fetchHubDocsSkill(claudeSkillsDirForDocs);

  await syncRemoteSources(config, hubDir, join(claudeDir, "skills"), join(claudeDir, "steering"));

  const steering = await readSteeringInputs(hubDir);

  const plan = planClaudeCodeFiles(config, { steering, persona: personaClaude });
  await applyPlannedFiles(hubDir, plan.files);

  if (personaClaude) {
    console.log(chalk.green(`  Applied persona: ${personaClaude.name} (${personaClaude.role}) — CLAUDE.local.md is per-machine, gitignored`));
  }
  if (steering.length > 0) {
    console.log(chalk.green(`  Appended ${steering.length} steering files to CLAUDE.md`));
  }
}

async function generateCodex(config: HubConfig, hubDir: string) {
  const codexDir = join(hubDir, ".codex");
  await mkdir(codexDir, { recursive: true });

  const personaCodex = await loadPersona(hubDir);

  const skillsDir = resolve(hubDir, "skills");
  const remoteSkillsCodex = getRemoteSkillNames(config);
  try {
    const skillFolders = await readdir(skillsDir);
    const codexSkillsDir = join(codexDir, "skills");
    await mkdir(codexSkillsDir, { recursive: true });
    let count = 0;
    for (const folder of skillFolders) {
      if (remoteSkillsCodex.has(folder)) continue;
      const skillFile = join(skillsDir, folder, "SKILL.md");
      try {
        await readFile(skillFile);
        await cp(join(skillsDir, folder), join(codexSkillsDir, folder), { recursive: true });
        count++;
      } catch {
        // skip
      }
    }
    if (count > 0) {
      console.log(chalk.green(`  Copied ${count} skills to .codex/skills/`));
    }
  } catch {
    // no skills dir
  }

  const codexSkillsDirForDocs = join(codexDir, "skills");
  await mkdir(codexSkillsDirForDocs, { recursive: true });
  await fetchHubDocsSkill(codexSkillsDirForDocs);
  await syncRemoteSources(config, hubDir, join(codexDir, "skills"), join(codexDir, "steering"));

  const plan = planCodexFiles(config);
  for (const warning of plan.warnings) {
    console.log(chalk.yellow(`  ${warning}`));
  }
  await applyPlannedFiles(hubDir, plan.files);

  if (personaCodex) {
    console.log(chalk.green(`  Applied persona: ${personaCodex.name} (${personaCodex.role})`));
  }
}


async function generateKiro(config: HubConfig, hubDir: string) {
  const kiroDir = join(hubDir, ".kiro");
  const steeringDir = join(kiroDir, "steering");
  const settingsDir = join(kiroDir, "settings");
  await mkdir(steeringDir, { recursive: true });
  await mkdir(settingsDir, { recursive: true });

  let mode = await getKiroMode(hubDir);
  if (!mode) {
    const { kiroMode } = await inquirer.prompt<{ kiroMode: KiroMode }>([
      {
        type: "list",
        name: "kiroMode",
        message: "How do you use Kiro?",
        choices: [
          { name: "Editor / IDE (e.g. Kiro IDE, VS Code)", value: "editor" },
          { name: "CLI (e.g. kiro-cli)", value: "cli" },
        ],
      },
    ]);
    mode = kiroMode;
    await saveKiroMode(hubDir, mode);
    console.log(chalk.dim(`  Saved Kiro mode: ${mode}`));
  } else {
    console.log(chalk.dim(`  Using saved Kiro mode: ${mode}`));
  }

  const personaKiro = await loadPersona(hubDir);
  await rm(join(steeringDir, "orchestrator.md")).catch(() => {});

  const steering: KiroSteeringInput[] = [];
  for (const input of await readSteeringInputs(hubDir)) {
    const destPath = join(steeringDir, input.name);
    let existingContent: string | null = null;
    if (existsSync(destPath)) {
      existingContent = await readFile(destPath, "utf-8");
    }
    steering.push({ ...input, existingContent });
  }

  const mcpJsonPath = join(settingsDir, "mcp.json");
  const existingMcpJson = existsSync(mcpJsonPath) ? await readFile(mcpJsonPath, "utf-8") : null;

  const plan = planKiroFiles(config, { steering, persona: personaKiro, mode, existingMcpJson });
  await applyPlannedFiles(hubDir, plan.files);

  if (personaKiro) {
    console.log(chalk.green(`  Applied persona: ${personaKiro.name} (${personaKiro.role})`));
  }
  if (steering.length > 0) {
    console.log(chalk.green(`  Copied ${steering.length} steering files to .kiro/steering/`));
  }

  const skillsDir = resolve(hubDir, "skills");
  const remoteSkillsKiro = getRemoteSkillNames(config);
  try {
    const skillFolders = await readdir(skillsDir);
    const kiroSkillsDir = join(kiroDir, "skills");
    await mkdir(kiroSkillsDir, { recursive: true });
    let count = 0;

    for (const folder of skillFolders) {
      if (remoteSkillsKiro.has(folder)) continue;
      const skillFile = join(skillsDir, folder, "SKILL.md");
      try {
        await readFile(skillFile);
        await cp(join(skillsDir, folder), join(kiroSkillsDir, folder), { recursive: true });
        count++;
      } catch {
        // skip
      }
    }

    if (count > 0) {
      console.log(chalk.green(`  Copied ${count} skills to .kiro/skills/`));
    }
  } catch {
    // no skills dir
  }

  const kiroSkillsDirForDocs = join(kiroDir, "skills");
  await mkdir(kiroSkillsDirForDocs, { recursive: true });
  await fetchHubDocsSkill(kiroSkillsDirForDocs);

  await syncRemoteSources(config, hubDir, join(kiroDir, "skills"), steeringDir);

  const hookNotes = plan.notes ?? [];
  if (hookNotes.length > 0) {
    console.log(chalk.yellow(`  Note: Kiro hooks are managed via the Kiro panel UI.`));
    console.log(chalk.yellow(`  The following hooks should be configured manually:`));
    for (const note of hookNotes) {
      console.log(chalk.yellow(`    ${note}`));
    }
  }

  await generateVSCodeSettings(config, hubDir);
}


async function generateVSCodeSettings(config: HubConfig, hubDir: string) {
  const vscodeDir = join(hubDir, ".vscode");
  await mkdir(vscodeDir, { recursive: true });

  const settingsPath = join(vscodeDir, "settings.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      existing = {};
    }
  }

  const managed: Record<string, unknown> = {
    "git.autoRepositoryDetection": true,
    "git.detectSubmodules": true,
    "git.detectSubmodulesLimit": Math.max(config.repos.length * 2, 20),
  };

  const merged = { ...existing, ...managed };
  await writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(chalk.green("  Generated .vscode/settings.json (git multi-repo detection)"));

  const workspaceFile = `${config.name}.code-workspace`;
  const workspacePath = join(hubDir, workspaceFile);

  let existingWorkspace: Record<string, unknown> = {};
  if (existsSync(workspacePath)) {
    try {
      const raw = await readFile(workspacePath, "utf-8");
      existingWorkspace = JSON.parse(raw);
    } catch {
      existingWorkspace = {};
    }
  } else {
    const files = await readdir(hubDir);
    const existing = files.find((f) => f.endsWith(".code-workspace"));
    if (existing) {
      try {
        const raw = await readFile(join(hubDir, existing), "utf-8");
        existingWorkspace = JSON.parse(raw);
      } catch {
        existingWorkspace = {};
      }
    }
  }

  const TECH_LABELS: Record<string, string> = {
    nestjs: "NestJS", nextjs: "Next.js", react: "React",
    elixir: "Elixir", phoenix: "Phoenix", django: "Django",
    fastapi: "FastAPI", rails: "Rails", spring: "Spring",
    go: "Go", vue: "Vue", svelte: "Svelte", angular: "Angular",
    express: "Express", koa: "Koa",
  };

  const folders: { path: string; name: string }[] = [
    { path: ".", name: "Root" },
  ];
  for (const repo of config.repos) {
    const repoPath = repo.path.replace(/^\.\//, "");
    const displayName = repo.display_name
      || (repo.tech ? `${repo.name} (${TECH_LABELS[repo.tech] || repo.tech})` : repo.name);
    folders.push({ path: repoPath, name: displayName });
  }

  const workspace = {
    folders,
    settings: (existingWorkspace as Record<string, unknown>).settings || {},
  };

  await writeFile(workspacePath, JSON.stringify(workspace, null, "\t") + "\n", "utf-8");
  console.log(chalk.green(`  Generated ${workspaceFile}`));
}



async function generatePi(config: HubConfig, hubDir: string) {
  const piDir = join(hubDir, ".pi");
  await mkdir(piDir, { recursive: true });
  const settingsPath = join(piDir, "settings.json");

  let existingSettings: Record<string, unknown> | null = null;
  if (existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      const gitignoreLines = buildGitignoreLines(config);
      await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
      console.log(chalk.green("  Generated .gitignore"));
      console.log(chalk.yellow("  Existing .pi/settings.json is invalid JSON — leaving it untouched."));
      console.log(chalk.dim(`  Add "${HUB_PI_PACKAGE}" to its "packages" array manually once the JSON is fixed.`));
      return;
    }
  }

  const steering = await readSteeringInputs(hubDir);
  const plan = planPiFiles(config, { steering, existingSettings });
  await applyPlannedFiles(hubDir, plan.files);

  const previousPackages = Array.isArray(existingSettings?.packages) ? (existingSettings.packages as string[]) : [];
  if (previousPackages.includes(HUB_PI_PACKAGE)) {
    console.log(chalk.dim("  hub-pi already registered in .pi/settings.json"));
  } else {
    console.log(chalk.green(`  Registered ${HUB_PI_PACKAGE} in .pi/settings.json`));
  }

  const piToggles = resolvePiConfig(config);
  if (!piToggles.injectCapabilities) {
    console.log(chalk.dim("\n  pi.injectCapabilities is disabled — skipping AGENTS.md generation."));
    console.log(chalk.dim("  The hub-pi extension still wires MCPs, repo tools, persona, hooks, and skills at runtime."));
    return;
  }

  if (steering.length > 0) {
    console.log(chalk.green(`  Appended ${steering.length} steering files to AGENTS.md`));
  }

  console.log(chalk.dim("\n  Pi reads AGENTS.md natively at startup; MCP wiring, repo tools, persona, and hooks are added by the hub-pi extension at runtime."));
}


export const generators: Record<string, Generator> = {
  pi: { name: "Pi", generate: generatePi },
  cursor: { name: "Cursor", generate: generateCursor },
  "claude-code": { name: "Claude Code", generate: generateClaudeCode },
  kiro: { name: "Kiro", generate: generateKiro },
  opencode: { name: "OpenCode", generate: generateOpenCode },
  codex: { name: "Codex", generate: generateCodex },
};

async function resolveEditor(opts: { editor?: string; resetEditor?: boolean }): Promise<string> {
  const hubDir = process.cwd();

  if (opts.resetEditor) {
    const { editor } = await inquirer.prompt<{ editor: string }>([
      {
        type: "list",
        name: "editor",
        message: "Which editor do you use?",
        choices: Object.entries(generators).map(([key, gen]) => ({
          name: gen.name,
          value: key,
        })),
      },
    ]);
    const cache = await readCache(hubDir);
    delete cache.kiroMode;
    await writeCache(hubDir, cache);
    return editor;
  }

  if (opts.editor) return opts.editor;

  const saved = await getSavedEditor(hubDir);
  if (saved) return saved;

  const { editor } = await inquirer.prompt<{ editor: string }>([
    {
      type: "list",
      name: "editor",
      message: "No editor preference saved. Which editor do you use?",
      choices: Object.entries(generators).map(([key, gen]) => ({
        name: gen.name,
        value: key,
      })),
    },
  ]);
  return editor;
}

export const generateCommand = new Command("generate")
  .description("Generate editor-specific configuration files from hub.yaml")
  .option("-e, --editor <editor>", "Target editor (pi, cursor, claude-code, kiro, opencode, codex)")
  .option("--reset-editor", "Reset saved editor preference and choose again")
  .option("--check", "Check if generated configs are outdated (exit code 1 if outdated)")
  .action(async (opts: { editor?: string; resetEditor?: boolean; check?: boolean }) => {
    const hubDir = process.cwd();

    if (opts.check) {
      const result = await checkOutdated(hubDir);
      if (result.reason === "no-previous-generate") {
        console.log(chalk.yellow("No previous generate found. Run 'hub generate' first."));
        process.exit(1);
      }
      if (result.outdated) {
        console.log(chalk.yellow("Generated configs are outdated. Run 'hub generate' to update."));
        process.exit(1);
      }
      console.log(chalk.green("Generated configs are up to date."));
      return;
    }

    const config = await loadHubConfig(hubDir);

    if (config.memory) {
      const hasMemoryMcp = config.mcps?.some(
        (m) => m.name === "team-memory" || m.package === "@arvoretech/memory-mcp"
      );
      if (!hasMemoryMcp) {
        console.log(chalk.red(`\n  Error: 'memory' is configured but no memory MCP is declared in 'mcps'.\n`));
        console.log(chalk.yellow(`  Add this to your hub.yaml:\n`));
        console.log(chalk.dim(`  mcps:`));
        console.log(chalk.dim(`    - name: team-memory`));
        console.log(chalk.dim(`      package: "@arvoretech/memory-mcp"`));
        console.log(chalk.dim(`      env:`));
        console.log(chalk.dim(`        MEMORY_PATH: ${config.memory.path || "./memories"}\n`));
        process.exit(1);
      }
    }

    if (config.remote_sources?.length) {
      const hasNotionSources = config.remote_sources.some((s) => s.notion_page);
      if (hasNotionSources && !process.env.NOTION_API_KEY && !process.env.NOTION_TOKEN) {
        console.log(chalk.yellow(`\n  Warning: remote_sources include Notion pages but NOTION_API_KEY is not set.`));
        console.log(chalk.yellow(`  Notion sources will be skipped. Set NOTION_API_KEY in your .env or environment.\n`));
      }
    }

    const editorKey = await resolveEditor(opts);
    const generator = generators[editorKey];
    if (!generator) {
      console.log(
        chalk.red(`Unknown editor: ${editorKey}. Available: ${Object.keys(generators).join(", ")}`)
      );
      return;
    }

    if (opts.editor || opts.resetEditor) {
      console.log(chalk.dim(`  Saving editor preference: ${generator.name}`));
    }

    console.log(chalk.blue(`\nGenerating ${generator.name} configuration\n`));
    await generator.generate(config, hubDir);
    await generateEnvExample(config, hubDir);
    await saveGenerateState(hubDir, editorKey);
    console.log(chalk.green("\nDone!\n"));
  });
