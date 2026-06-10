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
  type?: "sandbox" | string;
  image?: string;
  port?: number;
  ports?: number[];
  env?: Record<string, string>;
  workspace?: string;
}

export interface MCPConfig {
  name: string;
  description?: string;
  instructions?: string;
  package?: string;
  command?: string;
  args?: string[];
  url?: string;
  image?: string;
  env?: Record<string, string>;
  upstreams?: string[];
  autoApprove?: boolean | string[];
  auth?: "bearer" | "oauth";
  lifecycle?: "lazy" | "eager" | "keep-alive";
  idleTimeout?: number;
  directTools?: boolean | string[];
  excludeTools?: string[];
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
  enforce?: boolean;
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
  enforce?: boolean;
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
    fact_checker?: boolean;
  };
}

export interface PersonaData {
  name: string;
  role: string;
  technical_level?: string;
  focus_areas?: string;
  aws_profiles?: { name: string; description: string }[];
  github_username?: string;
  timezone?: string;
  context?: string;
  language?: string;
}
