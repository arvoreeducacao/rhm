import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir, copyFile, readFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadHubConfig, type HubConfig, type HookEntry, type MCPConfig, type WorkflowStep } from "../core/hub-config.js";
import { getSavedEditor, saveGenerateState, getKiroMode, saveKiroMode, readCache, writeCache, type KiroMode } from "../core/hub-cache.js";

const HUB_DOCS_URL = "https://hub.arvore.com.br/llms-full.txt";

function stripFrontMatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n*/);
  if (match) return content.slice(match[0].length);
  return content;
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

function buildCursorMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  if (mcp.url) {
    return { url: mcp.url, ...(mcp.env && { env: mcp.env }) };
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
  if (mcp.url) {
    return { url: mcp.url, ...(env && { env }) };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args };
  }
  return {
    command: "npx",
    args: ["-y", mcp.package!],
    ...(env && { env }),
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


function buildOpenCodeMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  if (mcp.url) {
    return { type: "remote", url: mcp.url };
  }
  if (mcp.image) {
    const cmd = ["docker", "run", "-i", "--rm"];
    if (mcp.env) {
      for (const [key, value] of Object.entries(mcp.env)) {
        cmd.push("-e", `${key}=${value}`);
      }
    }
    cmd.push(mcp.image);
    return { type: "local", command: cmd, ...(mcp.env && { environment: mcp.env }) };
  }
  return {
    type: "local",
    command: ["npx", "-y", mcp.package!],
    ...(mcp.env && { environment: mcp.env }),
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

function buildMcpToolsSection(mcps: MCPConfig[] | undefined): string {
  if (!mcps || mcps.length === 0) return "";

  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const upstreamNames = getUpstreamNames(mcps);
  const directMcps = mcps.filter((m) => !m.upstreams && !upstreamNames.has(m.name));

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
      lines.push(`- \`${name}\``);
    }
  }

  if (directMcps.length > 0) {
    lines.push(`
**MCPs available directly:**`);
    for (const mcp of directMcps) {
      lines.push(`- \`${mcp.name}\``);
    }
  }

  if (proxyMcp) {
    lines.push(`
> When you need a capability and are unsure which tool to use, always try \`mcp_search\` first with relevant keywords. The proxy aggregates tools from all upstream MCPs.`);
  }

  return lines.join("\n");
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

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, use the \`@debugger\` agent directly.
It will:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose a solution or call coding agents to implement the fix`);

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

  // Generate orchestrator rule in .opencode/rules/
  const orchestratorRule = buildOpenCodeOrchestratorRule(config);
  await writeFile(join(opencodeDir, "rules", "orchestrator.md"), orchestratorRule + "\n", "utf-8");
  console.log(chalk.green("  Generated .opencode/rules/orchestrator.md"));

  // Copy steering files from steering/ to .opencode/rules/
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

  // Generate opencode.json with MCP servers, instructions, and agent config
  const opencodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
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

  // Reference rules via glob so additional rule files are auto-discovered
  opencodeConfig.instructions = [".opencode/rules/*.md"];

  await writeFile(
    join(hubDir, "opencode.json"),
    JSON.stringify(opencodeConfig, null, 2) + "\n",
    "utf-8"
  );
  console.log(chalk.green("  Generated opencode.json"));

  // Copy agents as .opencode/agents/*.md with OpenCode frontmatter
  const agentsDir = resolve(hubDir, "agents");
  try {
    const agentFiles = await readdir(agentsDir);
    const mdFiles = agentFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const content = await readFile(join(agentsDir, file), "utf-8");
      const agentName = file.replace(/\.md$/, "");
      const converted = buildOpenCodeAgentMarkdown(agentName, content);
      await writeFile(join(opencodeDir, "agents", file), converted, "utf-8");
    }
    console.log(chalk.green(`  Copied ${mdFiles.length} agents to .opencode/agents/`));
  } catch {
    console.log(chalk.yellow("  No agents/ directory found, skipping agent copy"));
  }

  // Copy skills to .opencode/skills/
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

  // Copy commands to .opencode/commands/
  await generateEditorCommands(config, hubDir, opencodeDir, ".opencode/commands/");

  // Generate hooks plugin if hooks are defined
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

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, follow the debugging process from the \`agent-debugger.md\` steering file (if available), or:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose and implement the fix`);

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

  sections.push(`
## Troubleshooting and Debugging

For bug reports or unexpected behavior, use the \`debugger\` agent directly.
It will:
1. Collect context (symptoms, environment, timeline)
2. Analyze logs and stack traces
3. Form and test hypotheses systematically
4. Identify the root cause
5. Propose a solution or call coding agents to implement the fix`);

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

  // Copy steering files content into CLAUDE.md
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

  // Ask for Kiro usage mode (editor IDE vs CLI)
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
  const kiroOrchestrator = buildKiroSteeringContent(kiroRule);
  await writeFile(join(steeringDir, "orchestrator.md"), kiroOrchestrator, "utf-8");
  console.log(chalk.green("  Generated .kiro/steering/orchestrator.md"));

  await writeFile(join(hubDir, "AGENTS.md"), kiroRule + "\n", "utf-8");
  console.log(chalk.green("  Generated AGENTS.md"));

  const hubSteeringDir = resolve(hubDir, "steering");
  try {
    const steeringFiles = await readdir(hubSteeringDir);
    const mdFiles = steeringFiles.filter((f) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const raw = await readFile(join(hubSteeringDir, file), "utf-8");
      const content = stripFrontMatter(raw);
      const kiroSteering = buildKiroSteeringContent(content);
      await writeFile(join(steeringDir, file), kiroSteering, "utf-8");
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
    await writeFile(
      join(settingsDir, "mcp.json"),
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
    const memPath = config.memory.path || "memories";
    lines.push(
      "",
      "# Memory vector store (generated from markdown files)",
      `${memPath}/.lancedb/`,
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
  .action(async (opts: { editor?: string; resetEditor?: boolean }) => {
    const hubDir = process.cwd();
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
    await saveGenerateState(hubDir, editorKey);
    console.log(chalk.green("\nDone!\n"));
  });
