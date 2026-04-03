import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir, copyFile, readFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadHubConfig, type HubConfig, type HookEntry, type MCPConfig, type WorkflowStep } from "../core/hub-config.js";
import { getSavedEditor, saveGenerateState, getKiroMode, saveKiroMode, readCache, writeCache, checkOutdated, type KiroMode } from "../core/hub-cache.js";
import { fetchRemoteSources } from "../core/design-sources.js";

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

function buildDesignSection(config: HubConfig): string | null {
  const design = config.design;
  if (!design) return null;

  const hasContent = design.skills?.length || design.libraries?.length || design.icons || design.instructions;
  if (!hasContent) return null;

  const parts: string[] = [];
  parts.push(`\n## Design System`);

  if (design.instructions) {
    parts.push(`\n${design.instructions.trim()}`);
  }

  if (design.skills?.length) {
    parts.push(`\n### Design Skills\n`);
    parts.push(`The following skills contain design guidelines and should be consulted when working on UI:`);
    for (const skill of design.skills) {
      parts.push(`- \`${skill}\``);
    }
  }

  if (design.libraries?.length) {
    parts.push(`\n### UI Libraries\n`);
    for (const lib of design.libraries) {
      const refs: string[] = [];
      if (lib.mcp) refs.push(`docs via \`${lib.mcp}\` MCP`);
      if (lib.url) refs.push(`[docs](${lib.url})`);
      if (lib.path) refs.push(`local docs at \`${lib.path}\``);
      parts.push(`- **${lib.name}**${refs.length ? ` — ${refs.join(", ")}` : ""}`);
    }
  }

  if (design.icons) {
    parts.push(`\n### Icons\n`);
    parts.push(`Icon library: **${design.icons}**. Always use this library for icons.`);
  }

  return parts.join("\n");
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

function buildClaudeHooks(hooks: Record<string, HookEntry[]>): Record<string, unknown[]> | null {
  const claudeHooks: Record<string, unknown[]> = {};

  for (const [event, entries] of Object.entries(hooks)) {
    const mapped = HOOK_EVENT_MAP[event]?.claude;
    if (!mapped) continue;

    const claudeEntries = entries.map((entry) => {
      const obj: Record<string, unknown> = { type: entry.type };
      if (entry.type === "command" && entry.command) obj.command = entry.command;
      if (entry.type === "prompt" && entry.prompt) obj.prompt = entry.prompt;
      if (entry.matcher) obj.matcher = entry.matcher;
      if (entry.timeout_ms) obj.timeout = entry.timeout_ms;
      return obj;
    });

    if (claudeEntries.length > 0) {
      claudeHooks[mapped] = claudeEntries;
    }
  }

  if (Object.keys(claudeHooks).length === 0) return null;
  return claudeHooks;
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
  await mkdir(join(cursorDir, "agents"), { recursive: true });

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
  await writeFile(join(hubDir, "AGENTS.md"), cleanedOrchestratorForAgents + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

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

  const agentsDir = resolve(hubDir, "agents");
  try {
    const agentFiles = await readdir(agentsDir);
    const mdFiles = agentFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      await copyFile(join(agentsDir, file), join(cursorDir, "agents", file));
    }
    console.log(chalk.green(`  Copied ${mdFiles.length} agent definitions`));
  } catch {
    console.log(chalk.yellow("  No agents/ directory found, skipping agent copy"));
  }

  const skillsDir = resolve(hubDir, "skills");
  try {
    const skillFolders = await readdir(skillsDir);
    const cursorSkillsDir = join(cursorDir, "skills");
    await mkdir(cursorSkillsDir, { recursive: true });
    let count = 0;
    for (const folder of skillFolders) {
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

function buildProxyUpstreams(proxyMcp: MCPConfig, allMcps: MCPConfig[]): { upstreamsJson: string; collectedEnv: Record<string, string> } {
  const upstreamNames = new Set(proxyMcp.upstreams || []);
  const upstreamEntries: ProxyUpstreamEntry[] = [];
  const collectedEnv: Record<string, string> = {};

  for (const mcp of allMcps) {
    if (!upstreamNames.has(mcp.name)) continue;
    if (mcp.url || mcp.image) continue;

    const entry: ProxyUpstreamEntry = {
      name: mcp.name,
      command: "npx",
      args: ["-y", mcp.package!],
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
  return {
    command: "npx",
    args: ["-y", mcp.package!],
    ...(mcp.env && { env: mcp.env }),
    ...(autoApprove && { autoApprove }),
  };
}

function buildClaudeCodeMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  if (mcp.url) {
    return { type: "http", url: mcp.url };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (mcp.env) {
      for (const [key, value] of Object.entries(mcp.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args };
  }
  return {
    command: "npx",
    args: ["-y", mcp.package!],
    ...(mcp.env && { env: mcp.env }),
  };
}

/**
 * Kiro IDE uses `${VAR_NAME}` for env references, while the CLI uses `${env:VAR_NAME}`.
 * This strips the `env:` prefix when generating for the editor/IDE.
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
  return {
    command: "npx",
    args: ["-y", mcp.package!],
    ...(env && { env }),
    ...(autoApprove && { autoApprove }),
  };
}

function buildKiroAgentContent(rawContent: string): string {
  const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return `---\nname: agent\ntools: ["@builtin"]\n---\n\n${rawContent}`;
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2];

  const attrs: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) attrs[match[1]] = match[2].trim();
  }

  const lines: string[] = ["---"];
  if (attrs.name) lines.push(`name: ${attrs.name}`);
  if (attrs.description) lines.push(`description: ${attrs.description}`);

  if (attrs.tools) {
    lines.push(`tools: ${attrs.tools}`);
  } else {
    lines.push(`tools: ["@builtin"]`);
  }

  if (attrs.model && attrs.model !== "inherit") {
    lines.push(`model: ${attrs.model}`);
  }

  lines.push("---");
  return `${lines.join("\n")}\n${body}`;
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
  return {
    type: "local",
    command: ["npx", "-y", mcp.package!],
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

function buildOpenCodeAgentMarkdown(name: string, content: string): string {
  const existingFrontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  let description = `Specialized agent for ${name} tasks`;
  if (existingFrontmatter) {
    const descMatch = existingFrontmatter[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1];
  }

  const body = existingFrontmatter
    ? content.replace(/^---\n[\s\S]*?\n---\n*/, "")
    : content;

  return `---
description: "${description}"
mode: subagent
tools:
  write: true
  edit: true
  bash: true
---

${body.trim()}
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

function hasAgentTeamsLeadMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "agent-teams-lead");
  const upstreamMatch = proxyMcp?.upstreams?.includes("agent-teams-lead") ?? false;
  return directMatch || upstreamMatch;
}

function buildAgentTeamsSection(mcps: MCPConfig[] | undefined): string {
  if (!hasAgentTeamsLeadMcp(mcps)) return "";

  return `
## Agent Teams

This workspace has agent teams support via the \`agent-teams-lead\` MCP. You can act as a team lead, spawning multiple AI teammates that work in parallel on different tasks.

**When to use agent teams** instead of sub-agents:
- Tasks that benefit from parallel exploration (research, review, debugging)
- Cross-layer work (frontend + backend + tests simultaneously)
- Work where teammates need to communicate and coordinate with each other

**How it works:**
1. Use \`spawn_team\` to create a team with an objective and list of teammates (each referencing an agent file)
2. Use \`create_task\` to add tasks to the shared task list (tasks can have dependencies and exclusive file paths)
3. Teammates automatically claim pending tasks, do the work, and mark them complete
4. Use \`send_message\` to communicate with teammates (or broadcast to all)
5. Use \`wait_for_team\` to block until all tasks are resolved or teammates finish
6. Use \`team_status\` to check progress, task states, and unread messages
7. Use \`read_artifact\` to read outputs published by teammates

**Available tools:** \`spawn_team\`, \`add_teammate\`, \`remove_teammate\`, \`create_task\`, \`team_status\`, \`send_message\`, \`wait_for_team\`, \`read_artifact\`.

**Best practices:**
- Create tasks IMMEDIATELY after spawning the team (teammates start looking for tasks right away)
- Use \`exclusive_paths\` on tasks to prevent file conflicts between teammates
- Use \`depends_on\` to chain tasks that must run in order
- Keep 2-3 tasks per teammate for good throughput
- Send a broadcast message after creating tasks to notify teammates
- Always call \`wait_for_team\` after creating tasks to monitor completion`;
}

function hasAgentTeamsChatMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "agent-teams-chat");
  const upstreamMatch = proxyMcp?.upstreams?.includes("agent-teams-chat") ?? false;
  return directMatch || upstreamMatch;
}

function buildAgentTeamsChatSection(mcps: MCPConfig[] | undefined): string {
  if (!hasAgentTeamsChatMcp(mcps)) return "";

  return `
## Agent Chat (Cross-Developer Communication)

You can communicate with agents from other developers on the team via the \`agent-teams-chat\` MCP. This is NOT the same as agent teams (which coordinates teammates within your own session). Agent chat lets you talk to agents running in other people's workspaces through Slack threads.

**When to use agent chat:**
- You need context or help from another developer's agent (e.g. "Hey, João's agent — what was the decision on the auth migration?")
- Coordinating cross-developer work asynchronously (e.g. "I'm changing the API contract, heads up")
- Sharing decisions, blockers, or discoveries that affect the whole team
- Asking questions that another developer's agent might already know the answer to

**How it works:**
1. Use \`open_thread\` to start a new conversation thread about a topic
2. Use \`reply_to_thread\` to respond in an existing thread
3. Use \`read_thread\` to catch up on what others have said
4. Use \`list_threads\` to see recent conversations in the channel
5. Use \`find_thread\` to search for threads by topic or content

**Available tools:** \`open_thread\`, \`reply_to_thread\`, \`read_thread\`, \`list_threads\`, \`find_thread\`.

**Message format:** Messages are automatically formatted with your identity (e.g. \`🤖 *João's Agent* — your message here\`). Other agents' messages will show their owner's name.

**IMPORTANT — Proactive message checking:**
- When you open or reply to a thread, periodically check for new replies using \`read_thread\` with the \`since\` parameter set to the last message timestamp you saw
- After sending a message that expects a response, wait a reasonable time (30-60 seconds) then check for replies
- At the start of a task, use \`list_threads\` to check if there are recent threads relevant to your current work
- If you're waiting on another agent's input, poll the thread every 30-60 seconds until you get a response or a reasonable timeout (5 minutes)

**Best practices:**
- Search for existing threads before opening a new one on the same topic
- Keep messages concise and actionable
- Use threads to maintain context — avoid top-level messages for replies
- Read the thread before replying to avoid repeating what others said
- When starting a task that touches shared code, check recent threads for relevant context`;
}

function hasKanbanMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "kanban" || m.package === "@arvoretech/kanban-mcp");
  const upstreamMatch = proxyMcp?.upstreams?.includes("kanban") ?? false;
  return directMatch || upstreamMatch;
}

function buildKanbanSection(mcps: MCPConfig[] | undefined): string {
  if (!hasKanbanMcp(mcps)) return "";

  return `
## Kanban Board

This workspace has a persistent kanban board via the \`kanban\` MCP. Use it to organize work, track progress across sessions, and coordinate with other chats.

**When to use the kanban:**
- At the start of a task, check the board for existing cards and active sessions
- Break complex features into cards before starting implementation
- Claim cards you're working on so other sessions can see
- Release cards when done (default status: review)
- Search for related cards before creating duplicates

**Workflow:**
1. \`list_boards\` / \`get_board\` — See what's on the board and who's working on what
2. \`create_card\` — Add new tasks to the appropriate column
3. \`claim_card\` — Mark a card as being worked on by this session
4. \`move_card\` — Move cards between columns as work progresses
5. \`release_card\` — Release when done, with status and detail (e.g. "PR #123 created")
6. \`search_cards\` — Find cards by meaning (semantic search)

**Available tools:** \`list_boards\`, \`create_board\`, \`get_board\`, \`get_card\`, \`create_card\`, \`update_card\`, \`move_card\`, \`claim_card\`, \`release_card\`, \`search_cards\`, \`archive_card\`, \`delete_card\`.

**Multi-session coordination:**
- Always \`claim_card\` before starting work — other sessions will see it's taken
- If a card is already claimed, pick another or use \`force: true\` to override stale sessions
- Use \`get_board\` to see active sessions with duration (helps identify abandoned claims)
- When finishing, \`release_card\` with a meaningful detail so the next session has context

**Best practices:**
- Use subtasks (\`parent_card_id\`) to break down large cards
- Tag cards consistently for easy filtering
- Set priority to help triage (urgent > high > medium > low)
- Check the board at the start of every session — don't start from zero`;
}

function buildMcpToolsSection(mcps: MCPConfig[] | undefined): string {
  if (!mcps || mcps.length === 0) return "";

  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const upstreamNames = getUpstreamNames(mcps);
  const directMcps = mcps.filter((m) => !m.upstreams && !upstreamNames.has(m.name));
  const mcpByName = new Map(mcps.map((m) => [m.name, m]));

  if (!proxyMcp && directMcps.length === 0) return "";

  const lines: string[] = [];
  lines.push(`
## MCP Tools (Model Context Protocol)

This workspace has multiple MCP servers available.`);

  if (proxyMcp) {
    lines.push(`
Some MCPs are aggregated behind a proxy (\`${proxyMcp.name}\`). Their tools are NOT directly visible — you must use \`mcp_search\` to discover available tools and \`mcp_call\` to execute them.

**How to use proxied tools:**
1. \`mcp_search({ query: "your search term" })\` — find tools by name or description
2. \`mcp_call({ ref: "tool-ref-from-search", args: { ... } })\` — execute the tool

**MCPs available via proxy:**`);
    for (const name of proxyMcp.upstreams!) {
      const mcp = mcpByName.get(name);
      const desc = mcp?.description ? ` — ${mcp.description}` : "";
      lines.push(`- \`${name}\`${desc}`);
    }
  }

  if (directMcps.length > 0) {
    lines.push(`
**MCPs available directly:**`);
    for (const mcp of directMcps) {
      const desc = mcp.description ? ` — ${mcp.description}` : "";
      lines.push(`- \`${mcp.name}\`${desc}`);
    }
  }

  if (proxyMcp) {
    lines.push(`
> When you need a capability and are unsure which tool to use, always try \`mcp_search\` first with relevant keywords. The proxy aggregates tools from all upstream MCPs.`);
  }

  const mcpsWithInstructions = mcps.filter((m) => m.instructions && !m.upstreams);
  if (mcpsWithInstructions.length > 0) {
    lines.push(`
### MCP Instructions`);
    for (const mcp of mcpsWithInstructions) {
      lines.push(`
#### ${mcp.name}
${mcp.instructions!.trim()}`);
    }
  }

  return lines.join("\n");
}

function buildCoreBehaviorSections(): string[] {
  const sections: string[] = [];

  sections.push(`
## Core Behavior

Be concise, clear, direct, and useful.
Prefer technical accuracy over reassurance.
Do not use hype, flattery, or exaggerated validation.
Do not repeatedly apologize when something unexpected happens — explain what happened and continue.
Do not claim actions were performed unless they were actually performed.
Never invent facts, code behavior, file contents, tool capabilities, or execution outcomes.
Focus on completing the user's task, not on narrating unnecessary process.`);

  sections.push(`
## Working Style

Prefer the simplest solution that fully satisfies the request.
Avoid over-engineering, speculative abstractions, premature generalization, and cleanup outside the requested scope.
Prefer editing existing files over creating new files.
Prefer minimal, reversible changes over broad rewrites unless the task explicitly requires a rewrite.
Ask the user questions only when a real ambiguity materially affects the solution.
Bias toward finding the answer yourself when the available context and tools are sufficient.`);

  sections.push(`
## Search, Reading, and Investigation

If you are unsure how to satisfy the user's request, gather more information before answering.
Prefer discovering answers yourself over asking the user for information that is likely available in the workspace, files, memories, or tools.

When reading code or documents:
- Read enough surrounding context to avoid missing critical behavior
- Do not propose modifications to code you have not inspected
- If partial views may hide important logic, continue reading before deciding

For broader exploration:
- Use lightweight search first
- Escalate to deeper exploration or subagents only when the task is broad, ambiguous, or likely to require several search passes`);

  sections.push(`
## Code Changes

When making code changes:
- Ensure the produced code is runnable and internally consistent
- Add required imports, wiring, dependencies, and integration points
- Preserve the project's existing patterns unless there is a strong reason to change them
- Read the relevant files or sections before modifying existing code
- Understand the surrounding code paths and conventions
- Prefer small, precise edits

If you introduce errors:
- Try to fix them
- Do not get stuck in unbounded retry loops (max 3 attempts on the same issue)
- If repeated fixes fail, explain the remaining problem clearly

Never assume a library is available — check the dependency file or neighboring code first.
When creating a new component, look at existing components to understand conventions.`);

  sections.push(`
## Security and Safety

Never hardcode secrets, credentials, tokens, or API keys.
Flag security risks when noticed.
Avoid introducing vulnerabilities such as command injection, SQL injection, XSS, insecure secret handling, broken auth flows, unsafe deserialization, SSRF, or privilege escalation.
Do not expose secrets in code, tests, examples, or logs.`);

  sections.push(`
## Git and Operational Discipline

Do not commit, push, open pull requests, or notify external systems unless the user asked for it or the workspace flow explicitly requires it.

When handling git work:
- Inspect status and diff before committing
- Follow existing repository commit conventions
- Prefer specific file staging over indiscriminate staging
- Do not use destructive git commands without explicit user authorization`);

  return sections;
}

function buildOpenCodeOrchestratorRule(config: HubConfig): string {
  const taskFolder = config.workflow?.task_folder || "./tasks/<TASK_ID>/";
  const steps = config.workflow?.pipeline || [];
  const prompt = config.workflow?.prompt;
  const enforce = config.workflow?.enforce_workflow ?? false;

  const sections: string[] = [];

  sections.push(`# Orchestrator

## Your Main Responsibility

You are an agent orchestrator. Your job is to ensure that any feature or task requested by the user is completed end-to-end using specialized sub-agents. Use \`@agent-name\` to invoke sub-agents for each phase of the pipeline.`);

  if (enforce) {
    sections.push(`
## STRICT WORKFLOW ENFORCEMENT

**YOU MUST FOLLOW THE PIPELINE DEFINED BELOW. NO EXCEPTIONS.**

- NEVER skip a pipeline step, even if the task seems simple or obvious.
- ALWAYS execute steps in the exact order defined. Do not reorder, merge, or parallelize steps unless the pipeline explicitly allows it.
- ALWAYS call the designated sub-agent for each step. Do not attempt to perform a step yourself if an agent is assigned to it.
- ALWAYS wait for a step to complete and validate its output before moving to the next step.
- If a step produces a document, READ the document and confirm it is complete before proceeding.
- If a step has unanswered questions or validation issues, RESOLVE them before advancing.
- NEVER jump directly to coding without completing refinement first.
- NEVER skip review or QA steps, even for small changes.
- If the user asks you to skip a step, explain why the pipeline exists and ask for explicit confirmation before proceeding.`);
  }

  if (prompt?.prepend) {
    sections.push(`\n${prompt.prepend.trim()}`);
  }

  if (config.integrations?.linear) {
    const linear = config.integrations.linear;
    sections.push(`
## Task Management

If the user doesn't have a task in their project management tool, create one using the Linear MCP.${linear.team ? ` Add it to the **${linear.team}** team.` : ""} Provide the link to the user so they can review and modify as needed.`);
  }

  sections.push(`
## Repositories
`);
  for (const repo of config.repos) {
    const parts = [`- **${repo.path}**`];
    if (repo.description) parts.push(`— ${repo.description}`);
    else if (repo.tech) parts.push(`— ${repo.tech}`);
    if (repo.skills?.length) parts.push(`(skills: ${repo.skills.join(", ")})`);
    sections.push(parts.join(" "));

    if (repo.commands) {
      const cmds = Object.entries(repo.commands)
        .filter(([, v]) => v)
        .map(([k, v]) => `\`${k}\`: \`${v}\``)
        .join(", ");
      if (cmds) sections.push(`  Commands: ${cmds}`);
    }
  }

  if (prompt?.sections?.after_repositories) {
    sections.push(`\n${prompt.sections.after_repositories.trim()}`);
  }

  const docStructure = buildDocumentStructure(steps, taskFolder);
  sections.push(docStructure);

  const pipelineSection = buildOpenCodePipelineSection(steps);
  sections.push(pipelineSection);

  if (prompt?.sections?.after_pipeline) {
    sections.push(`\n${prompt.sections.after_pipeline.trim()}`);
  }

  if (config.integrations?.slack || config.integrations?.github) {
    sections.push(buildDeliverySection(config));
  }

  if (prompt?.sections?.after_delivery) {
    sections.push(`\n${prompt.sections.after_delivery.trim()}`);
  }

  const mcpToolsSectionOpenCode = buildMcpToolsSection(config.mcps);
  if (mcpToolsSectionOpenCode) {
    sections.push(mcpToolsSectionOpenCode);
  }

  if (config.memory) {
    sections.push(`
## Team Memory

This workspace has a team memory knowledge base available via the \`team-memory\` MCP.

**Before starting any task**, use \`search_memories\` to find relevant context — past decisions, conventions, known issues, and domain knowledge. This avoids repeating mistakes and ensures consistency with previous choices.

**After completing a task**, if you discovered something valuable (a decision, a gotcha, a convention, domain insight), use \`add_memory\` to capture it for the team.

Available tools: \`search_memories\`, \`get_memory\`, \`add_memory\`, \`list_memories\`, \`archive_memory\`, \`remove_memory\`.`);
  }

  const designSectionOpenCode = buildDesignSection(config);
  if (designSectionOpenCode) sections.push(designSectionOpenCode);

  const agentTeamsSectionOpenCode = buildAgentTeamsSection(config.mcps);
  if (agentTeamsSectionOpenCode) sections.push(agentTeamsSectionOpenCode);

  const agentTeamsChatSectionOpenCode = buildAgentTeamsChatSection(config.mcps);
  if (agentTeamsChatSectionOpenCode) sections.push(agentTeamsChatSectionOpenCode);

  const kanbanSectionOpenCode = buildKanbanSection(config.mcps);
  if (kanbanSectionOpenCode) sections.push(kanbanSectionOpenCode);

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, use the \`@debugger\` agent directly.
It will:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose a solution or call coding agents to implement the fix`);

  sections.push(...buildCoreBehaviorSections());

  if (prompt?.sections) {
    const reservedKeys = new Set(["after_repositories", "after_pipeline", "after_delivery"]);
    for (const [name, content] of Object.entries(prompt.sections)) {
      if (reservedKeys.has(name)) continue;
      const title = name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      sections.push(`\n## ${title}\n\n${content.trim()}`);
    }
  }

  if (prompt?.append) {
    sections.push(`\n${prompt.append.trim()}`);
  }

  return sections.join("\n");
}

