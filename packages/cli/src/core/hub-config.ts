import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export interface Repo {
  name: string;
  path: string;
  url: string;
  tech?: string;
  description?: string;
  display_name?: string;
  env_file?: string;
  commands?: {
    install?: string;
    dev?: string;
    build?: string;
    lint?: string;
    test?: string;
    [key: string]: string | undefined;
  };
  skills?: string[];
  tools?: Record<string, string>;
}

export interface Service {
  name: string;
  image: string;
  port?: number;
  ports?: number[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  name: string;
  description?: string;
  instructions?: string;
  package?: string;
  url?: string;
  image?: string;
  env?: Record<string, string>;
  upstreams?: string[];
  autoApprove?: boolean | string[];
}

export interface IntegrationConfig {
  linear?: {
    team?: string;
    labels?: string[];
    link_pattern?: string;
  };
  github?: {
    org?: string;
    pr_branch_pattern?: string;
    pr_tool?: "cli" | "mcp";
  };
  slack?: {
    channels?: Record<string, string>;
    templates?: Record<string, string>;
  };
  playwright?: {
    base_url?: string;
  };
}

export interface WorkflowStep {
  step: string;
  agent?: string;
  agents?: (string | { agent: string; when?: string; output?: string })[];
  parallel?: boolean;
  output?: string;
  tools?: string[];
  when?: string;
  actions?: string[];
  mode?: "plan" | "agent";
}

export interface SecretRef {
  secret: string;
  profile?: string;
}

export interface BuildDatabaseUrl {
  from_secret: string;
  profile?: string;
  vars?: {
    user?: string;
    password?: string;
    host?: string;
    port?: string;
    database?: string;
  };
  template?: string;
}

export interface EnvProfile {
  description?: string;
  services?: string[];
  aws_profile?: string;
  secrets?: Record<string, string | SecretRef>;
  build_database_url?: Record<string, BuildDatabaseUrl>;
}

export interface MiseSettings {
  experimental?: boolean;
  [key: string]: unknown;
}

export interface PromptCustomization {
  prepend?: string;
  append?: string;
  sections?: Record<string, string>;
}

export interface HookEntry {
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  matcher?: string;
  timeout_ms?: number;
}

export interface MemoryConfig {
  path?: string;
  categories?: string[];
  auto_capture?: boolean;
  embedding_model?: string;
}

export interface RemoteSource {
  name: string;
  type: "skill" | "steering";
  notion_page?: string;
  url?: string;
  path?: string;
  instructions?: string;
  triggers?: string[];
}

export interface DesignLibrary {
  name: string;
  mcp?: string;
  url?: string;
  path?: string;
}

export interface DesignConfig {
  skills?: string[];
  libraries?: DesignLibrary[];
  icons?: string;
  instructions?: string;
}

export interface HubConfig {
  name: string;
  description?: string;
  version?: string;
  tools?: Record<string, string>;
  mise_settings?: MiseSettings;
  repos: Repo[];
  services?: Service[];
  env?: {
    profiles?: Record<string, EnvProfile>;
    overrides?: Record<string, Record<string, Record<string, string>>>;
  };
  mcps?: MCPConfig[];
  integrations?: IntegrationConfig;
  hooks?: Record<string, HookEntry[]>;
  commands?: Record<string, string>;
  commands_dir?: string;
  memory?: MemoryConfig;
  remote_sources?: RemoteSource[];
  design?: DesignConfig;
  workflow?: {
    task_folder?: string;
    pipeline?: WorkflowStep[];
    prompt?: PromptCustomization;
    enforce_workflow?: boolean;
  };
}

export function resolveConfigPath(dir: string): { path: string; format: "yaml" | "typescript" } {
  const tsPath = join(dir, "hub.config.ts");
  if (existsSync(tsPath)) return { path: tsPath, format: "typescript" };
  return { path: join(dir, "hub.yaml"), format: "yaml" };
}

async function loadTypeScriptConfig(configPath: string): Promise<HubConfig> {
  const fileUrl = pathToFileURL(configPath).href;

  try {
    const mod = await import(fileUrl);
    return (mod.default ?? mod) as HubConfig;
  } catch {
    const { execFileSync } = await import("node:child_process");
    const json = execFileSync("npx", ["tsx", "-e", `import c from '${configPath}'; console.log(JSON.stringify(c))`], {
      encoding: "utf-8",
      cwd: configPath.replace(/\/hub\.config\.ts$/, ""),
      stdio: ["pipe", "pipe", "pipe"],
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
