import type { HubConfig, Repo, MCPConfig, Service } from "../core/hub-config.js";

export function defineConfig(config: HubConfig): HubConfig {
  return config;
}

type RepoOverrides = Partial<Omit<Repo, "name" | "path" | "url" | "tech">>;

function createRepo(tech: string, defaults: Repo["commands"]) {
  return (name: string, url: string, overrides?: RepoOverrides): Repo => {
    const merged = { ...defaults, ...overrides?.commands };
    const rest = Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([k]) => k !== "commands")
    );
    return {
      name,
      path: `./${name}`,
      url,
      tech,
      commands: merged,
      ...rest,
    };
  };
}

export const repo = {
  nestjs: createRepo("nestjs", {
    install: "pnpm install",
    dev: "pnpm dev",
    build: "pnpm build",
    test: "pnpm test",
    lint: "pnpm lint",
  }),

  nextjs: createRepo("nextjs", {
    install: "pnpm install",
    dev: "pnpm dev",
    build: "pnpm build",
    test: "pnpm test",
    lint: "pnpm lint",
  }),

  react: createRepo("react", {
    install: "pnpm install",
    dev: "pnpm dev",
    build: "pnpm build",
    test: "pnpm test",
    lint: "pnpm lint",
  }),

  elixir: createRepo("elixir", {
    install: "mix deps.get",
    dev: "mix phx.server",
    test: "mix test",
    lint: "mix credo",
  }),

  go: createRepo("go", {
    install: "go mod download",
    build: "go build ./...",
    test: "go test ./...",
    lint: "golangci-lint run",
  }),

  python: createRepo("python", {
    install: "pip install -r requirements.txt",
    dev: "python manage.py runserver",
    test: "pytest",
    lint: "ruff check .",
  }),

  custom(name: string, url: string, config?: RepoOverrides & { tech?: string }): Repo {
    const { tech, ...rest } = config ?? {};
    return {
      name,
      path: `./${name}`,
      url,
      ...(tech && { tech }),
      ...rest,
    };
  },
};

type MCPOverrides = Partial<Omit<MCPConfig, "name">>;

export const mcp = {
  postgresql(name: string, overrides?: MCPOverrides): MCPConfig {
    return {
      name,
      package: "@arvoretech/postgresql-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  mysql(name: string, overrides?: MCPOverrides): MCPConfig {
    return {
      name,
      package: "@arvoretech/mysql-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  clickhouse(name: string, overrides?: MCPOverrides): MCPConfig {
    return {
      name,
      package: "@arvoretech/clickhouse-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  datadog(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "datadog",
      package: "@arvoretech/datadog-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  memory(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "team-memory",
      package: "@arvoretech/memory-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  sendgrid(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "sendgrid",
      package: "@arvoretech/sendgrid-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  launchdarkly(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "launchdarkly",
      package: "@arvoretech/launchdarkly-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  tempmail(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "tempmail",
      package: "@arvoretech/tempmail-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  awsSecretsManager(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "aws-secrets-manager",
      package: "@arvoretech/aws-secrets-manager-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  npmRegistry(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "npm-registry",
      package: "@arvoretech/npm-registry-mcp",
      ...overrides,
    };
  },

  runtimeLens(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "runtime-lens",
      package: "runtime-lens",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  meetTranscriptions(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "meet-transcriptions",
      package: "@arvoretech/meet-transcriptions-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  googleChat(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "google-chat",
      package: "@arvoretech/google-chat-mcp",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  playwright(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "playwright",
      package: "@playwright/mcp",
      ...overrides,
    };
  },

  context7(overrides?: MCPOverrides): MCPConfig {
    return {
      name: "context7",
      package: "@upstash/context7-mcp",
      ...overrides,
    };
  },

  proxy(name: string, overrides: MCPOverrides & { upstreams: string[] }): MCPConfig {
    return {
      name,
      package: "@arvoretech/mcp-proxy",
      ...overrides,
      env: { ...overrides?.env },
    };
  },

  custom(name: string, overrides?: MCPOverrides): MCPConfig {
    return {
      name,
      ...overrides,
    };
  },
};

type ServiceOverrides = Partial<Omit<Service, "name" | "image">>;

function createService(image: string, defaultPort: number) {
  return (name: string, overrides?: ServiceOverrides): Service => ({
    name,
    image,
    port: overrides?.port ?? defaultPort,
    ...overrides,
  });
}

export const service = {
  mysql: createService("mysql:8", 3306),
  postgres: createService("postgres:16", 5432),
  redis: createService("redis:7", 6379),
  mongo: createService("mongo:7", 27017),
  rabbitmq: createService("rabbitmq:3-management", 5672),
  elasticsearch: createService("elasticsearch:8.12.0", 9200),
  clickhouse: createService("clickhouse/clickhouse-server:24", 8123),

  custom(name: string, image: string, overrides?: ServiceOverrides): Service {
    return {
      name,
      image,
      ...overrides,
    };
  },
};
