import type { HubConfig, MCPConfig, PersonaData } from "./types.js";
import type { KiroMode } from "./cache.js";
import { buildGitignoreLines } from "./claude-code-plan.js";
import type { EditorPlan } from "./plan-types.js";
import {
  applyDisabledState,
  buildKiroMcpEntry,
  buildMcpServerMap,
  buildKiroOrchestratorRule,
  buildKiroSteeringContent,
  buildPersonaEditorFile,
  parseFrontMatter,
  stripFrontMatter,
  HOOK_EVENT_MAP,
} from "./prompt-builders.js";

export interface KiroSteeringInput {
  name: string;
  content: string;
  existingContent?: string | null;
}

export interface KiroPlanInputs {
  steering?: KiroSteeringInput[];
  persona?: PersonaData | null;
  mode?: KiroMode;
  existingMcpJson?: string | null;
}

export function parseMcpDisabledState(json: string | null | undefined): Record<string, boolean> {
  const disabledState: Record<string, boolean> = {};
  if (!json) return disabledState;
  try {
    const content = JSON.parse(json);
    const servers = (content.mcpServers || content.mcp || {}) as Record<string, Record<string, unknown>>;
    for (const [name, entry] of Object.entries(servers)) {
      if (typeof entry.disabled === "boolean") {
        disabledState[name] = entry.disabled;
      }
    }
  } catch {
    return disabledState;
  }
  return disabledState;
}

export function buildKiroMcpJson(config: HubConfig, mode: KiroMode, existingMcpJson?: string | null): string | null {
  if (!config.mcps?.length) return null;

  const mcpConfig = buildMcpServerMap(config.mcps, (mcp: MCPConfig) => buildKiroMcpEntry(mcp, mode));
  applyDisabledState(mcpConfig, parseMcpDisabledState(existingMcpJson));
  return JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n";
}

function buildSteeringFile(steering: KiroSteeringInput): string {
  const content = stripFrontMatter(steering.content);
  let inclusion: "always" | "auto" = "always";
  let meta: { name?: string; description?: string } | undefined;

  if (steering.existingContent) {
    const existingFm = parseFrontMatter(steering.existingContent);
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

  const sourceFm = parseFrontMatter(steering.content);
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

  return buildKiroSteeringContent(content, inclusion, meta);
}

export function collectKiroHookNotes(config: HubConfig): string[] {
  const hookNotes: string[] = [];
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    const mapped = HOOK_EVENT_MAP[event]?.kiro;
    if (!mapped) continue;
    for (const entry of entries) {
      hookNotes.push(`- **${mapped}**: ${entry.type === "command" ? entry.command : entry.prompt}`);
    }
  }
  return hookNotes;
}

export function planKiroFiles(config: HubConfig, inputs: KiroPlanInputs = {}): EditorPlan {
  const files: EditorPlan["files"] = [];
  const mode = inputs.mode ?? "editor";

  files.push({ path: ".gitignore", content: buildGitignoreLines(config).join("\n"), kind: "managed-block" });

  files.push({ path: "AGENTS.md", content: buildKiroOrchestratorRule(config) + "\n", kind: "file" });

  if (inputs.persona) {
    files.push({
      path: ".kiro/steering/persona.md",
      content: buildPersonaEditorFile(inputs.persona, "kiro"),
      kind: "file",
    });
  }

  for (const steering of inputs.steering ?? []) {
    files.push({
      path: `.kiro/steering/${steering.name}`,
      content: buildSteeringFile(steering),
      kind: "file",
    });
  }

  const mcpJson = buildKiroMcpJson(config, mode, inputs.existingMcpJson);
  if (mcpJson) {
    files.push({ path: ".kiro/settings/mcp.json", content: mcpJson, kind: "file" });
  }

  return { files, warnings: [], notes: collectKiroHookNotes(config) };
}