function buildOpenCodePipelineSection(steps: WorkflowStep[]): string {
  if (steps.length === 0) {
    return `
## Development Pipeline

1. Use \`@refinement\` to collect requirements
2. Use \`@coding-backend\` and/or \`@coding-frontend\` agents to implement
3. Use \`@code-reviewer\` to review the implementation
4. Use \`@qa-backend\` and/or \`@qa-frontend\` to test
5. Create PRs and notify the team`;
  }

  const parts: string[] = [`
## Development Pipeline
`];

  for (const step of steps) {
    if (step.actions) {
      parts.push(`### Delivery`);
      parts.push(`After all validations pass, execute these actions:`);
      for (const action of step.actions) {
        parts.push(`- ${formatAction(action)}`);
      }
      continue;
    }

    const stepTitle = step.step.charAt(0).toUpperCase() + step.step.slice(1);
    parts.push(`### ${stepTitle}`);

    if (step.mode === "plan") {
      parts.push(`**This step is a planning phase.** Switch to the Plan agent (Tab key) for collaborative planning with the user before any implementation begins.`);
      parts.push(``);
    }

    if (step.agent) {
      parts.push(`Call \`@${step.agent}\`.${step.output ? ` It writes to \`${step.output}\`.` : ""}`);

      if (step.step === "refinement") {
        parts.push(`
After it runs, read the document and validate with the user:
- If there are unanswered questions, ask the user one at a time
- If the user requests adjustments, send back to the refinement agent
- Do not proceed until the document is complete and approved by the user`);
      }
    }

    if (Array.isArray(step.agents)) {
      const agentList = step.agents.map((a) => {
        if (typeof a === "string") return { agent: a };
        return a;
      });

      if (step.parallel) {
        parts.push(`Call these agents in parallel:`);
      } else {
        parts.push(`Call these agents in sequence:`);
      }

      for (const a of agentList) {
        let line = `- \`@${a.agent}\``;
        if (a.output) line += ` → writes to \`${a.output}\``;
        if (a.when) line += ` (when: ${a.when})`;
        parts.push(line);
      }

      if (step.step === "coding" || step.step === "code" || step.step === "implementation") {
        parts.push(`
If any coding agent has doubts, they will write questions in their document. Apply the same Q&A logic as refinement — validate with the user before proceeding.`);
      }

      if (step.step === "validation" || step.step === "review" || step.step === "qa") {
        parts.push(`
If any validation agent leaves comments requiring fixes, call the relevant coding agents again to address them.`);
      }
    }

    if (step.mode === "plan") {
      parts.push(`
**After this step is complete and approved**, switch back to Build agent to proceed with the next step.`);
    }

    parts.push("");
  }

  return parts.join("\n");
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
    "Development orchestrator. Delegates specialized work to subagents following a structured pipeline: refinement, coding, review, QA, and delivery.",
    orchestratorContent
  );
  await writeFile(join(opencodeDir, "agents", "orchestrator.md"), orchestratorAgent, "utf-8");
  console.log(chalk.green("  Generated .opencode/agents/orchestrator.md (primary agent)"));
  await rm(join(opencodeDir, "rules", "orchestrator.md")).catch(() => {});

  await writeFile(join(hubDir, "AGENTS.md"), orchestratorContent + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

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

  const agentsDir = resolve(hubDir, "agents");
  try {
    const agentFiles = await readdir(agentsDir);
    const mdFiles = agentFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      if (file === "orchestrator.md") continue;
      const content = await readFile(join(agentsDir, file), "utf-8");
      const agentName = file.replace(/\.md$/, "");
      const converted = buildOpenCodeAgentMarkdown(agentName, content);
      await writeFile(join(opencodeDir, "agents", file), converted, "utf-8");
    }
    console.log(chalk.green(`  Copied ${mdFiles.length} agents to .opencode/agents/`));
  } catch {
    console.log(chalk.yellow("  No agents/ directory found, skipping agent copy"));
  }

  const skillsDir = resolve(hubDir, "skills");
  try {
    const skillFolders = await readdir(skillsDir);
    let count = 0;
    for (const folder of skillFolders) {
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
  const taskFolder = config.workflow?.task_folder || "./tasks/<TASK_ID>/";
  const steps = config.workflow?.pipeline || [];
  const prompt = config.workflow?.prompt;
  const enforce = config.workflow?.enforce_workflow ?? false;

  const sections: string[] = [];

  sections.push(`# Orchestrator

## Your Main Responsibility

You are the development orchestrator. Your job is to ensure that any feature or task requested by the user is completed end-to-end by following a structured pipeline. You delegate specialized work to subagents defined in \`.kiro/agents/\`.

> **Note:** This workspace has custom subagents in \`.kiro/agents/\`. Each pipeline step delegates to the appropriate subagent. Use \`/agent-name\` or instruct Kiro to "use the X subagent" to invoke them.`);

  if (enforce) {
    sections.push(`
## STRICT WORKFLOW ENFORCEMENT

**YOU MUST FOLLOW THE PIPELINE DEFINED BELOW. NO EXCEPTIONS.**

- NEVER skip a pipeline step, even if the task seems simple or obvious.
- ALWAYS execute steps in the exact order defined. Do not reorder, merge, or parallelize steps unless the pipeline explicitly allows it.
- ALWAYS use the designated subagent for each step. Do not improvise if a subagent is assigned.
- ALWAYS wait for a step to complete and validate its output before moving to the next step.
- If a step produces a document, READ the document and confirm it is complete before proceeding.
- If a step has unanswered questions or validation issues, RESOLVE them before advancing.
- NEVER jump directly to coding without completing refinement first.
- NEVER skip review or QA steps, even for small changes.
- If the user asks you to skip a step, explain why the pipeline exists and ask for explicit confirmation before proceeding.`);
  }

  if (prompt?.prepend) {
    sections.push(`\n${prompt.prepend.trim()}`);
  }

  if (config.integrations?.linear) {
    const linear = config.integrations.linear;
    sections.push(`
## Task Management

If the user doesn't have a task in their project management tool, create one using the Linear MCP.${linear.team ? ` Add it to the **${linear.team}** team.` : ""} Provide the link to the user so they can review and modify as needed.`);
  }

  sections.push(`
## Repositories
`);
  for (const repo of config.repos) {
    const parts = [`- **${repo.path}**`];
    if (repo.description) parts.push(`— ${repo.description}`);
    else if (repo.tech) parts.push(`— ${repo.tech}`);
    if (repo.skills?.length) parts.push(`(skills: ${repo.skills.join(", ")})`);
    sections.push(parts.join(" "));

    if (repo.commands) {
      const cmds = Object.entries(repo.commands)
        .filter(([, v]) => v)
        .map(([k, v]) => `\`${k}\`: \`${v}\``)
        .join(", ");
      if (cmds) sections.push(`  Commands: ${cmds}`);
    }
  }

  if (prompt?.sections?.after_repositories) {
    sections.push(`\n${prompt.sections.after_repositories.trim()}`);
  }

  const docStructure = buildDocumentStructure(steps, taskFolder);
  sections.push(docStructure);

  const pipelineSection = buildKiroPipelineSection(steps);
  sections.push(pipelineSection);

  if (prompt?.sections?.after_pipeline) {
    sections.push(`\n${prompt.sections.after_pipeline.trim()}`);
  }

  if (config.integrations?.slack || config.integrations?.github) {
    sections.push(buildDeliverySection(config));
  }

  if (prompt?.sections?.after_delivery) {
    sections.push(`\n${prompt.sections.after_delivery.trim()}`);
  }

  const mcpToolsSectionKiro = buildMcpToolsSection(config.mcps);
  if (mcpToolsSectionKiro) {
    sections.push(mcpToolsSectionKiro);
  }

  if (config.memory) {
    sections.push(`
## Team Memory

This workspace has a team memory knowledge base available via the \`team-memory\` MCP.

**Before starting any task**, use \`search_memories\` to find relevant context — past decisions, conventions, known issues, and domain knowledge. This avoids repeating mistakes and ensures consistency with previous choices.

**After completing a task**, if you discovered something valuable (a decision, a gotcha, a convention, domain insight), use \`add_memory\` to capture it for the team.

Available tools: \`search_memories\`, \`get_memory\`, \`add_memory\`, \`list_memories\`, \`archive_memory\`, \`remove_memory\`.`);
  }

  const designSectionKiro = buildDesignSection(config);
  if (designSectionKiro) sections.push(designSectionKiro);

  const agentTeamsSectionKiro = buildAgentTeamsSection(config.mcps);
  if (agentTeamsSectionKiro) sections.push(agentTeamsSectionKiro);

  const agentTeamsChatSectionKiro = buildAgentTeamsChatSection(config.mcps);
  if (agentTeamsChatSectionKiro) sections.push(agentTeamsChatSectionKiro);

  const kanbanSectionKiro = buildKanbanSection(config.mcps);
  if (kanbanSectionKiro) sections.push(kanbanSectionKiro);

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, follow the debugging process from the \`agent-debugger.md\` steering file (if available), or:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose and implement the fix`);

  sections.push(...buildCoreBehaviorSections());

  if (prompt?.sections) {
    const reservedKeys = new Set(["after_repositories", "after_pipeline", "after_delivery"]);
    for (const [name, content] of Object.entries(prompt.sections)) {
      if (reservedKeys.has(name)) continue;
      const title = name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      sections.push(`\n## ${title}\n\n${content.trim()}`);
    }
  }

  if (prompt?.append) {
    sections.push(`\n${prompt.append.trim()}`);
  }

  return sections.join("\n");
}

