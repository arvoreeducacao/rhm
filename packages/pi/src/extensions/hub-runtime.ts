import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
}
