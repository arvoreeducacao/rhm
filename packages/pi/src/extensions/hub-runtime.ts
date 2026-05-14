import { existsSync, readdirSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadHubConfig,
  buildKiroOrchestratorRule,
  buildSkillsSection,
  stripFrontMatter,
  type HubConfig,
} from "@arvoretech/hub-core";

let cachedConfig: HubConfig | null = null;
let configMtime: number = 0;

async function getConfig(cwd: string): Promise<HubConfig> {
  const tsPath = join(cwd, "hub.config.ts");
  const yamlPath = join(cwd, "hub.yaml");
  const configPath = existsSync(tsPath) ? tsPath : yamlPath;

  if (!existsSync(configPath)) {
    throw new Error("No hub.config.ts or hub.yaml found");
  }

  const stat = statSync(configPath);
  const mtime = stat.mtimeMs;

  if (cachedConfig && mtime === configMtime) {
    return cachedConfig;
  }

  cachedConfig = await loadHubConfig(cwd);
  configMtime = mtime;
  return cachedConfig;
}

export function hubRuntime(pi: ExtensionAPI) {
  let hubDir: string = "";

  pi.on("session_start", async (_event, ctx) => {
    hubDir = ctx.cwd;
    try {
      const config = await getConfig(hubDir);
      ctx.ui.setStatus(`hub: ${config.name} (${config.repos.length} repos)`);
    } catch {
      // no hub config found, extension is a no-op
    }
  });

  pi.on("resources_discover", () => {
    if (!hubDir) return {};

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
    if (!hubDir) return;

    let config: HubConfig;
    try {
      config = await getConfig(hubDir);
    } catch {
      return;
    }

    const orchestratorRule = buildKiroOrchestratorRule(config);
    const skillsSection = await buildSkillsSection(hubDir, config);

    const sections: string[] = [orchestratorRule];
    if (skillsSection) sections.push(skillsSection);

    const steeringDir = resolve(hubDir, "steering");
    if (existsSync(steeringDir)) {
      try {
        const files = await readdir(steeringDir);
        for (const file of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(steeringDir, file), "utf-8");
          const content = stripFrontMatter(raw).trim();
          if (content) sections.push(content);
        }
      } catch {
        // skip
      }
    }

    return {
      systemPrompt: event.systemPrompt + "\n\n" + sections.join("\n\n"),
    };
  });
}