function buildKiroPipelineSection(steps: WorkflowStep[]): string {
  if (steps.length === 0) {
    return `
## Development Pipeline

Follow each step sequentially, delegating to the appropriate subagent:

1. **Refinement** — Use the \`refinement\` subagent to collect requirements. Write output to the task document.
2. **Coding** — Use the \`coding-backend\` and \`coding-frontend\` subagents to implement the feature.
3. **Review** — Use the \`code-reviewer\` subagent to review the implementation.
4. **QA** — Use the \`qa-backend\` and/or \`qa-frontend\` subagents to test.
5. **Delivery** — Create PRs and notify the team.`;
  }

  const parts: string[] = [`
## Development Pipeline

Follow each step sequentially, delegating to the appropriate subagent at each phase.
`];

  for (const step of steps) {
    if (step.actions) {
      parts.push(`### Delivery`);
      parts.push(`After all validations pass, execute these actions:`);
      for (const action of step.actions) {
        parts.push(`- ${formatAction(action)}`);
      }
      continue;
    }

    const stepTitle = step.step.charAt(0).toUpperCase() + step.step.slice(1);
    parts.push(`### ${stepTitle}`);

    if (step.mode === "plan") {
      parts.push(`**This step is a planning phase.** Do NOT make any code changes. Focus on reading, analyzing, and collaborating with the user to define requirements before proceeding.`);
      parts.push(``);
    }

    if (step.agent) {
      parts.push(`Use the \`${step.agent}\` subagent.${step.output ? ` Write output to \`${step.output}\`.` : ""}`);

      if (step.step === "refinement") {
        parts.push(`
After completing the refinement, validate with the user:
- If there are unanswered questions, ask the user one at a time
- If the user requests adjustments, revisit the refinement
- Do not proceed until the document is complete and approved by the user`);
      }
    }

    if (Array.isArray(step.agents)) {
      const agentList = step.agents.map((a) => {
        if (typeof a === "string") return { agent: a };
        return a;
      });

      parts.push(`Use these subagents sequentially:`);

      for (const a of agentList) {
        let line = `- \`${a.agent}\``;
        if (a.output) line += ` → write to \`${a.output}\``;
        if (a.when) line += ` (when: ${a.when})`;
        parts.push(line);
      }

      if (step.step === "coding" || step.step === "code" || step.step === "implementation") {
        parts.push(`
If you encounter doubts during coding, write questions in the task document and validate with the user before proceeding.`);
      }

      if (step.step === "validation" || step.step === "review" || step.step === "qa") {
        parts.push(`
If any validation step reveals issues requiring fixes, go back to the relevant coding step to address them.`);
      }
    }

    parts.push("");
  }

  return parts.join("\n");
}


