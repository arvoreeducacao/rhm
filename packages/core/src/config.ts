import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type { HubConfig, PiConfig } from "./types.js";

export type ResolvedPiConfig = Required<PiConfig>;

export function resolvePiConfig(config: HubConfig): ResolvedPiConfig {
  const pi = config.pi ?? {};
  return {
    headerBanner: pi.headerBanner ?? true,
    onboarding: pi.onboarding ?? true,
    autoMcpWiring: pi.autoMcpWiring ?? true,
    injectCapabilities: pi.injectCapabilities ?? true,
    hooks: pi.hooks ?? true,
    persona: pi.persona ?? true,
    repoContext: pi.repoContext ?? true,
  };
}

const configCache = new Map<string, { hash: string; config: HubConfig }>();

const RESOLVED_CACHE_DIR = ".hub";
const RESOLVED_CACHE_FILE = "config-resolved.json";

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

const warnedLegacyWorkflow = new Set<string>();

function warnLegacyWorkflow(configPath: string, config: HubConfig): void {
  const legacy = config.workflow as { pipeline?: unknown; enforce_workflow?: unknown } | undefined;
  if (!legacy) return;
  if (legacy.pipeline === undefined && legacy.enforce_workflow === undefined) return;
  if (warnedLegacyWorkflow.has(configPath)) return;
  warnedLegacyWorkflow.add(configPath);
  console.warn(
    "[hub] 'workflow.pipeline' and 'workflow.enforce_workflow' were removed in the skills-centered model and are ignored. " +
      "Migrate your agents to skills: hub skills add <name>.",
  );
}

export async function loadHubConfig(dir: string): Promise<HubConfig> {
  const { path: configPath } = resolveConfigPath(dir);
  const config = await loadHubConfigRaw(dir);
  warnLegacyWorkflow(configPath, config);
  return config;
}

async function loadHubConfigRaw(dir: string): Promise<HubConfig> {
  const { path: configPath, format } = resolveConfigPath(dir);

  if (format === "yaml") {
    return parse(await readFile(configPath, "utf-8")) as HubConfig;
  }

  const hash = await computeConfigInputsHash(dir, configPath);

  const memo = configCache.get(configPath);
  if (memo && memo.hash === hash) {
    return memo.config;
  }

  const disk = await readResolvedCache(dir, hash);
  if (disk) {
    configCache.set(configPath, { hash, config: disk });
    return disk;
  }

  const config = await loadTypeScriptConfig(configPath);
  configCache.set(configPath, { hash, config });
  await writeResolvedCache(dir, hash, config);
  return config;
}

async function computeConfigInputsHash(dir: string, configPath: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`hub.config:${createHash("sha256").update(await readFile(configPath, "utf-8")).digest("hex")}`);

  const configDir = join(dir, "config");
  if (existsSync(configDir)) {
    const entries = await readdir(configDir, { withFileTypes: true });
    const tsFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => e.name)
      .sort();
    for (const name of tsFiles) {
      const content = await readFile(join(configDir, name), "utf-8");
      parts.push(`config/${name}:${createHash("sha256").update(content).digest("hex")}`);
    }
  }

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

async function readResolvedCache(dir: string, hash: string): Promise<HubConfig | null> {
  const cachePath = join(dir, RESOLVED_CACHE_DIR, RESOLVED_CACHE_FILE);
  if (!existsSync(cachePath)) return null;

  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf-8")) as {
      hash?: string;
      config?: HubConfig;
    };
    if (parsed.hash === hash && parsed.config) {
      return parsed.config;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeResolvedCache(dir: string, hash: string, config: HubConfig): Promise<void> {
  try {
    const cacheDir = join(dir, RESOLVED_CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, RESOLVED_CACHE_FILE),
      JSON.stringify({ hash, config }, null, 2) + "\n",
      "utf-8",
    );
  } catch {
    return;
  }
}

export function findHubRoot(startDir: string = process.cwd()): string | null {
  let dir = resolvePath(startDir);
  for (;;) {
    if (existsSync(join(dir, "hub.config.ts")) || existsSync(join(dir, "hub.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
