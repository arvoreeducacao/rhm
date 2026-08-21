import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir, copyFile, readFile, cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadHubConfig, type HubConfig, type HookEntry, type MCPConfig } from "../core/hub-config.js";
import { getSavedEditor, saveGenerateState, getKiroMode, saveKiroMode, readCache, writeCache, checkOutdated, type KiroMode } from "../core/hub-cache.js";
import { fetchRemoteSources } from "../core/design-sources.js";
import { loadPersona, buildPersonaEditorFile } from "./persona.js";
import { buildCodexMcpBlock } from "./codex-config.js";
import { generateEnvExample } from "./env-example.js";
import {
  buildCapabilitiesPrompt,
  buildGitignoreLines,
  planClaudeCodeFiles,
  resolvePiConfig,
  type SteeringInput,
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

function stripFrontMatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n*/);
  if (match) return content.slice(match[0].length);
  return content;
}

function parseFrontMatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

async function readExistingMcpDisabledState(mcpJsonPath: string): Promise<Record<string, boolean>> {
  const disabledState: Record<string, boolean> = {};
  if (!existsSync(mcpJsonPath)) return disabledState;
  try {
    const content = JSON.parse(await readFile(mcpJsonPath, "utf-8"));
    const servers = (content.mcpServers || content.mcp || {}) as Record<string, Record<string, unknown>>;
    for (const [name, config] of Object.entries(servers)) {
      if (typeof config.disabled === "boolean") {
        disabledState[name] = config.disabled;
      }
    }
  } catch {
    // skip
  }
  return disabledState;
}

