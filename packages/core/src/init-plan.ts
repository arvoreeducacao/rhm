import { stringify } from "yaml";
import type { PlannedFile } from "./claude-code-plan.js";

export interface InitRepo {
  name: string;
  url: string;
  tech?: string;
}

export interface InitWorkspaceOptions {
  name: string;
  repos: InitRepo[];
  mcps?: string[];
  skills?: string[];
  configFormat?: "typescript" | "yaml";
  editor?: string;
  hubCliVersionRange?: string;
}

export const DEFAULT_HUB_CLI_VERSION_RANGE = "^0.28.0";

const SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/arvoreeducacao/rhm/main/schemas/hub.schema.json\n";

const REPO_HELPER_MAP: Record<string, string> = {
  nestjs: "repo.nestjs",
  nextjs: "repo.nextjs",
  react: "repo.react",
  "react-native": "repo.reactNative",
  elixir: "repo.elixir",
  go: "repo.go",
  python: "repo.python",
};

interface McpHelperInfo {
  helper: string;
  hasNameArg: boolean;
}

const MCP_HELPER_MAP: Record<string, McpHelperInfo> = {
  postgresql: { helper: "mcp.postgresql", hasNameArg: true },
  mysql: { helper: "mcp.mysql", hasNameArg: true },
  clickhouse: { helper: "mcp.clickhouse", hasNameArg: true },
  datadog: { helper: "mcp.datadog", hasNameArg: false },
  memory: { helper: "mcp.memory", hasNameArg: false },
  sendgrid: { helper: "mcp.sendgrid", hasNameArg: false },
  launchdarkly: { helper: "mcp.launchdarkly", hasNameArg: false },
  tempmail: { helper: "mcp.tempmail", hasNameArg: false },
  "aws-secrets-manager": { helper: "mcp.awsSecretsManager", hasNameArg: false },
  "npm-registry": { helper: "mcp.npmRegistry", hasNameArg: false },
  "runtime-lens": { helper: "mcp.runtimeLens", hasNameArg: false },
  "meet-transcriptions": { helper: "mcp.meetTranscriptions", hasNameArg: false },
  "google-chat": { helper: "mcp.googleChat", hasNameArg: false },
  playwright: { helper: "mcp.playwright", hasNameArg: false },
  context7: { helper: "mcp.context7", hasNameArg: false },
  "agent-teams-lead": { helper: "mcp.agentTeamsLead", hasNameArg: false },
  "agent-teams-chat": { helper: "mcp.agentTeamsChat", hasNameArg: false },
  kanban: { helper: "mcp.kanban", hasNameArg: false },
  "mcp-proxy": { helper: "mcp.proxy", hasNameArg: true },
};

export function buildInitTypeScriptConfig(options: InitWorkspaceOptions): string {
  const lines: string[] = [];
  lines.push('import { defineConfig, repo, mcp } from "@arvoretech/hub/config";');
  lines.push("");
  lines.push("export default defineConfig({");
  lines.push(`  name: "${options.name}",`);
  lines.push("");

  lines.push("  repos: [");
  for (const r of options.repos) {
    const helper = r.tech ? REPO_HELPER_MAP[r.tech] : undefined;
    if (helper) {
      lines.push(`    ${helper}("${r.name}", "${r.url}"),`);
    } else {
      lines.push(`    repo.custom("${r.name}", "${r.url}"),`);
    }
  }
  lines.push("  ],");
  lines.push("");

  const mcps = options.mcps ?? [];
  if (mcps.length > 0) {
    lines.push("  mcps: [");
    for (const name of mcps) {
      const info = MCP_HELPER_MAP[name];
      if (info) {
        lines.push(`    ${info.helper}(${info.hasNameArg ? `"${name}"` : ""}),`);
      } else {
        lines.push(`    mcp.custom("${name}"),`);
      }
    }
    lines.push("  ],");
    lines.push("");
  }

  lines.push("  integrations: {");
  lines.push('    github: { pr_branch_pattern: "{task_id}-{slug}" },');
  lines.push('    slack: { channels: { prs: "#eng-prs" } },');
  lines.push("  },");
  lines.push("");

  const skills = options.skills ?? [];
  if (skills.length > 0) {
    lines.push(`  skills: ${JSON.stringify(skills)},`);
  }

  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

export function buildInitYamlConfig(options: InitWorkspaceOptions): string {
  const skills = options.skills ?? [];
  const config: Record<string, unknown> = {
    name: options.name,
    repos: options.repos.map((r) => ({
      name: r.name,
      path: `./${r.name}`,
      url: r.url,
      ...(r.tech && { tech: r.tech }),
    })),
    services: [],
    mcps: (options.mcps ?? []).map((name) => ({ name })),
    integrations: {
      github: { pr_branch_pattern: "{task_id}-{slug}" },
      slack: { channels: { prs: "#eng-prs" } },
    },
    ...(skills.length > 0 && { skills }),
  };
  return SCHEMA_COMMENT + stringify(config);
}

function buildInitPackageJson(options: InitWorkspaceOptions): string {
  const pkg = {
    name: options.name,
    private: true,
    type: "module",
    devDependencies: {
      "@arvoretech/hub": options.hubCliVersionRange ?? DEFAULT_HUB_CLI_VERSION_RANGE,
    },
    dependencies: {
      tsx: "^4.21.0",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function buildInitTsConfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["hub.config.ts", "config/**/*.ts"],
  };
  return JSON.stringify(tsconfig, null, 2) + "\n";
}

function buildInitGitignore(options: InitWorkspaceOptions): string {
  const lines = [
    "node_modules/",
    ".DS_Store",
    "",
    ...options.repos.map((r) => `/${r.name}`),
    "",
    "*_data/",
    "",
    "*.env",
    "*.env.local",
    "!.env.example",
    "",
    "tasks/",
    "",
  ];
  return lines.join("\n");
}

function buildInitReadme(options: InitWorkspaceOptions): string {
  const editorFlag = options.editor ? ` --editor ${options.editor}` : "";
  return [
    `# ${options.name}`,
    "",
    `Powered by [Repo Hub](https://github.com/arvoreeducacao/rhm).`,
    "",
    "## Getting Started",
    "",
    "```bash",
    "hub setup",
    `hub generate${editorFlag}`,
    "```",
    "",
  ].join("\n");
}

export function planInitWorkspace(options: InitWorkspaceOptions): PlannedFile[] {
  const format = options.configFormat ?? "typescript";
  const files: PlannedFile[] = [];

  if (format === "typescript") {
    files.push({ path: "hub.config.ts", content: buildInitTypeScriptConfig(options), kind: "file" });
    files.push({ path: "package.json", content: buildInitPackageJson(options), kind: "file" });
    files.push({ path: "tsconfig.json", content: buildInitTsConfig(), kind: "file" });
  } else {
    files.push({ path: "hub.yaml", content: buildInitYamlConfig(options), kind: "file" });
  }

  files.push({ path: ".gitignore", content: buildInitGitignore(options), kind: "file" });
  files.push({ path: "README.md", content: buildInitReadme(options), kind: "file" });

  return files;
}