function buildOrchestratorRule(config: HubConfig): string {
  const taskFolder = config.workflow?.task_folder || "./tasks/<TASK_ID>/";
  const steps = config.workflow?.pipeline || [];
  const prompt = config.workflow?.prompt;
  const enforce = config.workflow?.enforce_workflow ?? false;

  const sections: string[] = [];

  sections.push(`---
description: "Orchestrator agent — coordinates sub-agents through the development pipeline"
alwaysApply: true
---

# Orchestrator

## Your Main Responsibility

You are an agent orchestrator. Your job is to ensure that any feature or task requested by the user is completed end-to-end using specialized sub-agents.`);

  if (enforce) {
    sections.push(`
## STRICT WORKFLOW ENFORCEMENT

**YOU MUST FOLLOW THE PIPELINE DEFINED BELOW. NO EXCEPTIONS.**

- NEVER skip a pipeline step, even if the task seems simple or obvious.
- ALWAYS execute steps in the exact order defined. Do not reorder, merge, or parallelize steps unless the pipeline explicitly allows it.
- ALWAYS call the designated sub-agent for each step. Do not attempt to perform a step yourself if an agent is assigned to it.
- ALWAYS wait for a step to complete and validate its output before moving to the next step.
- If a step produces a document, READ the document and confirm it is complete before proceeding.
- If a step has unanswered questions or validation issues, RESOLVE them before advancing.
- NEVER jump directly to coding without completing refinement first.
- NEVER skip review or QA steps, even for small changes.
- If the user asks you to skip a step, explain why the pipeline exists and ask for explicit confirmation before proceeding.`);
  }

  if (prompt?.prepend) {
    sections.push(`\n${prompt.prepend.trim()}`);
  }

  if (config.integrations?.linear) {
    const linear = config.integrations.linear;
    sections.push(`
## Task Management

If the user doesn't have a task in their project management tool, create one using the Linear MCP.${linear.team ? ` Add it to the **${linear.team}** team.` : ""} Provide the link to the user so they can review and modify as needed.`);
  }

  sections.push(`
## Repositories
`);
  for (const repo of config.repos) {
    const parts = [`- **${repo.path}**`];
    if (repo.description) parts.push(`— ${repo.description}`);
    else if (repo.tech) parts.push(`— ${repo.tech}`);
    if (repo.skills?.length) parts.push(`(skills: ${repo.skills.join(", ")})`);
    sections.push(parts.join(" "));

    if (repo.commands) {
      const cmds = Object.entries(repo.commands)
        .filter(([, v]) => v)
        .map(([k, v]) => `\`${k}\`: \`${v}\``)
        .join(", ");
      if (cmds) sections.push(`  Commands: ${cmds}`);
    }
  }

  if (prompt?.sections?.after_repositories) {
    sections.push(`\n${prompt.sections.after_repositories.trim()}`);
  }

  const docStructure = buildDocumentStructure(steps, taskFolder);
  sections.push(docStructure);

  const pipelineSection = buildPipelineSection(steps);
  sections.push(pipelineSection);

  if (prompt?.sections?.after_pipeline) {
    sections.push(`\n${prompt.sections.after_pipeline.trim()}`);
  }

  if (config.integrations?.slack || config.integrations?.github) {
    sections.push(buildDeliverySection(config));
  }

  if (prompt?.sections?.after_delivery) {
    sections.push(`\n${prompt.sections.after_delivery.trim()}`);
  }

  const mcpToolsSectionCursor = buildMcpToolsSection(config.mcps);
  if (mcpToolsSectionCursor) {
    sections.push(mcpToolsSectionCursor);
  }

  if (config.memory) {
    sections.push(`
## Team Memory

This workspace has a team memory knowledge base available via the \`team-memory\` MCP.

**Before starting any task**, use \`search_memories\` to find relevant context — past decisions, conventions, known issues, and domain knowledge. This avoids repeating mistakes and ensures consistency with previous choices.

**After completing a task**, if you discovered something valuable (a decision, a gotcha, a convention, domain insight), use \`add_memory\` to capture it for the team.

Available tools: \`search_memories\`, \`get_memory\`, \`add_memory\`, \`list_memories\`, \`archive_memory\`, \`remove_memory\`.`);
  }

  const designSectionCursor = buildDesignSection(config);
  if (designSectionCursor) sections.push(designSectionCursor);

  const agentTeamsSectionCursor = buildAgentTeamsSection(config.mcps);
  if (agentTeamsSectionCursor) sections.push(agentTeamsSectionCursor);

  const agentTeamsChatSectionCursor = buildAgentTeamsChatSection(config.mcps);
  if (agentTeamsChatSectionCursor) sections.push(agentTeamsChatSectionCursor);

  const kanbanSectionCursor = buildKanbanSection(config.mcps);
  if (kanbanSectionCursor) sections.push(kanbanSectionCursor);

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, use the \`debugger\` agent directly.
It will:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose a solution or call coding agents to implement the fix`);

  sections.push(...buildCoreBehaviorSections());

  if (prompt?.sections) {
    const reservedKeys = new Set(["after_repositories", "after_pipeline", "after_delivery"]);
    for (const [name, content] of Object.entries(prompt.sections)) {
      if (reservedKeys.has(name)) continue;
      const title = name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      sections.push(`\n## ${title}\n\n${content.trim()}`);
    }
  }

  if (prompt?.append) {
    sections.push(`\n${prompt.append.trim()}`);
  }

  return sections.join("\n");
}