function applyDisabledState(
  mcpConfig: Record<string, Record<string, unknown>>,
  disabledState: Record<string, boolean>
): void {
  for (const [name, entry] of Object.entries(mcpConfig)) {
    if (name in disabledState) {
      entry.disabled = disabledState[name];
    }
  }
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

const HUB_MARKER_START = "# >>> hub-managed (do not edit this section)";
const HUB_MARKER_END = "# <<< hub-managed";

const HOOK_EVENT_MAP: Record<string, { cursor?: string; claude?: string; kiro?: string; opencode?: string }> = {
  session_start:            { cursor: "sessionStart",            claude: "SessionStart",       kiro: undefined,        opencode: "session.created" },
  session_end:              { cursor: "sessionEnd",              claude: "SessionEnd",          kiro: undefined,        opencode: "session.idle" },
  pre_tool_use:             { cursor: "preToolUse",              claude: "PreToolUse",          kiro: "pre_tool_use",   opencode: "tool.execute.before" },
  post_tool_use:            { cursor: "postToolUse",             claude: "PostToolUse",         kiro: "post_tool_use",  opencode: "tool.execute.after" },
  post_tool_use_failure:    { cursor: undefined,                 claude: "PostToolUseFailure",  kiro: undefined,        opencode: undefined },
  stop:                     { cursor: "stop",                    claude: "Stop",                kiro: "agent_stop",     opencode: "session.idle" },
  subagent_start:           { cursor: "subagentStart",           claude: "SubagentStart",       kiro: undefined,        opencode: undefined },
  subagent_stop:            { cursor: "subagentStop",            claude: "SubagentStop",        kiro: undefined,        opencode: undefined },
  pre_compact:              { cursor: "preCompact",              claude: "PreCompact",          kiro: undefined,        opencode: "session.compacted" },
  before_submit_prompt:     { cursor: "beforeSubmitPrompt",      claude: "UserPromptSubmit",    kiro: "prompt_submit",  opencode: undefined },
  before_shell_execution:   { cursor: "beforeShellExecution",    claude: undefined,             kiro: undefined,        opencode: "tool.execute.before" },
  after_shell_execution:    { cursor: "afterShellExecution",     claude: undefined,             kiro: undefined,        opencode: "tool.execute.after" },
  before_mcp_execution:     { cursor: "beforeMCPExecution",      claude: undefined,             kiro: undefined,        opencode: "tool.execute.before" },
  after_mcp_execution:      { cursor: "afterMCPExecution",       claude: undefined,             kiro: undefined,        opencode: "tool.execute.after" },
  after_file_edit:          { cursor: "afterFileEdit",           claude: undefined,             kiro: "file_save",      opencode: "file.edited" },
  before_read_file:         { cursor: "beforeReadFile",          claude: undefined,             kiro: undefined,        opencode: undefined },
  before_tab_file_read:     { cursor: "beforeTabFileRead",       claude: undefined,             kiro: undefined,        opencode: undefined },
  after_tab_file_edit:      { cursor: "afterTabFileEdit",        claude: undefined,             kiro: undefined,        opencode: "file.edited" },
  after_agent_response:     { cursor: "afterAgentResponse",      claude: undefined,             kiro: undefined,        opencode: undefined },
  after_agent_thought:      { cursor: "afterAgentThought",       claude: undefined,             kiro: undefined,        opencode: undefined },
  notification:             { cursor: undefined,                 claude: "Notification",        kiro: undefined,        opencode: undefined },
  permission_request:       { cursor: undefined,                 claude: "PermissionRequest",   kiro: undefined,        opencode: "permission.asked" },
  task_completed:           { cursor: undefined,                 claude: "TaskCompleted",       kiro: undefined,        opencode: "session.idle" },
  teammate_idle:            { cursor: undefined,                 claude: "TeammateIdle",        kiro: undefined,        opencode: undefined },
};

function buildCursorHooks(hooks: Record<string, HookEntry[]>): Record<string, unknown> | null {
  const cursorHooks: Record<string, unknown[]> = {};

  for (const [event, entries] of Object.entries(hooks)) {
    const mapped = HOOK_EVENT_MAP[event]?.cursor;
    if (!mapped) continue;

    const cursorEntries = entries.map((entry) => {
      const obj: Record<string, unknown> = { type: entry.type };
      if (entry.type === "command" && entry.command) obj.command = entry.command;
      if (entry.type === "prompt" && entry.prompt) obj.prompt = entry.prompt;
      if (entry.matcher) obj.matcher = entry.matcher;
      if (entry.timeout_ms) obj.timeout = entry.timeout_ms;
      return obj;
    });

    if (cursorEntries.length > 0) {
      cursorHooks[mapped] = cursorEntries;
    }
  }

  if (Object.keys(cursorHooks).length === 0) return null;
  return { version: 1, hooks: cursorHooks };
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

async function writeManagedFile(filePath: string, managedLines: string[]): Promise<void> {
  const managedBlock = [HUB_MARKER_START, ...managedLines, HUB_MARKER_END].join("\n");

  if (existsSync(filePath)) {
    const existing = await readFile(filePath, "utf-8");
    const startIdx = existing.indexOf(HUB_MARKER_START);
    const endIdx = existing.indexOf(HUB_MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + HUB_MARKER_END.length);
      await writeFile(filePath, before + managedBlock + after, "utf-8");
      return;
    }

    await writeFile(filePath, managedBlock + "\n\n" + existing, "utf-8");
    return;
  }

  await writeFile(filePath, managedBlock + "\n", "utf-8");
}

interface Generator {
  name: string;
  generate: (config: HubConfig, hubDir: string) => Promise<void>;
}

async function generateCursor(config: HubConfig, hubDir: string) {
  const cursorDir = join(hubDir, ".cursor");
  await mkdir(join(cursorDir, "rules"), { recursive: true });

  const gitignoreLines = buildGitignoreLines(config);
  await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
  console.log(chalk.green("  Generated .gitignore"));

  const cursorignoreLines = [
    "# Re-include repositories for AI context",
  ];
  for (const repo of config.repos) {
    const repoDir = repo.path.replace("./", "");
    cursorignoreLines.push(`!${repoDir}/`);
  }
  cursorignoreLines.push("", "# Re-include tasks for agent collaboration", "!tasks/");
  await writeManagedFile(join(hubDir, ".cursorignore"), cursorignoreLines);
  console.log(chalk.green("  Generated .cursorignore"));

  if (config.mcps?.length) {
    const mcpConfig: Record<string, Record<string, unknown>> = {};
    const upstreamSet = getUpstreamNames(config.mcps);
    for (const mcp of config.mcps) {
      if (upstreamSet.has(mcp.name)) continue;
      if (mcp.upstreams?.length) {
        mcpConfig[mcp.name] = buildProxyMcpEntry(mcp, config.mcps, buildCursorMcpEntry);
      } else {
        mcpConfig[mcp.name] = buildCursorMcpEntry(mcp);
      }
    }
    await writeFile(
      join(cursorDir, "mcp.json"),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n",
      "utf-8"
    );
    console.log(chalk.green("  Generated .cursor/mcp.json"));
  }

  const orchestratorRule = buildOrchestratorRule(config);
  await writeFile(join(cursorDir, "rules", "orchestrator.mdc"), orchestratorRule, "utf-8");
  console.log(chalk.green("  Generated .cursor/rules/orchestrator.mdc"));

  const cleanedOrchestratorForAgents = orchestratorRule.replace(/^---[\s\S]*?---\n/m, "").trim();
  const personaCursor = await loadPersona(hubDir);
  await writeFile(join(hubDir, "AGENTS.md"), cleanedOrchestratorForAgents + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

  if (personaCursor) {
    const personaRuleContent = buildPersonaEditorFile(personaCursor, "cursor");
    await writeFile(join(cursorDir, "rules", "persona.mdc"), personaRuleContent, "utf-8");
    console.log(chalk.green(`  Generated .cursor/rules/persona.mdc (${personaCursor.name}, ${personaCursor.role})`));
  }

  const hubSteeringDirCursor = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDirCursor);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDirCursor, file), "utf-8");
      const content = stripFrontMatter(raw);
      const mdcName = file.replace(/\.md$/, ".mdc");
      const mdcContent = `---\ndescription: "${file.replace(/\.md$/, "")}"\nalwaysApply: true\n---\n\n${content}`;
      await writeFile(join(cursorDir, "rules", mdcName), mdcContent, "utf-8");
    }
    if (mdFiles.length > 0) {
      console.log(chalk.green(`  Copied ${mdFiles.length} steering files to .cursor/rules/`));
    }
  } catch {
    // no steering dir
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
        const srcDir = join(skillsDir, folder);
        const targetDir = join(cursorSkillsDir, folder);
        await cp(srcDir, targetDir, { recursive: true });
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

  if (config.hooks) {
    const cursorHooks = buildCursorHooks(config.hooks);
    if (cursorHooks) {
      await writeFile(
        join(cursorDir, "hooks.json"),
        JSON.stringify(cursorHooks, null, 2) + "\n",
        "utf-8"
      );
      console.log(chalk.green("  Generated .cursor/hooks.json"));
    }
  }

  await generateEditorCommands(config, hubDir, cursorDir, ".cursor/commands/");
  await generateVSCodeSettings(config, hubDir);
}

