import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type { HubConfig } from "./types.js";

export function resolveConfigPath(dir: string): { path: string; format: "yaml" | "typescript" } {
  const tsPath = join(dir, "hub.config.ts");
  if (existsSync(tsPath)) return { path: tsPath, format: "typescript" };
  const yamlPath = join(dir, "hub.yaml");
  if (existsSync(yamlPath)) return { path: yamlPath, format: "yaml" };
  throw new Error(`No hub config found in ${dir}. Expected hub.config.ts or hub.yaml`);
}

async function loadTypeScriptConfig(configPath: string): Promise<HubConfig> {
  const fileUrl = pathToFileURL(configPath).href;

  try {
    const mod = await import(fileUrl);
    return (mod.default ?? mod) as HubConfig;
  } catch {
    const { execFileSync } = await import("node:child_process");
    const evalScript = `import c from ${JSON.stringify(fileUrl)}; console.log(JSON.stringify(c.default ?? c));`;
    const json = execFileSync("npx", ["tsx", "-e", evalScript], {
      encoding: "utf-8",
      cwd: dirname(configPath),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    return JSON.parse(json) as HubConfig;
  }
}

export async function loadHubConfig(dir: string): Promise<HubConfig> {
  const { path: configPath, format } = resolveConfigPath(dir);

  if (format === "typescript") {
    return loadTypeScriptConfig(configPath);
  }

  const content = await readFile(configPath, "utf-8");
  return parse(content) as HubConfig;
}

export function findHubRoot(startDir: string = process.cwd()): string {
  return startDir;
}
