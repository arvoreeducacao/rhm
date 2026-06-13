import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCapabilitiesPrompt } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

export function hubRuntime(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { config } = getSessionState();
    if (config) {
      ctx.ui.setStatus(`hub: ${config.name} (${config.repos.length} repos)`);
    }
  });

  pi.on("resources_discover", () => {
    const { hubDir, config } = getSessionState();
    if (!hubDir || !config) return {};

    const skillPaths: string[] = [];
    const skillsDir = resolve(hubDir, "skills");

    if (existsSync(skillsDir)) {
      try {
        const folders = readdirSync(skillsDir, { withFileTypes: true });
        for (const folder of folders) {
          if (folder.isDirectory()) {
            const skillFile = join(skillsDir, folder.name, "SKILL.md");
            if (existsSync(skillFile)) {
              skillPaths.push(skillFile);
            }
          }
        }
      } catch {
        // skip
      }
    }

    return { skillPaths };
  });

  pi.on("before_agent_start", async (event) => {
    const { config, pi: toggles, hasGeneratedOrchestrator } = getSessionState();
    if (!config || !toggles) return;
    if (!toggles.injectCapabilities) return;
    if (hasGeneratedOrchestrator) return;

    const capabilities = buildCapabilitiesPrompt(config, { format: "plain" });
    if (!capabilities) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + capabilities,
    };
  });
}