interface ProxyUpstreamEntry {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function resolveStdioCommand(mcp: MCPConfig): { command: string; args: string[] } {
  if (mcp.command) {
    return { command: mcp.command, args: mcp.args || [] };
  }
  return { command: "npx", args: ["-y", mcp.package!, ...(mcp.args || [])] };
}

function buildProxyUpstreams(proxyMcp: MCPConfig, allMcps: MCPConfig[]): { upstreamsJson: string; collectedEnv: Record<string, string> } {
  const upstreamNames = new Set(proxyMcp.upstreams || []);
  const upstreamEntries: ProxyUpstreamEntry[] = [];
  const collectedEnv: Record<string, string> = {};

  for (const mcp of allMcps) {
    if (!upstreamNames.has(mcp.name)) continue;
    if (mcp.url || mcp.image) continue;

    const stdio = resolveStdioCommand(mcp);
    const entry: ProxyUpstreamEntry = {
      name: mcp.name,
      command: stdio.command,
      args: stdio.args,
    };

    if (mcp.env) {
      entry.env = {};
      for (const [key, value] of Object.entries(mcp.env)) {
        const envRef = value.match(/^\$\{(?:env:)?(\w+)\}$/);
        if (envRef) {
          entry.env[key] = `\${${envRef[1]}}`;
          collectedEnv[envRef[1]] = value;
        } else {
          entry.env[key] = value;
          collectedEnv[key] = value;
        }
      }
    }

    upstreamEntries.push(entry);
  }

  if (proxyMcp.env) {
    for (const [key, value] of Object.entries(proxyMcp.env)) {
      collectedEnv[key] = value;
    }
  }

  return {
    upstreamsJson: JSON.stringify(upstreamEntries),
    collectedEnv,
  };
}

function buildProxyMcpEntry(
  proxyMcp: MCPConfig,
  allMcps: MCPConfig[],
  buildEntry: (mcp: MCPConfig) => Record<string, unknown>
): Record<string, unknown> {
  const { upstreamsJson, collectedEnv } = buildProxyUpstreams(proxyMcp, allMcps);
  const env: Record<string, string> = {
    MCP_PROXY_UPSTREAMS: upstreamsJson,
    ...collectedEnv,
  };
  return buildEntry({ ...proxyMcp, env });
}

function getUpstreamNames(mcps: MCPConfig[]): Set<string> {
  const names = new Set<string>();
  for (const mcp of mcps) {
    if (mcp.upstreams) {
      for (const name of mcp.upstreams) {
        names.add(name);
      }
    }
  }
  return names;
}

function resolveAutoApprove(mcp: MCPConfig): string[] | undefined {
  if (mcp.autoApprove === true) return ["*"];
  if (Array.isArray(mcp.autoApprove) && mcp.autoApprove.length > 0) return mcp.autoApprove;
  return undefined;
}

function buildCursorMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  const autoApprove = resolveAutoApprove(mcp);
  if (mcp.url) {
    return { url: mcp.url, ...(mcp.env && { env: mcp.env }), ...(autoApprove && { autoApprove }) };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (mcp.env) {
      for (const [key, value] of Object.entries(mcp.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args, ...(autoApprove && { autoApprove }) };
  }
  const { command, args } = resolveStdioCommand(mcp);
  return {
    command,
    ...(args.length > 0 && { args }),
    ...(mcp.env && { env: mcp.env }),
    ...(autoApprove && { autoApprove }),
  };
}

/**
 * Kiro IDE and Claude Code use `${VAR_NAME}` for env references, while the CLI
 * uses `${env:VAR_NAME}`. This strips the `env:` prefix when generating for them.
 */
function stripEnvPrefix(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{env:(\w+)\}/g, "${$1}");
  }
  return result;
}

