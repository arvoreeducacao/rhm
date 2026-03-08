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
