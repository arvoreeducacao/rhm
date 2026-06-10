import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HubConfig, HookEntry, MCPConfig, WorkflowStep, PersonaData } from "./types.js";
import type { KiroMode } from "./cache.js";

export const HOOK_EVENT_MAP: Record<string, { cursor?: string; claude?: string; kiro?: string; opencode?: string }> = {
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

export const SANDBOX_AGENT_TARGETS = new Set(["qa-frontend", "qa-backend", "coding-frontend", "coding-backend"]);

export function stripFrontMatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n*/);
  if (match) return content.slice(match[0].length);
  return content;
}

export function parseFrontMatter(content: string): Record<string, string> | null {
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

export function getUpstreamNames(mcps: MCPConfig[]): Set<string> {
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

export function resolveAutoApprove(mcp: MCPConfig): string[] | undefined {
  if (mcp.autoApprove === true) return ["*"];
  if (Array.isArray(mcp.autoApprove) && mcp.autoApprove.length > 0) return mcp.autoApprove;
  return undefined;
}

export function stripEnvPrefix(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{env:(\w+)\}/g, "${$1}");
  }
  return result;
}

export function stripDollarPrefix(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{env:(\w+)\}/g, "{env:$1}").replace(/\$\{(\w+)\}/g, "{env:$1}");
  }
  return result;
}

export function getSandboxMcp(config: HubConfig): { port: number } | null {
  const sandboxMcp = config.mcps?.find((m) => m.name === "sandbox" && m.url);
  if (!sandboxMcp?.url) return null;
  const match = sandboxMcp.url.match(/:(\d+)/);
  return match ? { port: parseInt(match[1], 10) } : { port: 8080 };
}

export function injectSandboxContext(agentName: string, content: string, sandboxPort: number): string {
  if (!SANDBOX_AGENT_TARGETS.has(agentName)) return content;
  const section = `
## Sandbox Environment

A sandboxed execution environment is available via the \`sandbox\` MCP (http://localhost:${sandboxPort}/mcp).

Use it to:
- Run shell commands: \`shell.exec\`
- Read/write files: \`file.read\`, \`file.write\`
- Control a real browser: \`browser.navigate\`, \`browser.screenshot\`, \`browser.click\`
- Execute code: \`jupyter.execute\`

The sandbox workspace is mounted at \`/home/gem/workspace\`. Prefer running builds, tests, and browser interactions inside the sandbox rather than on the host machine.
`;
  return content.trimEnd() + "\n" + section;
}

interface ProxyUpstreamEntry {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function buildProxyUpstreams(proxyMcp: MCPConfig, allMcps: MCPConfig[]): { upstreamsJson: string; collectedEnv: Record<string, string> } {
  const upstreamNames = new Set(proxyMcp.upstreams || []);
  const upstreamEntries: ProxyUpstreamEntry[] = [];
  const collectedEnv: Record<string, string> = {};