function buildKiroMcpEntry(mcp: MCPConfig, mode: KiroMode = "editor"): Record<string, unknown> {
  const env = mcp.env
    ? mode === "editor" ? stripEnvPrefix(mcp.env) : mcp.env
    : undefined;
  const autoApprove = resolveAutoApprove(mcp);
  if (mcp.url) {
    return { url: mcp.url, ...(env && { env }), ...(autoApprove && { autoApprove }) };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args, ...(autoApprove && { autoApprove }) };
  }
  const { command, args } = resolveStdioCommand(mcp);
  return {
    command,
    ...(args.length > 0 && { args }),
    ...(env && { env }),
    ...(autoApprove && { autoApprove }),
  };
}


function stripDollarPrefix(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{env:(\w+)\}/g, "{env:$1}").replace(/\$\{(\w+)\}/g, "{env:$1}");
  }
  return result;
}

function buildOpenCodeMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  const env = mcp.env ? stripDollarPrefix(mcp.env) : undefined;
  if (mcp.url) {
    return { type: "remote", url: mcp.url };
  }
  if (mcp.image) {
    const cmd = ["docker", "run", "-i", "--rm"];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        cmd.push("-e", `${key}=${value}`);
      }
    }
    cmd.push(mcp.image);
    return { type: "local", command: cmd, ...(env && { environment: env }) };
  }
  const { command, args } = resolveStdioCommand(mcp);
  return {
    type: "local",
    command: [command, ...args],
    ...(env && { environment: env }),
  };
}