function buildDocumentStructure(steps: WorkflowStep[], taskFolder: string): string {
  const outputs: string[] = [];

  for (const step of steps) {
    if (step.output) {
      outputs.push(step.output);
    }
    if (Array.isArray(step.agents)) {
      for (const a of step.agents) {
        if (typeof a === "object" && a.output) {
          outputs.push(a.output);
        }
      }
    }
  }

  if (outputs.length === 0) {
    outputs.push("refinement.md", "code-backend.md", "code-frontend.md", "code-review.md", "qa-backend.md", "qa-frontend.md");
  }

  const tree = outputs.map((o) => `├── ${o}`);
  if (tree.length > 0) {
    tree[tree.length - 1] = tree[tree.length - 1].replace("├──", "└──");
  }

  return `
## Document Structure

All task documents are stored in \`${taskFolder}\`:

\`\`\`
${taskFolder}
${tree.join("\n")}
\`\`\``;
}

function buildPipelineSection(steps: WorkflowStep[]): string {
  if (steps.length === 0) {
    return `
## Development Pipeline

1. Use the \`refinement\` agent to collect requirements
2. Use \`coding-backend\` and/or \`coding-frontend\` agents to implement
3. Use \`code-reviewer\` to review the implementation
4. Use \`qa-backend\` and/or \`qa-frontend\` to test
5. Create PRs and notify the team`;
  }

  const parts: string[] = [`
## Development Pipeline
`];

  for (const step of steps) {
    if (step.actions) {
      parts.push(`### Delivery`);
      parts.push(`After all validations pass, execute these actions:`);
      for (const action of step.actions) {
        parts.push(`- ${formatAction(action)}`);
      }
      continue;
    }

    const stepTitle = step.step.charAt(0).toUpperCase() + step.step.slice(1);
    parts.push(`### ${stepTitle}`);

    if (step.mode === "plan") {
      parts.push(`**Before starting this step, switch to Plan Mode** by calling \`SwitchMode\` with \`target_mode_id: "plan"\`. This ensures collaborative planning with the user in a read-only context before any implementation begins.`);
      parts.push(``);
    }

    if (step.agent) {
      parts.push(`Call the \`${step.agent}\` agent.${step.output ? ` It writes to \`${step.output}\`.` : ""}`);

      if (step.step === "refinement") {
        parts.push(`
After it runs, read the document and validate with the user:
- If there are unanswered questions, ask the user one at a time
- If the user requests adjustments, send back to the refinement agent
- Do not proceed until the document is complete and approved by the user`);
      }
    }

    if (Array.isArray(step.agents)) {
      const agentList = step.agents.map((a) => {
        if (typeof a === "string") return { agent: a };
        return a;
      });

      if (step.parallel) {
        parts.push(`Call these agents${step.parallel ? " in parallel" : ""}:`);
      } else {
        parts.push(`Call these agents in sequence:`);
      }

      for (const a of agentList) {
        let line = `- \`${a.agent}\``;
        if (a.output) line += ` → writes to \`${a.output}\``;
        if (a.when) line += ` (when: ${a.when})`;
        parts.push(line);
      }

      if (step.step === "coding" || step.step === "code" || step.step === "implementation") {
        parts.push(`
If any coding agent has doubts, they will write questions in their document. Apply the same Q&A logic as refinement — validate with the user before proceeding.`);
      }

      if (step.step === "validation" || step.step === "review" || step.step === "qa") {
        parts.push(`
If any validation agent leaves comments requiring fixes, call the relevant coding agents again to address them.`);
      }
    }

    if (step.mode === "plan") {
      parts.push(`
**After this step is complete and approved**, switch back to Agent Mode to proceed with the next step.`);
    }

    parts.push("");
  }

  return parts.join("\n");
}