  for (const mcp of allMcps) {
    if (!upstreamNames.has(mcp.name)) continue;
    if (mcp.url || mcp.image) continue;

    const entry: ProxyUpstreamEntry = {
      name: mcp.name,
      command: "npx",
      args: ["-y", mcp.package!, ...(mcp.args || [])],
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

export function buildProxyMcpEntry(
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

export function buildCursorMcpEntry(mcp: MCPConfig): Record<string, unknown> {
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
    args: ["-y", mcp.package!, ...(mcp.args || [])],
    ...(mcp.env && { env: mcp.env }),
    ...(autoApprove && { autoApprove }),
  };
}

export function buildClaudeCodeMcpEntry(mcp: MCPConfig): Record<string, unknown> {
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
    args: ["-y", mcp.package!, ...(mcp.args || [])],
    ...(mcp.env && { env: mcp.env }),
  };
}

export function buildKiroMcpEntry(mcp: MCPConfig, mode: KiroMode = "editor"): Record<string, unknown> {
  const env = mcp.env
    ? mode === "editor" ? stripEnvPrefix(mcp.env) : mcp.env
    : undefined;
  const autoApprove = resolveAutoApprove(mcp);
  const extra: Record<string, unknown> = {};
  if (mcp.lifecycle) extra.lifecycle = mcp.lifecycle;
  if (mcp.idleTimeout !== undefined) extra.idleTimeout = mcp.idleTimeout;
  if (mcp.directTools !== undefined) extra.directTools = mcp.directTools;
  if (mcp.excludeTools?.length) extra.excludeTools = mcp.excludeTools;
  if (mcp.url) {
    return { url: mcp.url, ...(env && { env }), ...(autoApprove && { autoApprove }), ...extra };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args, ...(autoApprove && { autoApprove }), ...extra };
  }
  return {
    command: "npx",
    args: ["-y", mcp.package!, ...(mcp.args || [])],
    ...(env && { env }),
    ...(autoApprove && { autoApprove }),
    ...extra,
  };
}

export function buildPiMcpEntry(mcp: MCPConfig): Record<string, unknown> {
  const env = mcp.env ? stripEnvPrefix(mcp.env) : undefined;
  const extra: Record<string, unknown> = {};
  if (mcp.auth) extra.auth = mcp.auth;
  if (mcp.lifecycle) extra.lifecycle = mcp.lifecycle;
  if (mcp.idleTimeout !== undefined) extra.idleTimeout = mcp.idleTimeout;
  if (mcp.directTools !== undefined) extra.directTools = mcp.directTools;
  if (mcp.excludeTools?.length) extra.excludeTools = mcp.excludeTools;
  if (mcp.url) {
    return { url: mcp.url, ...(env && { env }), ...extra };
  }
  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    return { command: "docker", args, ...extra };
  }
  if (mcp.command) {
    return {
      command: mcp.command,
      ...(mcp.args?.length && { args: mcp.args }),
      ...(env && { env }),
      ...extra,
    };
  }
  return {
    command: "npx",
    args: ["-y", mcp.package!, ...(mcp.args || [])],
    ...(env && { env }),
    ...extra,
  };
}

export function buildOpenCodeMcpEntry(mcp: MCPConfig): Record<string, unknown> {
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
    command: ["npx", "-y", mcp.package!, ...(mcp.args || [])],
    ...(env && { environment: env }),
  };
}