function buildOpenCodeHooksPlugin(hooks: Record<string, HookEntry[]>): string | null {
  const handlers: string[] = [];
  const seen = new Set<string>();

  for (const [event, entries] of Object.entries(hooks)) {
    const mapped = HOOK_EVENT_MAP[event]?.opencode;
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);

    const commandEntries = entries.filter((e) => e.type === "command" && e.command);
    if (commandEntries.length === 0) continue;

    const cmds = commandEntries.map((e) => JSON.stringify(e.command));
    handlers.push(`    "${mapped}": async (input, output) => {
      for (const cmd of [${cmds.join(", ")}]) {
        try { await $\`\${cmd}\`; } catch (e) { console.error("Hook failed:", cmd, e); }
      }
    }`);
  }

  if (handlers.length === 0) return null;

  return `// Auto-generated by hub — maps hub.yaml hooks to OpenCode plugin events
export const HubHooksPlugin = async ({ $ }) => {
  return {
${handlers.join(",\n")}
  };
};
`;
}

function buildOpenCodePrimaryAgentMarkdown(description: string, body: string): string {
  return `---
description: "${description}"
mode: primary
tools:
  write: true
  edit: true
  bash: true
permission:
  task:
    "*": allow
---

${body.trim()}
`;
}

function buildOpenCodeOrchestratorRule(config: HubConfig): string {
  return buildCapabilitiesPrompt(config, { format: "plain" });
}


async function generateOpenCode(config: HubConfig, hubDir: string) {
  const opencodeDir = join(hubDir, ".opencode");
  await mkdir(join(opencodeDir, "agents"), { recursive: true });
  await mkdir(join(opencodeDir, "rules"), { recursive: true });
  await mkdir(join(opencodeDir, "skills"), { recursive: true });
  await mkdir(join(opencodeDir, "commands"), { recursive: true });
  await mkdir(join(opencodeDir, "plugins"), { recursive: true });

  const gitignoreLines = buildGitignoreLines(config);
  await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
  console.log(chalk.green("  Generated .gitignore"));

  if (config.repos.length > 0) {
    const ignoreContent = config.repos.map((r) => `!${r.name}`).join("\n") + "\n";
    await writeFile(join(hubDir, ".ignore"), ignoreContent, "utf-8");
    console.log(chalk.green("  Generated .ignore"));
  }

  const orchestratorContent = buildOpenCodeOrchestratorRule(config);
  const orchestratorAgent = buildOpenCodePrimaryAgentMarkdown(
    "Primary agent. Helps build and operate software across the workspace using skills, tools, and multi-repo context.",
    orchestratorContent
  );
  await writeFile(join(opencodeDir, "agents", "orchestrator.md"), orchestratorAgent, "utf-8");
  console.log(chalk.green("  Generated .opencode/agents/orchestrator.md (primary agent)"));
  await rm(join(opencodeDir, "rules", "orchestrator.md")).catch(() => {});

  const personaOC = await loadPersona(hubDir);
  await writeFile(join(hubDir, "AGENTS.md"), orchestratorContent + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

  if (personaOC) {
    const personaRuleContent = buildPersonaEditorFile(personaOC, "opencode");
    await writeFile(join(opencodeDir, "rules", "persona.md"), personaRuleContent, "utf-8");
    console.log(chalk.green(`  Generated .opencode/rules/persona.md (${personaOC.name}, ${personaOC.role})`));
  }

  const hubSteeringDirOC = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDirOC);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDirOC, file), "utf-8");
      const content = stripFrontMatter(raw);
      await writeFile(join(opencodeDir, "rules", file), content, "utf-8");
    }
    if (mdFiles.length > 0) {
      console.log(chalk.green(`  Copied ${mdFiles.length} steering files to .opencode/rules/`));
    }
  } catch {
    // no steering dir
  }

  const opencodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    default_agent: "orchestrator",
  };

  if (config.mcps?.length) {
    const mcpConfig: Record<string, Record<string, unknown>> = {};
    const upstreamSet = getUpstreamNames(config.mcps);
    for (const mcp of config.mcps) {
      if (upstreamSet.has(mcp.name)) continue;
      if (mcp.upstreams?.length) {
        mcpConfig[mcp.name] = buildProxyMcpEntry(mcp, config.mcps, buildOpenCodeMcpEntry);
      } else {
        mcpConfig[mcp.name] = buildOpenCodeMcpEntry(mcp);
      }
    }
    opencodeConfig.mcp = mcpConfig;
  }

  opencodeConfig.instructions = [".opencode/rules/*.md"];

  await writeFile(
    join(hubDir, "opencode.json"),
    JSON.stringify(opencodeConfig, null, 2) + "\n",
    "utf-8"
  );
  console.log(chalk.green("  Generated opencode.json"));

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

  if (config.hooks) {
    const plugin = buildOpenCodeHooksPlugin(config.hooks);
    if (plugin) {
      await writeFile(join(opencodeDir, "plugins", "hub-hooks.js"), plugin, "utf-8");
      console.log(chalk.green("  Generated .opencode/plugins/hub-hooks.js"));
    }
  }

  await generateVSCodeSettings(config, hubDir);
}

