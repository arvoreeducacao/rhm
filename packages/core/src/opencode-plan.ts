import type { HubConfig, PersonaData } from "./types.js";
import type { SteeringInput } from "./claude-code-plan.js";
import { buildGitignoreLines } from "./claude-code-plan.js";
import type { EditorPlan } from "./plan-types.js";
import {
  buildOpenCodeHooksPlugin,
  buildOpenCodeMcpEntry,
  buildOpenCodeOrchestratorRule,
  buildOpenCodePrimaryAgentMarkdown,
  buildPersonaEditorFile,
  buildProxyMcpEntry,
  getUpstreamNames,
  stripFrontMatter,
} from "./prompt-builders.js";

export interface OpenCodePlanInputs {
  steering?: SteeringInput[];
  persona?: PersonaData | null;
}

const PRIMARY_AGENT_DESCRIPTION =
  "Primary agent. Helps build and operate software across the workspace using skills, tools, and multi-repo context.";

export function buildOpenCodeConfigJson(config: HubConfig): string {
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

  return JSON.stringify(opencodeConfig, null, 2) + "\n";
}

export function planOpenCodeFiles(config: HubConfig, inputs: OpenCodePlanInputs = {}): EditorPlan {
  const files: EditorPlan["files"] = [];

  files.push({ path: ".gitignore", content: buildGitignoreLines(config).join("\n"), kind: "managed-block" });

  if (config.repos.length > 0) {
    const ignoreContent = config.repos.map((r) => `!${r.name}`).join("\n") + "\n";
    files.push({ path: ".ignore", content: ignoreContent, kind: "file" });
  }

  const orchestratorContent = buildOpenCodeOrchestratorRule(config);
  files.push({
    path: ".opencode/agents/orchestrator.md",
    content: buildOpenCodePrimaryAgentMarkdown(PRIMARY_AGENT_DESCRIPTION, orchestratorContent),
    kind: "file",
  });

  files.push({ path: "AGENTS.md", content: orchestratorContent + "\n", kind: "file" });

  if (inputs.persona) {
    files.push({
      path: ".opencode/rules/persona.md",
      content: buildPersonaEditorFile(inputs.persona, "opencode"),
      kind: "file",
    });
  }

  for (const steering of inputs.steering ?? []) {
    files.push({
      path: `.opencode/rules/${steering.name}`,
      content: stripFrontMatter(steering.content),
      kind: "file",
    });
  }

  files.push({ path: "opencode.json", content: buildOpenCodeConfigJson(config), kind: "file" });

  if (config.hooks) {
    const plugin = buildOpenCodeHooksPlugin(config.hooks);
    if (plugin) {
      files.push({ path: ".opencode/plugins/hub-hooks.js", content: plugin, kind: "file" });
    }
  }

  return { files, warnings: [] };
}
