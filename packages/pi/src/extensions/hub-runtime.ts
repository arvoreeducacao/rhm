import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCapabilitiesPrompt, stripFrontMatter } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

async function readSteering(hubDir: string): Promise<string[]> {
  const steeringDir = resolve(hubDir, "steering");
  if (!existsSync(steeringDir)) return [];
  const out: string[] = [];
  try {
    const files = readdirSync(steeringDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const raw = await readFile(join(steeringDir, file), "utf-8");
      const content = stripFrontMatter(raw).trim();
      if (content) out.push(content);
    }
  } catch {
    // skip
  }
  return out;
}

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
    const { hubDir, config, pi: toggles, hasGeneratedOrchestrator } = getSessionState();
    if (!hubDir || !config || !toggles) return;
    if (!toggles.injectCapabilities) return;
    if (hasGeneratedOrchestrator) return;

    const parts: string[] = [];
    const capabilities = buildCapabilitiesPrompt(config, { format: "plain" });
    if (capabilities) parts.push(capabilities);

    const steering = await readSteering(hubDir);
    parts.push(...steering);

    if (parts.length === 0) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n"),
    };
  });
}