function buildKiroSteeringContent(content: string, inclusion: "always" | "auto" = "always", meta?: { name?: string; description?: string }): string {
  const frontMatter: string[] = ["---", `inclusion: ${inclusion}`];
  if (meta?.name) frontMatter.push(`name: ${meta.name}`);
  if (meta?.description) frontMatter.push(`description: ${meta.description}`);
  frontMatter.push("---");
  return `${frontMatter.join("\n")}\n\n${content}`;
}

function buildKiroOrchestratorRule(config: HubConfig): string {
  return buildCapabilitiesPrompt(config, { format: "plain" });
}


function buildOrchestratorRule(config: HubConfig): string {
  return buildCapabilitiesPrompt(config, { format: "cursor-rule" });
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

  const steering: SteeringInput[] = [];
  const hubSteeringDirClaude = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDirClaude);
    for (const file of steeringFiles.filter((f) => f.endsWith(".md"))) {
      steering.push({ name: file, content: await readFile(join(hubSteeringDirClaude, file), "utf-8") });
    }
  } catch {
    // no steering dir
  }

  const plannedFiles = planClaudeCodeFiles(config, { steering, persona: personaClaude });
  for (const file of plannedFiles) {
    const target = join(hubDir, file.path);
    if (file.kind === "managed-block") {
      await writeManagedFile(target, file.content.split("\n"));
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf-8");
    }
    console.log(chalk.green(`  Generated ${file.path}`));
  }

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

  const orchestratorRule = buildOrchestratorRule(config);
  const cleanedOrchestrator = orchestratorRule.replace(/^---[\s\S]*?---\n/m, "").trim();
  const personaCodex = await loadPersona(hubDir);
  await writeFile(join(hubDir, "AGENTS.md"), cleanedOrchestrator + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));
  if (personaCodex) {
    console.log(chalk.green(`  Applied persona: ${personaCodex.name} (${personaCodex.role})`));
  }

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

  if (config.mcps?.length) {
    const upstreamSet = getUpstreamNames(config.mcps);
    const blocks: string[] = [
      "# GENERATED by `hub generate -e codex` from hub.yaml — do not edit by hand.",
      "#",
      "# Codex only loads this file when the project is trusted:",
      "#   codex projects trust",
      "# AGENTS.md and skills/ are read natively and do not need extra config here.",
      "",
    ];
    for (const mcp of config.mcps) {
      if (upstreamSet.has(mcp.name)) continue;
      let resolved: MCPConfig = mcp;
      if (mcp.upstreams?.length) {
        const { upstreamsJson, collectedEnv } = buildProxyUpstreams(mcp, config.mcps);
        resolved = { ...mcp, env: { MCP_PROXY_UPSTREAMS: upstreamsJson, ...collectedEnv } };
      }
      const result = buildCodexMcpBlock(mcp.name, resolved);
      if (result === null) {
        console.log(chalk.yellow(`  Skipping MCP "${mcp.name}": no url, image, or package configured`));
        continue;
      }
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  ${warning}`));
      }
      blocks.push(result.block, "");
    }
    await writeFile(
      join(codexDir, "config.toml"),
      blocks.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n",
      "utf-8"
    );
    console.log(chalk.green("  Generated .codex/config.toml"));
  }

  const gitignoreLines = buildGitignoreLines(config);
  await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
  console.log(chalk.green("  Generated .gitignore"));
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

  const gitignoreLines = buildGitignoreLines(config);
  await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
  console.log(chalk.green("  Generated .gitignore"));

  const kiroRule = buildKiroOrchestratorRule(config);
  const personaKiro = await loadPersona(hubDir);

  await writeFile(join(hubDir, "AGENTS.md"), kiroRule + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

  if (personaKiro) {
    const personaSteeringContent = buildPersonaEditorFile(personaKiro, "kiro");
    await writeFile(join(steeringDir, "persona.md"), personaSteeringContent, "utf-8");
    console.log(chalk.green(`  Generated .kiro/steering/persona.md (${personaKiro.name}, ${personaKiro.role})`));
  }

  await rm(join(steeringDir, "orchestrator.md")).catch(() => {});

  const hubSteeringDir = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDir);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDir, file), "utf-8");
      const content = stripFrontMatter(raw);

      const destPath = join(steeringDir, file);
      let inclusion: "always" | "auto" = "always";
      let meta: { name?: string; description?: string } | undefined;

      if (existsSync(destPath)) {
        const existingContent = await readFile(destPath, "utf-8");
        const existingFm = parseFrontMatter(existingContent);
        if (existingFm) {
          if (existingFm.inclusion === "auto" || existingFm.inclusion === "manual" || existingFm.inclusion === "fileMatch") {
            inclusion = "auto";
          }
          if (existingFm.name || existingFm.description) {
            meta = {};
            if (existingFm.name) meta.name = existingFm.name;
            if (existingFm.description) meta.description = existingFm.description;
          }
        }
      }

      const sourceFm = parseFrontMatter(raw);
      if (sourceFm) {
        if (sourceFm.inclusion === "auto" || sourceFm.inclusion === "manual" || sourceFm.inclusion === "fileMatch") {
          inclusion = "auto";
        }
        if (sourceFm.name || sourceFm.description) {
          meta = meta || {};
          if (sourceFm.name) meta.name = sourceFm.name;
          if (sourceFm.description) meta.description = sourceFm.description;
        }
      }

      const kiroSteering = buildKiroSteeringContent(content, inclusion, meta);
      await writeFile(destPath, kiroSteering, "utf-8");
    }
    if (mdFiles.length > 0) {
      console.log(chalk.green(`  Copied ${mdFiles.length} steering files to .kiro/steering/`));
    }
  } catch {
    // no steering dir
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
        const srcDir = join(skillsDir, folder);
        const targetDir = join(kiroSkillsDir, folder);
        await cp(srcDir, targetDir, { recursive: true });
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

  if (config.mcps?.length) {
    const mcpConfig: Record<string, Record<string, unknown>> = {};
    const upstreamSet = getUpstreamNames(config.mcps);
    const buildEntry = (mcp: MCPConfig) => buildKiroMcpEntry(mcp, mode);
    for (const mcp of config.mcps) {
      if (upstreamSet.has(mcp.name)) continue;
      if (mcp.upstreams?.length) {
        mcpConfig[mcp.name] = buildProxyMcpEntry(mcp, config.mcps, buildEntry);
      } else {
        mcpConfig[mcp.name] = buildKiroMcpEntry(mcp, mode);
      }
    }
    const mcpJsonPath = join(settingsDir, "mcp.json");
    const disabledState = await readExistingMcpDisabledState(mcpJsonPath);
    applyDisabledState(mcpConfig, disabledState);
    await writeFile(
      mcpJsonPath,
      JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n",
      "utf-8"
    );
    console.log(chalk.green("  Generated .kiro/settings/mcp.json"));
  }

  if (config.hooks) {
    const hookNotes: string[] = [];
    for (const [event, entries] of Object.entries(config.hooks)) {
      const mapped = HOOK_EVENT_MAP[event]?.kiro;
      if (!mapped) continue;
      for (const entry of entries) {
        hookNotes.push(`- **${mapped}**: ${entry.type === "command" ? entry.command : entry.prompt}`);
      }
    }
    if (hookNotes.length > 0) {
      console.log(chalk.yellow(`  Note: Kiro hooks are managed via the Kiro panel UI.`));
      console.log(chalk.yellow(`  The following hooks should be configured manually:`));
      for (const note of hookNotes) {
        console.log(chalk.yellow(`    ${note}`));
      }
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



const HUB_PI_PACKAGE = "npm:@arvoretech/hub-pi";

async function generatePi(config: HubConfig, hubDir: string) {
  const gitignoreLines = buildGitignoreLines(config);
  await writeManagedFile(join(hubDir, ".gitignore"), gitignoreLines);
  console.log(chalk.green("  Generated .gitignore"));

  const piDir = join(hubDir, ".pi");
  await mkdir(piDir, { recursive: true });
  const settingsPath = join(piDir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      console.log(chalk.yellow("  Existing .pi/settings.json is invalid JSON — leaving it untouched."));
      console.log(chalk.dim(`  Add "${HUB_PI_PACKAGE}" to its "packages" array manually once the JSON is fixed.`));
      return;
    }
  }

  const packages = Array.isArray(settings.packages) ? (settings.packages as string[]) : [];
  if (!packages.includes(HUB_PI_PACKAGE)) {
    packages.push(HUB_PI_PACKAGE);
    console.log(chalk.green(`  Registered ${HUB_PI_PACKAGE} in .pi/settings.json`));
  } else {
    console.log(chalk.dim("  hub-pi already registered in .pi/settings.json"));
  }
  settings.packages = packages;

  const skillsEntries = Array.isArray(settings.skills) ? (settings.skills as string[]) : [];
  if (!skillsEntries.includes("skills") && !skillsEntries.includes(".pi/skills")) {
    skillsEntries.push("skills");
    console.log(chalk.green("  Pointed skills dir to ./skills in .pi/settings.json"));
  }
  settings.skills = skillsEntries;

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

  const piToggles = resolvePiConfig(config);
  if (!piToggles.injectCapabilities) {
    console.log(chalk.dim("\n  pi.injectCapabilities is disabled — skipping AGENTS.md generation."));
    console.log(chalk.dim("  The hub-pi extension still wires MCPs, repo tools, persona, hooks, and skills at runtime."));
    return;
  }

  const capabilities = buildCapabilitiesPrompt(config, { format: "plain" });
  const agentsSections: string[] = [];
  if (capabilities) agentsSections.push(capabilities);

  const hubSteeringDirPi = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDirPi);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDirPi, file), "utf-8");
      const content = stripFrontMatter(raw).trim();
      if (content) agentsSections.push(content);
    }
    if (mdFiles.length > 0) {
      console.log(chalk.green(`  Appended ${mdFiles.length} steering files to AGENTS.md`));
    }
  } catch {
    // no steering dir
  }

  await writeFile(join(hubDir, "AGENTS.md"), agentsSections.join("\n\n") + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

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
