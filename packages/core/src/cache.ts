import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveConfigPath } from "./config.js";

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

export interface OutdatedResult {
  outdated: boolean;
  editor?: string;
  reason?: string;
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

async function hashActiveConfig(hubDir: string): Promise<string | null> {
  try {
    const { path: activeConfigPath, format } = resolveConfigPath(hubDir);
    const configFile = format === "typescript" ? "hub.config.ts" : "hub.yaml";
    const content = await readFile(activeConfigPath, "utf-8");
    return `${configFile}:${createHash("sha256").update(content).digest("hex")}`;
  } catch {
    return null;
  }
}

export async function computeInputsHash(hubDir: string): Promise<string> {
  const parts: string[] = [];

  const configPart = await hashActiveConfig(hubDir);
  if (configPart) parts.push(configPart);

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