export async function readExistingMcpDisabledState(mcpJsonPath: string): Promise<Record<string, boolean>> {
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

export function applyDisabledState(
  mcpConfig: Record<string, Record<string, unknown>>,
  disabledState: Record<string, boolean>
): void {
  for (const [name, entry] of Object.entries(mcpConfig)) {
    if (name in disabledState) {
      entry.disabled = disabledState[name];
    }
  }
}

export function buildCursorHooks(hooks: Record<string, HookEntry[]>): Record<string, unknown> | null {
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

export function buildClaudeHooks(hooks: Record<string, HookEntry[]>): Record<string, unknown[]> | null {
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

export function buildOpenCodeHooksPlugin(hooks: Record<string, HookEntry[]>): string | null {
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

export function buildKiroSteeringContent(content: string, inclusion: "always" | "auto" = "always", meta?: { name?: string; description?: string }): string {
  const frontMatter: string[] = ["---", `inclusion: ${inclusion}`];
  if (meta?.name) frontMatter.push(`name: ${meta.name}`);
  if (meta?.description) frontMatter.push(`description: ${meta.description}`);
  frontMatter.push("---");
  return `${frontMatter.join("\n")}\n\n${content}`;
}

export function buildKiroAgentContent(rawContent: string): string {
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

export function buildOpenCodeAgentMarkdown(name: string, content: string): string {
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

export function buildOpenCodePrimaryAgentMarkdown(description: string, body: string): string {
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

export function hasAgentTeamsLeadMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "agent-teams-lead");
  const upstreamMatch = proxyMcp?.upstreams?.includes("agent-teams-lead") ?? false;
  return directMatch || upstreamMatch;
}

export function hasAgentTeamsChatMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "agent-teams-chat");
  const upstreamMatch = proxyMcp?.upstreams?.includes("agent-teams-chat") ?? false;
  return directMatch || upstreamMatch;
}

export function hasKanbanMcp(mcps: MCPConfig[] | undefined): boolean {
  if (!mcps) return false;
  const proxyMcp = mcps.find((m) => m.upstreams && m.upstreams.length > 0);
  const directMatch = mcps.some((m) => m.name === "kanban" || m.package === "@arvoretech/kanban-mcp");
  const upstreamMatch = proxyMcp?.upstreams?.includes("kanban") ?? false;
  return directMatch || upstreamMatch;
}

export function buildDesignSection(config: HubConfig): string | null {
  const design = config.design;
  if (!design) return null;

  const hasContent = design.skills?.length || design.libraries?.length || design.icons || design.instructions;
  if (!hasContent) return null;

  const parts: string[] = [];
  parts.push(`\n## Design System`);

  if (design.enforce && design.skills?.length) {
    const skillList = design.skills.map((s) => `\`${s}\``).join(", ");
    parts.push(`
**DESIGN ENFORCEMENT — MANDATORY**

Before creating or modifying ANY UI component, page, or visual element:
1. Consult the design skill(s): ${skillList}
2. Use ONLY the design tokens, colors, spacing, and typography defined in the design system
3. Do NOT invent custom styles, colors, or spacing values — always reference the design tokens
4. If a component exists in the design system or component library, use it instead of creating a new one
5. After implementing UI changes, verify that the output follows the design system guidelines`);
  }

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

export function buildMcpToolsSection(mcps: MCPConfig[] | undefined): string {
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

  const mcpsWithInstructions = mcps.filter((m) => m.instructions);
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

export function buildMemorySection(config: HubConfig): string {
  const enforce = config.memory?.enforce ?? false;

  if (enforce) {
    return `
## Team Memory — MANDATORY

This workspace has a team memory knowledge base via the \`team-memory\` MCP.
The MCP automatically generates a steering file (\`team-memories-index\`) with an index of all active memories. This file is always included in your context.

**Use the index first.** You already know what memories exist — check the steering file before calling any MCP tool.

### How to use memories:
1. **Read the index** — the \`team-memories-index\` steering file lists all active memories with title, category, tags, and ID
2. **Get full content** — use \`get_memory(id)\` when you need the complete context of a specific memory
3. **Semantic search** — use \`search_memories\` only when you need fuzzy/semantic matching beyond what the index shows
4. **Capture knowledge** — use \`add_memory\` when you discover decisions, conventions, gotchas, or domain insights during work

### When completing work:
- If you discovered something valuable (a decision, a gotcha, a convention, a domain insight, a debugging finding), use \`add_memory\` to capture it
- Be specific: include context, rationale, and affected areas
- Use appropriate categories: decisions, conventions, incidents, domain, gotchas

### Why this matters:
- Memories contain institutional knowledge that prevents repeated mistakes
- Past decisions explain WHY things are the way they are
- Conventions ensure consistency across the team
- Gotchas save hours of debugging

Available tools: \`search_memories\`, \`get_memory\`, \`add_memory\`, \`list_memories\`, \`archive_memory\`, \`remove_memory\`.`;
  }

  return `
## Team Memory

This workspace has a team memory knowledge base available via the \`team-memory\` MCP.
The MCP automatically generates a steering file (\`team-memories-index\`) with an index of all active memories.

**Check the index first** — use \`get_memory(id)\` for full content, and \`search_memories\` only for semantic search beyond the index.

**After completing a task**, if you discovered something valuable (a decision, a gotcha, a convention, domain insight), use \`add_memory\` to capture it for the team.

Available tools: \`search_memories\`, \`get_memory\`, \`add_memory\`, \`list_memories\`, \`archive_memory\`, \`remove_memory\`.`;
}

export function buildFetchCheckerSection(): string {
  return `
## Fact Checker — Mandatory Verification

**NEVER state the status of any external resource without verifying it first.**

Before making ANY claim about:
- PR status (merged, open, closed, approved, changes requested)
- Branch state (ahead, behind, conflicts, existence)
- Deploy status (deployed, failed, in progress)
- CI/CD pipeline results (passed, failed, running)
- Issue/task status (open, closed, in progress)
- Service health (up, down, degraded)
- Any other external state that can change over time

You MUST:
1. Use the appropriate tool to check the actual current state (GitHub CLI, MCP tools, git commands, etc.)
2. Only THEN report the result to the user
3. If you cannot verify, explicitly say "I was unable to verify this — please check manually"

**NEVER assume, guess, or rely on cached/stale information.** Every claim about external state must be backed by a fresh check.
This applies to ALL agents in the pipeline, not just the orchestrator.`;
}

export function buildCoreBehaviorSections(): string[] {
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

export function buildDeliverySection(config: HubConfig): string {
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

export function formatAction(action: string): string {
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

export function buildDocumentStructure(steps: WorkflowStep[], taskFolder: string): string {
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

export function buildAgentTeamsSection(mcps: MCPConfig[] | undefined): string {
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

export function buildAgentTeamsChatSection(mcps: MCPConfig[] | undefined): string {
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

export function buildKanbanSection(mcps: MCPConfig[] | undefined): string {
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

export function buildPipelineSection(steps: WorkflowStep[]): string {
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

export function buildKiroPipelineSection(steps: WorkflowStep[]): string {
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

export function buildOpenCodePipelineSection(steps: WorkflowStep[]): string {
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

export function buildKiroOrchestratorRule(config: HubConfig): string {
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
    sections.push(buildMemorySection(config));
  }

  if (config.workflow?.fact_checker) {
    sections.push(buildFetchCheckerSection());
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

export function buildOrchestratorRule(config: HubConfig): string {
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

  sections.push(buildDocumentStructure(steps, taskFolder));
  sections.push(buildPipelineSection(steps));

  if (prompt?.sections?.after_pipeline) {
    sections.push(`\n${prompt.sections.after_pipeline.trim()}`);
  }

  if (config.integrations?.slack || config.integrations?.github) {
    sections.push(buildDeliverySection(config));
  }

  if (prompt?.sections?.after_delivery) {
    sections.push(`\n${prompt.sections.after_delivery.trim()}`);
  }

  const mcpToolsSection = buildMcpToolsSection(config.mcps);
  if (mcpToolsSection) sections.push(mcpToolsSection);

  if (config.memory) sections.push(buildMemorySection(config));
  if (config.workflow?.fact_checker) sections.push(buildFetchCheckerSection());

  const designSection = buildDesignSection(config);
  if (designSection) sections.push(designSection);

  const agentTeamsSection = buildAgentTeamsSection(config.mcps);
  if (agentTeamsSection) sections.push(agentTeamsSection);

  const agentTeamsChatSection = buildAgentTeamsChatSection(config.mcps);
  if (agentTeamsChatSection) sections.push(agentTeamsChatSection);

  const kanbanSection = buildKanbanSection(config.mcps);
  if (kanbanSection) sections.push(kanbanSection);

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

export function buildOpenCodeOrchestratorRule(config: HubConfig): string {
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

  sections.push(buildDocumentStructure(steps, taskFolder));
  sections.push(buildOpenCodePipelineSection(steps));

  if (prompt?.sections?.after_pipeline) {
    sections.push(`\n${prompt.sections.after_pipeline.trim()}`);
  }

  if (config.integrations?.slack || config.integrations?.github) {
    sections.push(buildDeliverySection(config));
  }

  if (prompt?.sections?.after_delivery) {
    sections.push(`\n${prompt.sections.after_delivery.trim()}`);
  }

  const mcpToolsSection = buildMcpToolsSection(config.mcps);
  if (mcpToolsSection) sections.push(mcpToolsSection);

  if (config.memory) sections.push(buildMemorySection(config));
  if (config.workflow?.fact_checker) sections.push(buildFetchCheckerSection());

  const designSection = buildDesignSection(config);
  if (designSection) sections.push(designSection);

  const agentTeamsSection = buildAgentTeamsSection(config.mcps);
  if (agentTeamsSection) sections.push(agentTeamsSection);

  const agentTeamsChatSection = buildAgentTeamsChatSection(config.mcps);
  if (agentTeamsChatSection) sections.push(agentTeamsChatSection);

  const kanbanSection = buildKanbanSection(config.mcps);
  if (kanbanSection) sections.push(kanbanSection);

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

export async function buildSkillsSection(hubDir: string, config: HubConfig): Promise<string | null> {
  const skillsDir = resolve(hubDir, "skills");
  const skillEntries: { name: string; description: string }[] = [];

  try {
    const folders = await readdir(skillsDir);
    for (const folder of folders) {
      const skillPath = join(skillsDir, folder, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        const fm = parseFrontMatter(content);
        if (fm?.name) {
          skillEntries.push({
            name: fm.name,
            description: fm.description || "",
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    return null;
  }

  if (skillEntries.length === 0) return null;

  const repoSkillMap = new Map<string, string[]>();
  for (const repo of config.repos) {
    if (repo.skills?.length) {
      for (const skill of repo.skills) {
        const repos = repoSkillMap.get(skill) || [];
        repos.push(repo.path);
        repoSkillMap.set(skill, repos);
      }
    }
  }

  const parts: string[] = [];
  parts.push(`
## Skills

This workspace has skills that provide specialized knowledge for specific domains and repositories.
Consult the relevant skill before working in an unfamiliar area — they contain patterns, conventions, and project-specific guidance.

| Skill | Description | Repositories |
|-------|-------------|--------------|`);

  for (const entry of skillEntries) {
    const repos = repoSkillMap.get(entry.name);
    const repoCol = repos ? repos.map(r => `\`${r}\``).join(", ") : "—";
    const desc = entry.description.replace(/\|/g, "\\|").split(".")[0].trim();
    parts.push(`| \`${entry.name}\` | ${desc} | ${repoCol} |`);
  }

  parts.push(`
When to consult a skill:
- Before writing code in a repository that has an associated skill
- When making architecture or pattern decisions in a specific domain
- When unsure about project conventions, libraries, or testing approaches
- When the user's request touches a domain covered by an available skill

Additional context sources:
- Use documentation MCPs to check library and framework docs before implementing
- Use database MCPs to understand schema, query data, and verify state
- Use package registry MCPs to verify security and versions before installing dependencies
- Use the repository CLI commands (build, test, lint) to validate changes after implementation
- Use monitoring MCPs for production debugging and log analysis when available`);

  return parts.join("\n");
}

export async function loadPersona(hubDir: string): Promise<PersonaData | null> {
  const personaPath = join(hubDir, ".hub", "persona.yaml");
  if (!existsSync(personaPath)) return null;
  try {
    const { parse } = await import("yaml");
    const content = await readFile(personaPath, "utf-8");
    return parse(content) as PersonaData;
  } catch {
    return null;
  }
}

export function buildPersonaSection(persona: PersonaData): string {
  const lines: string[] = [];

  lines.push(`\n## User Persona\n`);
  lines.push(`You are talking to **${persona.name}**, who is a **${persona.role}**.`);

  if (persona.technical_level === "non-technical") {
    lines.push(`
${persona.name} is not technical. Adapt your communication:
- Never use jargon, acronyms, or technical terms without explaining them in plain language first.
- Explain decisions in terms of business impact, user experience, and outcomes — not implementation details.
- When showing progress, focus on what changed for the user/product, not what code was modified.
- If you need to mention something technical, use analogies and simple language.
- Keep responses short and focused on what matters to them.
- When asking questions, frame them as business/product decisions, not technical choices.
- Never show code snippets, terminal output, or file paths unless explicitly asked.`);
  } else if (persona.technical_level === "beginner") {
    lines.push(`
${persona.name} is learning and not deeply technical yet. Adapt your communication:
- Explain technical concepts briefly when you first mention them.
- Avoid deep implementation details unless asked.
- Use simple language but don't shy away from introducing technical terms with context.
- When showing code or commands, briefly explain what they do.
- Be encouraging and patient — frame things as learning opportunities.`);
  } else if (persona.technical_level === "intermediate") {
    lines.push(`
${persona.name} is comfortable with code but may not know every tool or pattern. Adapt your communication:
- Use technical language normally but explain niche or advanced concepts when relevant.
- Show code and commands without excessive explanation, but add context for non-obvious decisions.
- Focus on the "why" behind architectural choices.`);
  } else {
    lines.push(`
${persona.name} is an experienced developer. Communicate directly:
- Be concise and technical. Skip basic explanations.
- Focus on trade-offs, edge cases, and non-obvious implications.
- Show code directly without hand-holding.`);
  }

  if (persona.focus_areas) {
    lines.push(`\n${persona.name} focuses on: ${persona.focus_areas}. Prioritize these areas in suggestions and discussions.`);
  }

  if (persona.aws_profiles?.length) {
    lines.push(`\n### AWS Profiles\n`);
    for (const profile of persona.aws_profiles) {
      lines.push(`- \`${profile.name}\`: ${profile.description}`);
    }
    lines.push(`\nWhen running AWS commands, ask which environment if not clear from context.`);
  }

  if (persona.github_username) {
    lines.push(`\nGitHub username: **${persona.github_username}**`);
  }

  if (persona.timezone) {
    lines.push(`\nTimezone: ${persona.timezone}`);
  }

  if (persona.context) {
    lines.push(`\nAdditional context about ${persona.name}: ${persona.context}`);
  }

  if (persona.language && persona.language.toLowerCase() !== "english") {
    lines.push(`\nAlways communicate with ${persona.name} in **${persona.language}**.`);
  }

  return lines.join("\n");
}

export function buildPersonaEditorFile(persona: PersonaData, editor: "kiro" | "cursor" | "claude-code" | "opencode"): string {
  const content = buildPersonaSection(persona);

  if (editor === "kiro") {
    return `---\ninclusion: always\nname: persona\n---\n\n# Persona — ${persona.name}\n${content}\n`;
  }

  if (editor === "cursor") {
    return `---\ndescription: "Personal AI profile for ${persona.name}"\nalwaysApply: true\n---\n\n# Persona — ${persona.name}\n${content}\n`;
  }

  return `# Persona — ${persona.name}\n${content}\n`;
}
