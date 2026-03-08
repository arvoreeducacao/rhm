import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { loadHubConfig } from "./hub-config.js";

const HUB_DIR = ".hub";
const CONFIG_FILE = "config.json";

export type KiroMode = "editor" | "cli";

export interface HubCacheConfig {
  editor?: string;
  kiroMode?: KiroMode;
  lastGenerate?: {
    hash: string;
    timestamp: string;
    editor: string;
  };
}

export async function readCache(hubDir: string): Promise<HubCacheConfig> {
  const filePath = join(hubDir, HUB_DIR, CONFIG_FILE);
  if (!existsSync(filePath)) return {};

  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as HubCacheConfig;
  } catch {
    return {};
  }
}

export async function writeCache(hubDir: string, cache: HubCacheConfig): Promise<void> {
  const dir = join(hubDir, HUB_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CONFIG_FILE), JSON.stringify(cache, null, 2) + "\n", "utf-8");
}

export async function getSavedEditor(hubDir: string): Promise<string | undefined> {
  const cache = await readCache(hubDir);
  return cache.editor;
}

export async function saveEditor(hubDir: string, editor: string): Promise<void> {
  const cache = await readCache(hubDir);
  cache.editor = editor;
  await writeCache(hubDir, cache);
}

export async function getKiroMode(hubDir: string): Promise<KiroMode | undefined> {
  const cache = await readCache(hubDir);
  return cache.kiroMode;
}

export async function saveKiroMode(hubDir: string, mode: KiroMode): Promise<void> {
  const cache = await readCache(hubDir);
  cache.kiroMode = mode;
  await writeCache(hubDir, cache);
}

async function collectFileHashes(dir: string, extensions: string[]): Promise<string[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const hashes: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      const content = await readFile(fullPath, "utf-8");
      hashes.push(`${entry.name}:${createHash("sha256").update(content).digest("hex")}`);
    } else if (entry.isDirectory()) {
      const subHashes = await collectFileHashes(fullPath, extensions);
      hashes.push(...subHashes.map((h) => `${entry.name}/${h}`));
    }
  }

  return hashes.sort();
}

export async function computeInputsHash(hubDir: string): Promise<string> {
  const parts: string[] = [];

  for (const configFile of ["hub.yaml", "hub.config.ts"]) {
    const configPath = join(hubDir, configFile);
    if (existsSync(configPath)) {
      const content = await readFile(configPath, "utf-8");
      parts.push(`${configFile}:${createHash("sha256").update(content).digest("hex")}`);
    }
  }

  const dirs = ["agents", "skills", "hooks", "commands"];
  for (const dir of dirs) {
    const dirHashes = await collectFileHashes(join(hubDir, dir), [".md", ".sh"]);
    parts.push(...dirHashes.map((h) => `${dir}/${h}`));
  }

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export async function saveGenerateState(hubDir: string, editor: string): Promise<void> {
  const hash = await computeInputsHash(hubDir);
  const cache = await readCache(hubDir);
  cache.editor = editor;
  cache.lastGenerate = {
    hash,
    timestamp: new Date().toISOString(),
    editor,
  };
  await writeCache(hubDir, cache);
}

export interface OutdatedResult {
  outdated: boolean;
  editor?: string;
  reason?: string;
}

export async function checkOutdated(hubDir: string): Promise<OutdatedResult> {
  const cache = await readCache(hubDir);

  if (!cache.lastGenerate) {
    return { outdated: false, reason: "no-previous-generate" };
  }

  const currentHash = await computeInputsHash(hubDir);

  if (currentHash !== cache.lastGenerate.hash) {
    return {
      outdated: true,
      editor: cache.editor,
      reason: "inputs-changed",
    };
  }

  return { outdated: false, editor: cache.editor };
}

export async function checkAndAutoRegenerate(hubDir: string): Promise<void> {
  try {
    const result = await checkOutdated(hubDir);

    if (!result.outdated) return;

    if (!result.editor) {
      console.log(
        chalk.yellow(
          "\n  Configs are outdated. Run 'hub generate' to regenerate.\n"
        )
      );
      return;
    }

    console.log(chalk.yellow("\n  Detected outdated configs, auto-regenerating..."));

    const { generators } = await import("../commands/generate.js");
    const generator = generators[result.editor];
    if (!generator) {
      console.log(chalk.red(`  Unknown editor '${result.editor}' in cache. Run 'hub generate' manually.`));
      return;
    }

    const config = await loadHubConfig(hubDir);
    await generator.generate(config, hubDir);
    await saveGenerateState(hubDir, result.editor);

    console.log(chalk.green("  Auto-regeneration complete!\n"));
  } catch (err) {
    console.log(chalk.yellow(`  Auto-regeneration failed: ${(err as Error).message}`));
    console.log(chalk.dim("  Run 'hub generate' manually to fix.\n"));
  }
}
