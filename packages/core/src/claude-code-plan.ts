import type { HubConfig, PersonaData } from "./types.js";
import {
  buildCapabilitiesPrompt,
  buildClaudeCodeMcpEntry,
  buildClaudeHooks,
  buildPersonaEditorFile,
  buildProxyMcpEntry,
  getUpstreamNames,
  hasAgentTeamsLeadMcp,
  stripFrontMatter,
} from "./prompt-builders.js";

export interface PlannedFile {
  path: string;
  content: string;
  kind: "file" | "managed-block";
}

export interface SteeringInput {
  name: string;
  content: string;
}

export interface ClaudeCodePlanInputs {
  steering?: SteeringInput[];
  persona?: PersonaData | null;
}

export function buildGitignoreLines(config: HubConfig): string[] {
  const lines = [
    "node_modules/",
    ".DS_Store",
    "",
    "# Repositories (managed by hub)",
  ];

  for (const repo of config.repos) {
    lines.push(`/${repo.path.replace(/^\.\//, "")}`);
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

  lines.push(
    "",
    "# Persona (personal, not shared)",
    ".kiro/steering/persona.md",
    ".cursor/rules/persona.mdc",
    ".opencode/rules/persona.md",
    ".codex/rules/persona.md",
    "CLAUDE.local.md",
  );

  return lines;
}

export function buildClaudeCodeMcpJson(config: HubConfig): string | null {
  if (!config.mcps?.length) return null;

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
  return JSON.stringify({ mcpServers: mcpJson }, null, 2) + "\n";
}

export function buildClaudeCodeSettings(config: HubConfig): string {
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

  return JSON.stringify(claudeSettings, null, 2) + "\n";
}

export function planClaudeCodeFiles(config: HubConfig, inputs: ClaudeCodePlanInputs = {}): PlannedFile[] {
  const files: PlannedFile[] = [];

  const orchestrator = buildCapabilitiesPrompt(config, { format: "cursor-rule" })
    .replace(/^---[\s\S]*?---\n/m, "")
    .trim();

  files.push({ path: "AGENTS.md", content: orchestrator + "\n", kind: "file" });

  const claudeMdSections: string[] = [orchestrator];
  for (const steering of inputs.steering ?? []) {
    const content = stripFrontMatter(steering.content).trim();
    if (content) claudeMdSections.push(content);
  }
  files.push({ path: "CLAUDE.md", content: claudeMdSections.join("\n\n"), kind: "file" });

  if (inputs.persona) {
    files.push({
      path: "CLAUDE.local.md",
      content: buildPersonaEditorFile(inputs.persona, "claude-code"),
      kind: "file",
    });
  }

  const mcpJson = buildClaudeCodeMcpJson(config);
  if (mcpJson) {
    files.push({ path: ".mcp.json", content: mcpJson, kind: "file" });
  }

  files.push({ path: ".claude/settings.json", content: buildClaudeCodeSettings(config), kind: "file" });

  files.push({ path: ".gitignore", content: buildGitignoreLines(config).join("\n"), kind: "managed-block" });

  return files;
}