function buildDeliverySection(config: HubConfig): string {
  const parts: string[] = [`
## Delivery Details
`];

  if (config.integrations?.github) {
    const gh = config.integrations.github;
    const tool = gh.pr_tool === "mcp" ? "GitHub MCP" : "GitHub CLI";
    parts.push(`### Pull Requests`);
    parts.push(`For each repository with changes, push the branch and create a PR using the ${tool}.`);
    if (gh.pr_branch_pattern) {
      parts.push(`Branch naming pattern: \`${gh.pr_branch_pattern}\``);
    }
  }

  if (config.integrations?.slack) {
    const slack = config.integrations.slack;
    if (slack.channels) {
      parts.push(`\n### Slack Notifications`);
      for (const [purpose, channel] of Object.entries(slack.channels)) {
        parts.push(`- **${purpose}**: Post to \`${channel}\``);
      }
    }
    if (slack.templates) {
      parts.push(`\nMessage templates:`);
      for (const [name, template] of Object.entries(slack.templates)) {
        parts.push(`- **${name}**: \`${template}\``);
      }
    }
  }

  if (config.integrations?.linear) {
    parts.push(`\n### Task Management`);
    parts.push(`Update the Linear task status after PR creation.`);
  }

  return parts.join("\n");
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    "create-pr": "Create pull requests for each repository with changes",
    "notify-slack": "Send notification to the configured Slack channel",
    "notify-slack-prs": "Send PR notification to the Slack PRs channel",
    "update-linear": "Update the Linear task status",
    "update-linear-status": "Update the Linear task status to Review",
    "update-jira": "Update the Jira task status",
  };
  return map[action] || action;
}

