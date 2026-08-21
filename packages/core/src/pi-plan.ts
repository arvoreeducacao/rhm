import type { HubConfig } from "./types.js";
import { resolvePiConfig } from "./config.js";
import type { SteeringInput } from "./claude-code-plan.js";
import { buildGitignoreLines } from "./claude-code-plan.js";
import type { EditorPlan } from "./plan-types.js";
import { buildCapabilitiesPrompt, stripFrontMatter } from "./prompt-builders.js";

export const HUB_PI_PACKAGE = "npm:@arvoretech/hub-pi";

export interface PiPlanInputs {
  steering?: SteeringInput[];
  existingSettings?: Record<string, unknown> | null;
}

export function buildPiSettingsJson(existingSettings?: Record<string, unknown> | null): string {
  const settings: Record<string, unknown> = { ...(existingSettings ?? {}) };

  const packages = Array.isArray(settings.packages) ? [...(settings.packages as string[])] : [];
  if (!packages.includes(HUB_PI_PACKAGE)) {
    packages.push(HUB_PI_PACKAGE);
  }
  settings.packages = packages;

  const skillsEntries = Array.isArray(settings.skills) ? [...(settings.skills as string[])] : [];
  if (!skillsEntries.includes("skills") && !skillsEntries.includes(".pi/skills")) {
    skillsEntries.push("skills");
  }
  settings.skills = skillsEntries;

  return JSON.stringify(settings, null, 2) + "\n";
}

export function planPiFiles(config: HubConfig, inputs: PiPlanInputs = {}): EditorPlan {
  const files: EditorPlan["files"] = [];

  files.push({ path: ".gitignore", content: buildGitignoreLines(config).join("\n"), kind: "managed-block" });

  files.push({ path: ".pi/settings.json", content: buildPiSettingsJson(inputs.existingSettings), kind: "file" });

  const piToggles = resolvePiConfig(config);
  if (piToggles.injectCapabilities) {
    const agentsSections: string[] = [];
    const capabilities = buildCapabilitiesPrompt(config, { format: "plain" });
    if (capabilities) agentsSections.push(capabilities);
    for (const steering of inputs.steering ?? []) {
      const content = stripFrontMatter(steering.content).trim();
      if (content) agentsSections.push(content);
    }
    files.push({ path: "AGENTS.md", content: agentsSections.join("\n\n") + "\n", kind: "file" });
  }

  return { files, warnings: [] };
}
