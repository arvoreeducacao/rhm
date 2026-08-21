import type { HubConfig, PersonaData } from "./types.js";
import type { SteeringInput } from "./claude-code-plan.js";
import { buildGitignoreLines } from "./claude-code-plan.js";
import type { EditorPlan } from "./plan-types.js";
import {
  buildCursorHooks,
  buildCursorMcpEntry,
  buildOrchestratorRule,
  buildPersonaEditorFile,
  buildProxyMcpEntry,
  getUpstreamNames,
  stripFrontMatter,
} from "./prompt-builders.js";

export interface CursorPlanInputs {
  steering?: SteeringInput[];
  persona?: PersonaData | null;
}

export function buildCursorMcpJson(config: HubConfig): string | null {
  if (!config.mcps?.length) return null;

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
  return JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n";
}

export function buildCursorignoreLines(config: HubConfig): string[] {
  const lines = ["# Re-include repositories for AI context"];
  for (const repo of config.repos) {
    const repoDir = repo.path.replace("./", "");
    lines.push(`!${repoDir}/`);
  }
  lines.push("", "# Re-include tasks for agent collaboration", "!tasks/");
  return lines;
}

export function planCursorFiles(config: HubConfig, inputs: CursorPlanInputs = {}): EditorPlan {
  const files: EditorPlan["files"] = [];

  files.push({ path: ".gitignore", content: buildGitignoreLines(config).join("\n"), kind: "managed-block" });
  files.push({ path: ".cursorignore", content: buildCursorignoreLines(config).join("\n"), kind: "managed-block" });

  const mcpJson = buildCursorMcpJson(config);
  if (mcpJson) {
    files.push({ path: ".cursor/mcp.json", content: mcpJson, kind: "file" });
  }

  const orchestratorRule = buildOrchestratorRule(config);
  files.push({ path: ".cursor/rules/orchestrator.mdc", content: orchestratorRule, kind: "file" });

  const cleanedOrchestrator = orchestratorRule.replace(/^---[\s\S]*?---\n/m, "").trim();
  files.push({ path: "AGENTS.md", content: cleanedOrchestrator + "\n", kind: "file" });

  if (inputs.persona) {
    files.push({
      path: ".cursor/rules/persona.mdc",
      content: buildPersonaEditorFile(inputs.persona, "cursor"),
      kind: "file",
    });
  }

  for (const steering of inputs.steering ?? []) {
    const content = stripFrontMatter(steering.content);
    const mdcName = steering.name.replace(/\.md$/, ".mdc");
    files.push({
      path: `.cursor/rules/${mdcName}`,
      content: `---\ndescription: "${steering.name.replace(/\.md$/, "")}"\nalwaysApply: true\n---\n\n${content}`,
      kind: "file",
    });
  }

  if (config.hooks) {
    const cursorHooks = buildCursorHooks(config.hooks);
    if (cursorHooks) {
      files.push({
        path: ".cursor/hooks.json",
        content: JSON.stringify(cursorHooks, null, 2) + "\n",
        kind: "file",
      });
    }
  }

  return { files, warnings: [] };
}