async function generateClaudeCode(config: HubConfig, hubDir: string) {
  const claudeDir = join(hubDir, ".claude");
  await mkdir(join(claudeDir, "agents"), { recursive: true });

  const orchestratorRule = buildOrchestratorRule(config);
  const cleanedOrchestrator = orchestratorRule
    .replace(/^---[\s\S]*?---\n/m, "")
    .trim();

  await writeFile(join(hubDir, "AGENTS.md"), cleanedOrchestrator + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

  const claudeMdSections: string[] = [];
  claudeMdSections.push(cleanedOrchestrator);

  const agentsDir = resolve(hubDir, "agents");
  try {
    const agentFiles = await readdir(agentsDir);
    const mdFiles = agentFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      await copyFile(join(agentsDir, file), join(claudeDir, "agents", file));
    }
    console.log(chalk.green(`  Copied ${mdFiles.length} agents to .claude/agents/`));
  } catch {
    console.log(chalk.yellow("  No agents/ directory found, skipping agent copy"));
  }

  const skillsDir = resolve(hubDir, "skills");
  try {
    const skillFolders = await readdir(skillsDir);
    const claudeSkillsDir = join(claudeDir, "skills");
    await mkdir(claudeSkillsDir, { recursive: true });
    let count = 0;

    for (const folder of skillFolders) {
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

  const hubSteeringDirClaude = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDirClaude);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDirClaude, file), "utf-8");
      const content = stripFrontMatter(raw).trim();
      if (content) {
        claudeMdSections.push(content);
      }
    }
    if (mdFiles.length > 0) {
      console.log(chalk.green(`  Appended ${mdFiles.length} steering files to CLAUDE.md`));
    }
  } catch {
    // no steering dir
  }

  await writeFile(join(hubDir, "CLAUDE.md"), claudeMdSections.join("\n\n"), "utf-8");
  console.log(chalk.green("  Generated CLAUDE.md"));

  if (config.mcps?.length) {
    const mcpJson: Record<string, Record<string, unknown>> = {};
    const upstreamSet = getUpstreamNames(config.mcps);
    for (const mcp of config.mcps) {
      if (upstreamSet.has(mcp.name)) continue;
      if (mcp.upstreams?.length) {
        mcpJson[mcp.name] = buildProxyMcpEntry(mcp, config.mcps, buildClaudeCodeMcpEntry);
      } else {
        mcpJson[mcp.name] = buildClaudeCodeMcpEntry(mcp);
      }
    }
    await writeFile(
      join(hubDir, ".mcp.json"),
      JSON.stringify({ mcpServers: mcpJson }, null, 2) + "\n",
      "utf-8"
    );
    console.log(chalk.green("  Generated .mcp.json"));
  }

  const mcpServerNames = config.mcps?.map((m) => m.name) || [];
  const claudeSettings: Record<string, unknown> = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: {
      allow: [
        "Read(*)",
        "Edit(*)",
        "Write(*)",
        "Bash(git *)",
        "Bash(npm *)",
        "Bash(pnpm *)",
        "Bash(npx *)",
        "Bash(ls *)",
        "Bash(echo *)",
        "Bash(grep *)",
        ...mcpServerNames.map((name) => `mcp__${name}__*`),
      ],
      deny: [
        "Read(.env)",
        "Read(.env.*)",
        "Read(**/.env)",
        "Read(**/.env.*)",
        "Read(**/credentials*)",
        "Read(**/secrets*)",
        "Read(**/*.pem)",
        "Read(**/*.key)",
      ],
    },
    enableAllProjectMcpServers: true,
  };

  if (config.hooks) {
    const claudeHooks = buildClaudeHooks(config.hooks);
    if (claudeHooks) {
      claudeSettings.hooks = claudeHooks;
    }
  }

  await writeFile(
    join(claudeDir, "settings.json"),
    JSON.stringify(claudeSettings, null, 2) + "\n",
    "utf-8"
  );
  console.log(chalk.green("  Generated .claude/settings.json"));

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

  await writeFile(join(hubDir, "AGENTS.md"), kiroRule + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

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

  const agentsDir = resolve(hubDir, "agents");
  try {
    const kiroAgentsDir = join(kiroDir, "agents");
    await mkdir(kiroAgentsDir, { recursive: true });
    const agentFiles = await readdir(agentsDir);
    const mdFiles = agentFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const agentContent = await readFile(join(agentsDir, file), "utf-8");
      const kiroAgent = buildKiroAgentContent(agentContent);
      await writeFile(join(kiroAgentsDir, file), kiroAgent, "utf-8");
    }
    console.log(chalk.green(`  Copied ${mdFiles.length} agents to .kiro/agents/`));
  } catch {
    console.log(chalk.yellow("  No agents/ directory found, skipping agent copy"));
  }

  const skillsDir = resolve(hubDir, "skills");
  try {
    const skillFolders = await readdir(skillsDir);
    const kiroSkillsDir = join(kiroDir, "skills");
    await mkdir(kiroSkillsDir, { recursive: true });
    let count = 0;

    for (const folder of skillFolders) {
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


function extractEnvVarsByMcp(mcps: MCPConfig[]): { name: string; vars: string[] }[] {
  const envVarPattern = /\$\{env:([^}]+)\}/;
  const groups: { name: string; vars: string[] }[] = [];

  for (const mcp of mcps) {
    if (!mcp.env) continue;
    const vars: string[] = [];
    const seenInGroup = new Set<string>();
    for (const value of Object.values(mcp.env)) {
      const match = envVarPattern.exec(value);
      if (match && !seenInGroup.has(match[1])) {
        seenInGroup.add(match[1]);
        vars.push(match[1]);
      }
    }
    if (vars.length > 0) {
      groups.push({ name: mcp.name, vars: vars.sort() });
    }
  }

  return groups;
}

async function generateEnvExample(config: HubConfig, hubDir: string): Promise<void> {
  const groups = extractEnvVarsByMcp(config.mcps || []);

  let totalVars = 0;
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const uniqueVars = group.vars.filter((v) => !seen.has(v));
    if (uniqueVars.length === 0) continue;
    for (const v of uniqueVars) seen.add(v);

    if (lines.length > 0) lines.push("");
    lines.push(`# ${group.name}`);
    for (const v of uniqueVars) {
      lines.push(`${v}=`);
    }
    totalVars += uniqueVars.length;
  }

  const hasNotionSources = config.remote_sources?.some((s) => s.notion_page);
  if (hasNotionSources && !seen.has("NOTION_API_KEY")) {
    if (lines.length > 0) lines.push("");
    lines.push("# Remote Sources (Notion)");
    lines.push("NOTION_API_KEY=");
    totalVars++;
  }

  if (totalVars === 0) return;

  await writeFile(join(hubDir, ".env.example"), lines.join("\n") + "\n", "utf-8");
  console.log(chalk.green(`  Generated .env.example (${totalVars} vars)`));
}

