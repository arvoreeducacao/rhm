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
    version: "0.20.0",
    date: "2026-04-07",
    title: "Improved hub update experience",
    slug: "0-20-0",
    summary:
      "hub update now shows a changelog of all releases included in the update, with a clean spinner instead of raw package manager output. Release data is fetched from the hub website via a new /api/releases.json endpoint.",
    changes: [
      {
        type: "feat",
        title: "Release changelog in hub update",
        description:
          "When updating, the CLI now fetches release data from hub.arvore.com.br/api/releases.json and displays all versions between the current and latest, with their changes grouped by type (feat, fix, refactor).",
      },
      {
        type: "feat",
        title: "Clean spinner UX",
        description:
          "Package manager output (pnpm/yarn/npm install logs) is now hidden behind an ora spinner. No more noisy deprecation warnings or progress bars — just a clean loading indicator and a success/fail message.",
      },
      {
        type: "feat",
        title: "Releases JSON API endpoint",
        description:
          "New /api/releases.json endpoint on the hub website serves the full releases data as JSON with CORS headers, enabling the CLI and other tools to consume release information programmatically.",
      },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-04-07",
    title: "Persona as dedicated editor file",
    slug: "0-19-0",
    summary:
      "Persona is now generated as a dedicated editor file (.kiro/steering/persona.md, .cursor/rules/persona.mdc, .opencode/rules/persona.md) instead of being appended to AGENTS.md. The file is gitignored by default since it's personal. The persona TUI now collects AWS profiles, GitHub username, focus areas, and timezone.",
    changes: [
      {
        type: "feat",
        title: "Persona as separate editor file",
        description:
          "All four generators (Kiro, Cursor, Claude Code, OpenCode) now write persona as a dedicated file with always-apply inclusion, instead of appending it to AGENTS.md. For Kiro it's a steering file, for Cursor a .mdc rule, for OpenCode a rule, and for Claude Code it's appended to CLAUDE.md.",
      },
      {
        type: "feat",
        title: "Extended persona fields",
        description:
          "The persona TUI now collects five new optional fields: AWS profiles (name:description pairs), GitHub username, Slack display name, focus areas, and timezone. All are included in the generated persona file when provided.",
      },
      {
        type: "feat",
        title: "Persona gitignored by default",
        description:
          "buildGitignoreLines now includes .kiro/steering/persona.md, .cursor/rules/persona.mdc, and .opencode/rules/persona.md in the managed gitignore block, since persona is personal and should not be committed.",
      },
      {
        type: "fix",
        title: "hub scan ignores persona files",
        description:
          "findUnsyncedAssets now skips persona.md and persona.mdc in all editor directories, so hub scan --check no longer flags them as unsynced assets.",
      },
    ],
  },
  {
    version: "0.18.1",
    date: "2026-04-07",
    title: "Design enforcement & upstream MCP instructions",
    slug: "0-18-1",
    summary:
      "Design system rules can now be enforced with enforce: true, and MCP instructions are rendered for upstream (proxied) MCPs too.",
    changes: [
      {
        type: "feat",
        title: "Design enforcement mode",
        description:
          "New enforce: true option in the design config generates a DESIGN ENFORCEMENT — MANDATORY section in the orchestrator prompt. The agent is instructed to always consult design skills before creating or modifying UI, use only design tokens, and prefer existing components over custom ones.",
      },
      {
        type: "fix",
        title: "Render instructions for upstream MCPs",
        description:
          "MCPs with instructions that were listed as proxy upstreams had their instructions silently dropped from the generated orchestrator rules. Now any MCP with instructions gets them rendered regardless of whether it's direct or proxied.",
      },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-04-07",
    title: "Sandbox via mcp.sandbox()",
    slug: "0-18-0",
    summary:
      "The sandbox MCP is now configured like any other MCP via mcp.sandbox() in hub.config.ts, instead of being auto-injected from a services entry. This makes it composable, overridable, and consistent with the rest of the config.",
    changes: [
      {
        type: "refactor",
        title: "mcp.sandbox() helper",
        description:
          "New type-safe helper in define-config.ts. Call mcp.sandbox(port) in your mcps array and hub generate wires it into Cursor and Kiro mcp.json automatically — no special-casing needed.",
      },
      {
        type: "refactor",
        title: "Remove hardcoded sandbox injection",
        description:
          "generate.ts no longer detects services with type: sandbox and force-injects the MCP entry. The sandbox MCP now flows through the same path as every other MCP with a URL.",
      },
      {
        type: "refactor",
        title: "Agent context injection via mcps",
        description:
          "The Sandbox Environment section injected into QA and coding agent prompts is now triggered by the presence of a sandbox entry in the mcps array, not by services.",
      },
    ],
  },
  {
    version: "0.17.3",
    date: "2026-04-07",
    title: "Fix update PM detection",
    slug: "0-17-3",
    summary:
      "hub update now correctly detects which package manager was used to install the CLI globally, instead of just checking which PMs are available on the system.",
    changes: [
      {
        type: "fix",
        title: "Detect PM from install context, not system availability",
        description:
          "Detection now checks npm_config_user_agent, the hub binary path, and global package lists instead of just running pnpm/yarn --version. Also fixes pnpm to use 'pnpm add -g' instead of 'pnpm install -g'.",
      },
    ],
  },
  {
    version: "0.17.2",
    date: "2026-04-06",
    title: "Sandbox support",
    slug: "0-17-2",
    summary:
      "New hub sandbox command manages an AIO Sandbox container with VSCode Server, browser automation, MCP endpoint, and Jupyter — all accessible locally via Docker Compose.",
    changes: [
      {
        type: "feat",
        title: "hub sandbox command",
        description:
          "New command with up, down, status, logs, and open subcommands. Starts and stops the sandbox container via Docker Compose, checks running state, streams logs, and opens VSCode Server in the browser.",
      },
      {
        type: "feat",
        title: "Docker Compose generation for sandbox",
        description:
          "generateDockerCompose now emits a sandbox service entry when a service with type: sandbox is declared in hub.yaml. Mounts the workspace at /workspace and exposes MCP, VSCode Server, VNC browser, and Jupyter docs endpoints on the configured port.",
      },
      {
        type: "feat",
        title: "Sandbox MCP injection on generate",
        description:
          "hub generate now injects the sandbox MCP URL (http://localhost:{port}/mcp) into Cursor and Kiro editor configs when a sandbox service is present.",
      },
      {
        type: "feat",
        title: "Sandbox context in agent prompts",
        description:
          "QA and coding agent prompts receive a Sandbox Environment section on generate, documenting the available MCP tools (shell.exec, file.read/write, browser.*, jupyter.execute) and the /home/gem/workspace mount path.",
      },
      {
        type: "fix",
        title: "Remove unused SANDBOX_IMAGE constant",
        description:
          "Cleaned up a leftover SANDBOX_IMAGE constant from sandbox.ts that was never referenced after the image was moved to docker-compose generation.",
      },
    ],
  },
  {
    version: "0.17.1",
    date: "2026-04-06",
    title: "Fix remote source overwrite",
    slug: "0-17-1",
    summary:
      "Remote source skills are no longer overwritten by stale local copies when the remote fetch fails. All four generators now skip local skill copy for folders managed by remote sources.",
    changes: [
      {
        type: "fix",
        title: "Preserve remote source skills on fetch failure",
        description:
          "Skills defined as remote_sources are now skipped during the local cp step in all generators (Cursor, Kiro, Claude Code, OpenCode). Previously, the local copy would overwrite a successfully synced file before the remote fetch ran, and if the fetch failed the good content was lost.",
      },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-04-06",
    title: "Persona",
    slug: "0-17-0",
    summary:
      "New hub persona command creates a personal AI profile for each team member. The agent adapts its communication style based on who it's talking to — from CEOs who want business summaries to senior devs who want raw technical details.",
    changes: [
      {
        type: "feat",
        title: "hub persona",
        description:
          "Interactive TUI that asks your name, role, technical level, extra context, and preferred language. Saves to .hub/persona.yaml — local and gitignored, so each team member has their own profile.",
      },
      {
        type: "feat",
        title: "Persona injection in hub generate",
        description:
          "All four editor generators (Cursor, Kiro, Claude Code, OpenCode) now read .hub/persona.yaml and inject a User Persona section into AGENTS.md with specific communication instructions tailored to the user's role and technical level.",
      },
      {
        type: "feat",
        title: "Four technical levels",
        description:
          "Non-technical (no jargon, business-focused), Beginner (gentle explanations), Intermediate (normal with context for niche topics), and Advanced (concise, direct, no hand-holding). Each level generates different agent behavior instructions.",
      },
      {
        type: "feat",
        title: "Language preference",
        description:
          "The persona includes a preferred language field. When set to anything other than English, the agent is instructed to always communicate in that language.",
      },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-04-03",
    title: "Chat consolidation",
    slug: "0-16-0",
    summary:
      "New hub consolidate command extracts knowledge from chat sessions across Kiro, Claude Code, and OpenCode into team memories — using the editor's own CLI as the LLM engine.",
    changes: [
      {
        type: "feat",
        title: "hub consolidate",
        description:
          "Reads chat history from Kiro, Claude Code, and OpenCode, compacts sessions into a batch, and spawns the editor CLI (kiro-cli, claude, or opencode) to extract decisions, conventions, gotchas, and domain knowledge into ./memories/. Zero extra dependencies — uses the model you already pay for.",
      },
      {
        type: "feat",
        title: "Cross-editor session collection",
        description:
          "Auto-detects chat storage for Kiro (Application Support JSON), Claude Code (~/.claude/projects JSONL), and OpenCode (~/.local/share/opencode session/message/part). Normalizes all formats into a unified structure.",
      },
      {
        type: "feat",
        title: "Incremental processing",
        description:
          "Tracks indexed sessions in .hub/consolidation-state.json. Running hub consolidate twice won't reprocess the same sessions. Use --reset to start fresh.",
      },
      {
        type: "fix",
        title: "Session ordering",
        description:
          "Collectors now sort globally by date before applying the limit, ensuring the most recent sessions are always processed first regardless of which workspace directory they're in.",
      },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-04-03",
    title: "Enhanced orchestrator prompts",
    slug: "0-15-0",
    summary:
      "All editor generators now produce richer orchestrator prompts with core behavior, working style, code change, security, git discipline, and skills listing sections. AGENTS.md is now generated universally across all editors.",
    changes: [
      {
        type: "feat",
        title: "AGENTS.md for all editors",
        description:
          "All editor generators (Cursor, Claude Code, OpenCode, Kiro) now write AGENTS.md at the workspace root. Kiro no longer generates a duplicate .kiro/steering/orchestrator.md.",
      },
      {
        type: "feat",
        title: "Core behavior sections",
        description:
          "Six new shared sections added to all orchestrator prompts: Core Behavior, Working Style, Search/Reading/Investigation, Code Changes, Security/Safety, and Git/Operational Discipline. Based on analysis of Cursor and Claude Code system prompts.",
      },
      {
        type: "feat",
        title: "Skills listing in orchestrator",
        description:
          "The orchestrator prompt now includes a Skills section that lists all available skills with descriptions, associated repositories, and guidance on when to consult them.",
      },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-03-30",
    title: "Kanban MCP",
    slug: "0-14-0",
    summary:
      "Persistent kanban board MCP for AI agent task management with multi-session coordination, semantic search via LanceDB, and parallel chat visibility.",
    changes: [
      {
        type: "feat",
        title: "Kanban MCP Server",
        description:
          "New @arvoretech/kanban-mcp with 12 tools for board and card CRUD, semantic search, subtasks, and session management.",
      },
      {
        type: "feat",
        title: "Multi-session",
        description:
          "Each chat identifies with a session_id. claim_card and release_card enable coordination between parallel chats. get_board shows active sessions with duration.",
      },
      {
        type: "feat",
        title: "Semantic search",
        description:
          "search_cards uses LanceDB with multilingual embeddings to find cards by semantic context.",
      },
      {
        type: "feat",
        title: "Helper mcp.kanban()",
        description:
          "New RHM CLI helper to configure the kanban MCP in hub.config.ts.",
      },
    ],
  },
  {
    version: "0.13.4",
    date: "2026-03-25",
    title: "OpenCode orchestrator as primary agent",
    slug: "0-13-4",
    summary:
      "The OpenCode orchestrator is now generated as a primary agent with default_agent in opencode.json, matching the arvore-hub pattern. Also fixes env var format in MCP config and generates a .ignore file for repo discovery.",
    changes: [
      {
        type: "feat",
        title: "Orchestrator as primary agent",
        description:
          "The orchestrator is now written to .opencode/agents/orchestrator.md with mode: primary and default_agent: orchestrator in opencode.json, instead of being a rule file in .opencode/rules/.",
      },
      {
        type: "feat",
        title: "Generate .ignore file",
        description:
          "hub generate now creates a .ignore file listing all repo names with ! prefix, enabling tools like ripgrep and OpenCode to discover repo directories.",
      },
      {
        type: "fix",
        title: "OpenCode env var format",
        description:
          "MCP environment variables in opencode.json now use the correct {env:VAR} format instead of ${env:VAR} or ${VAR}, matching the OpenCode spec.",
      },
      {
        type: "fix",
        title: "Clean up stale orchestrator rule",
        description:
          "Regenerating now removes the legacy .opencode/rules/orchestrator.md file to prevent conflicts with the new primary agent.",
      },
    ],
  },
  {
    version: "0.13.3",
    date: "2026-03-17",
    title: "Fix YAML frontmatter in design source skills",
    slug: "0-13-3",
    summary:
      "Design source skills with colons in the description field now generate valid YAML frontmatter. Previously, the unquoted colon in 'Design source: name' caused SKILL.md parsing errors.",
    changes: [
      {
        type: "fix",
        title: "Quote description in skill frontmatter",
        description:
          "The buildSkillContent function in design-sources.ts now wraps the description value in double quotes, preventing YAML parsing failures when the value contains colons.",
      },
    ],
  },
  {
    version: "0.13.2",
    date: "2026-03-16",
    title: "Gitignore .agent-teams",
    slug: "0-13-2",
    summary:
      "The .agent-teams directory is now automatically added to .gitignore when agent-teams-lead MCP is configured. Previously, manually adding it would get wiped on hub generate.",
    changes: [
      {
        type: "fix",
        title: "Persist .agent-teams in .gitignore",
        description:
          "The buildGitignoreLines function now conditionally includes .agent-teams/ when the agent-teams-lead MCP is detected, so hub generate no longer removes it from the managed block.",
      },
    ],
  },
  {
    version: "0.13.1",
    date: "2026-03-10",
    title: "Agent Chat",
    slug: "0-13-1",
    summary:
      "Cross-developer agent communication via Slack threads. Your agent can now talk to agents from other developers on the team — opening threads, replying, and checking for new messages proactively.",
    changes: [
      {
        type: "feat",
        title: "Agent Chat MCP",
        description:
          "New agent-teams-chat MCP that connects agents to a shared Slack channel. Agents post with their owner's identity and communicate through threads. Five tools: open_thread, reply_to_thread, read_thread, list_threads, find_thread.",
      },
      {
        type: "feat",
        title: "Proactive Message Checking",
        description:
          "The orchestrator actively monitors for responses after sending messages. It polls threads periodically and checks recent threads for relevant context when starting new tasks.",
      },
      {
        type: "feat",
        title: "Configurable Message Format",
        description:
          "Messages use handlebars-style templates (e.g. 🤖 *{{identity}}'s Agent* — {{message}}). Customizable via the MESSAGE_TEMPLATE environment variable.",
      },
      {
        type: "feat",
        title: "Automatic Orchestrator Instructions",
        description:
          "When agent-teams-chat MCP is detected in your config, hub generate injects an Agent Chat section into the orchestrator prompt with tool docs, proactive polling behavior, and best practices.",
      },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-03-10",
    title: "Agent Teams",
    slug: "0-13-0",
    summary:
      "Inspired by Anthropic's Claude Code agent teams, now available across every editor. Spawn multiple AI teammates that work in parallel, share a task list, and message each other directly.",
    changes: [
      {
        type: "feat",
        title: "Agent Teams",
        description:
          "Your orchestrator can now act as a team lead, spawning multiple AI teammates that work in parallel on different tasks and communicate with each other through a shared mailbox. Built as an editor-agnostic MCP layer that works with Kiro, Cursor, Claude Code, and OpenCode.",
      },
      {
        type: "feat",
        title: "Automatic Orchestrator Instructions",
        description:
          "When agent-teams-lead MCP is detected in your config, hub generate injects a full Agent Teams section into the orchestrator prompt with tool docs, workflow guidance, and best practices.",
      },
      {
        type: "feat",
        title: "Task Coordination & File Locking",
        description:
          "Tasks support dependencies and exclusive file paths to prevent conflicts. Atomic mkdir-based file locking ensures safe parallel work when multiple teammates try to claim the same task.",
      },
      {
        type: "feat",
        title: "Inter-agent Messaging",
        description:
          "Teammates communicate through a shared mailbox with typed messages (info, question, answer, blocker, decision). Direct messages, broadcasts, and lead messages are all supported.",
      },
    ],
  },
  {
    version: "0.12.1",
    date: "2026-03-09",
    title: "Security fix for runtime-lens MCP",
    slug: "0-12-1",
    summary:
      "Fix runtimeLens helper to use the correct scoped package @arvoretech/runtime-lens-mcp instead of the unscoped runtime-lens.",
    changes: [
      {
        type: "fix",
        title: "Scoped package name for runtime-lens",
        description:
          "The mcp.runtimeLens() helper was resolving to the unscoped runtime-lens npm package, which could install an unrelated or malicious package. Updated to use @arvoretech/runtime-lens-mcp.",
      },
    ],
  },
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
