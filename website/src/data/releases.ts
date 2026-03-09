export interface ReleaseChange {
  type: "feat" | "fix" | "refactor" | "chore";
  title: string;
  description: string;
}

export interface Release {
  version: string;
  date: string;
  title: string;
  slug: string;
  summary: string;
  changes: ReleaseChange[];
}

export const releases: Release[] = [
  {
    version: "0.12.0",
    date: "2026-03-09",
    title: "hub clone",
    slug: "0-12-0",
    summary:
      "New hub clone command for cloning all repositories without running full setup. Clone first, setup later.",
    changes: [
      {
        type: "feat",
        title: "hub clone",
        description:
          "Clone all repositories defined in your config without starting services, installing tools, or running dependency installation. Auto-detects SSH vs HTTPS, with --ssh and --https flags to force a specific method.",
      },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-03-09",
    title: "React Native Support",
    slug: "0-11-0",
    summary:
      "First-class React Native/Expo support with repo.reactNative() helper, auto-detection in hub scan, TUI integration, and JSON Schema validation.",
    changes: [
      {
        type: "feat",
        title: "repo.reactNative() Helper",
        description:
          "New type-safe helper for React Native projects with sensible defaults (pnpm install, pnpm start, pnpm build, pnpm test, pnpm lint).",
      },
      {
        type: "feat",
        title: "React Native Auto-Detection",
        description:
          "hub scan now detects app.json, app.config.js, and app.config.ts as react-native projects, preventing misidentification as plain React.",
      },
      {
        type: "feat",
        title: "TUI Integration",
        description:
          "hub init infers react-native for repos with mobile or app in the name. REPO_HELPER_MAP maps react-native to repo.reactNative for correct hub.config.ts generation.",
      },
      {
        type: "feat",
        title: "JSON Schema Update",
        description:
          "react-native added to the tech enum in hub.schema.json, enabling autocompletion and validation in hub.yaml.",
      },
    ],
  },
  {
    version: "0.10.0",
    date: "2025-07-07",
    title: "Interactive TUI & TypeScript Config",
    slug: "0-10-0",
    summary:
      "hub init is now a full interactive TUI built with ink — a multi-step wizard with registry integration, tech stack detection, and MCP selection. Plus TypeScript config support with type-safe helpers for repos, MCPs, and services.",
    changes: [
      {
        type: "feat",
        title: "Interactive TUI",
        description:
          "hub init launches a polished terminal UI with 11 steps: welcome, name, editor, repos, agents, skills, MCPs, config format, summary, creating, and done. Agents and skills are fetched from the hub directory registry, with smart pre-selection based on your tech stack.",
      },
      {
        type: "feat",
        title: "TypeScript Config",
        description:
          "Define your hub config in hub.config.ts with full type safety. The defineConfig wrapper provides autocompletion, and composable helpers (repo.nestjs, mcp.postgresql, service.postgres, etc.) set sensible defaults for each framework and tool.",
      },
      {
        type: "feat",
        title: "Config Helpers",
        description:
          "Type-safe helpers for 7 repo frameworks, 17 MCP servers (all arvore-mcp-servers packages plus Playwright and Context7), and 8 Docker service types. Each helper pre-fills the correct package names, default commands, ports, and images.",
      },
      {
        type: "feat",
        title: "Directory Registry Integration",
        description:
          "The TUI fetches agents and skills from hub.arvore.com.br/directory.json at runtime. Skills matching your repo tech stack are automatically recommended. Falls back to built-in defaults when offline.",
      },
      {
        type: "feat",
        title: "Three.js Hero Animation",
        description:
          "The website landing page now uses a Three.js particle animation for the hero section, replacing the previous inline canvas implementation.",
      },
    ],
  },
  {
    version: "0.9.0",
    date: "2025-06-20",
    title: "Remote Sources & Design System",
    slug: "0-9-0",
    summary:
      "Skills and steering files can now live outside your repo — in Notion, at a URL, or on a local path. Plus a new design section in hub.yaml that teaches the AI your visual language: component libraries, icon systems, and design tokens.",
    changes: [
      {
        type: "feat",
        title: "Remote Sources",
        description:
          "Define skills and steering files that live in Notion pages, raw URLs, or local filesystem paths. During hub generate, content is fetched, converted to markdown (with full Notion block support including tables, toggles, code blocks, and images), and installed into your editor config automatically.",
      },
      {
        type: "feat",
        title: "Design System Config",
        description:
          "New design section in hub.yaml lets you declare UI libraries (with MCP, URL, or local docs), icon libraries, design skills, and free-form instructions. The orchestrator prompt now includes a structured Design System section so the AI always knows which components and tokens to use.",
      },
      {
        type: "feat",
        title: "MCP Description & Instructions",
        description:
          "MCP configs now support description and instructions fields. Descriptions appear in the orchestrator's MCP listing, and instructions are injected as per-server guidance so the AI knows how to use each tool correctly.",
      },
      {
        type: "feat",
        title: "Auto-generate .env.example",
        description:
          "hub generate scans all MCP env vars across your config and produces a .env.example file, so new team members know exactly which secrets to configure without reading through hub.yaml.",
      },
      {
        type: "fix",
        title: "Path Traversal Guard",
        description:
          "Remote sources with local paths now validate that the resolved path doesn't escape the workspace directory, preventing accidental reads of files outside the project.",
      },
      {
        type: "fix",
        title: "Fetch Timeout",
        description:
          "URL-based remote sources now use a 30-second AbortSignal timeout, so hub generate doesn't hang indefinitely on unreachable endpoints.",
      },
      {
        type: "fix",
        title: "Schema Validation",
        description:
          "Fixed anyOf validation in the JSON schema for remote sources and design libraries, ensuring proper editor autocompletion and validation in hub.yaml.",
      },
    ],
  },
];