function buildGitignoreLines(config: HubConfig): string[] {
  const lines = [
    "node_modules/",
    ".DS_Store",
    "",
    "# Repositories (managed by hub)",
  ];

  for (const repo of config.repos) {
    lines.push(repo.path.replace("./", ""));
  }

  lines.push(
    "",
    "# Hub local cache",
    ".hub/",
    "",
    "# Docker volumes",
    "*_data/",
    "",
    "# Environment files",
    "*.env",
    "*.env.local",
    "!.env.example",
    "",
    "# Generated files",
    "docker-compose.yml",
    "",
    "# Task documents",
    "tasks/",
  );

  if (config.memory) {
    const memPath = (config.memory.path || "memories").replace(/^\.\//, "");
    lines.push(
      "",
      "# Memory vector store (generated from markdown files)",
      `${memPath}/.lancedb/`,
    );
  }

  if (hasAgentTeamsLeadMcp(config.mcps)) {
    lines.push(
      "",
      "# Agent teams runtime data",
      ".agent-teams/",
    );
  }

  return lines;
}

export const generators: Record<string, Generator> = {
  cursor: { name: "Cursor", generate: generateCursor },
  "claude-code": { name: "Claude Code", generate: generateClaudeCode },
  kiro: { name: "Kiro", generate: generateKiro },
  opencode: { name: "OpenCode", generate: generateOpenCode },
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
  .option("-e, --editor <editor>", "Target editor (cursor, claude-code, kiro, opencode)")
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
