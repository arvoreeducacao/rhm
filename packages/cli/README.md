# Repo Hub

**You describe a feature. Your AI codes it, reviews it, tests it, and opens a pull request.**

Repo Hub is a configuration file (`hub.yaml`) that teaches your AI coding assistant how your company builds software. You declare your repositories, your tools, and your development workflow. The AI follows it — from understanding requirements to delivering a tested PR.

Think of it like a **docker-compose for AI-powered development**. Instead of defining containers, you define how your AI should work.

```
You: "Add profile editing to user settings"
  ↓
AI refines requirements → writes backend + frontend → reviews code → runs tests → opens PR → notifies Slack
  ↓
You: review the PR
```

Built and battle-tested by [Arvore](https://arvore.com.br), where 10 engineers use this every day to ship real software.

---

## The 30-second version

**Without Repo Hub**, your AI coding assistant:
- Sees one repo at a time (doesn't know the API changed when editing the frontend)
- Does one thing at a time (you manually orchestrate every step)
- Can't use your tools (can't check logs, query databases, or run browser tests)

**With Repo Hub**, you write a config file that tells the AI:
- **Which repos** to work on (and it sees all of them at once)
- **Which tools** it can use (databases, monitoring, browser testing, etc.)
- **What workflow** to follow (refine → code → review → test → deliver)

One CLI command generates the config your editor needs. Done.

---

## What is this, actually?

### It's a config file

Everything starts with a config file — either `hub.yaml` or `hub.config.ts`. Here's a minimal YAML example:

```yaml
name: my-company

repos:
  - name: api
    url: git@github.com:company/api.git
    tech: nestjs
  - name: frontend
    url: git@github.com:company/frontend.git
    tech: nextjs

mcps:
  - name: postgresql
  - name: playwright

workflow:
  pipeline:
    - step: refinement
    - step: coding
    - step: review
    - step: qa
    - step: deliver
      actions: [create-pr, notify-slack]
```

And the same thing in TypeScript with type-safe helpers:

```typescript
import { defineConfig, repo, mcp } from "@arvoretech/hub/config";

export default defineConfig({
  name: "my-company",
  repos: [
    repo.nestjs("api", "git@github.com:company/api.git"),
    repo.nextjs("frontend", "git@github.com:company/frontend.git"),
  ],
  mcps: [
    mcp.postgresql("main-db"),
    mcp.playwright(),
  ],
  workflow: {
    pipeline: [
      { step: "refinement", agent: "refinement" },
      { step: "coding", agents: ["coding-backend", "coding-frontend"] },
      { step: "review", agent: "code-reviewer" },
      { step: "deliver", actions: ["create-pr", "notify-slack"] },
    ],
  },
});
```

The CLI auto-detects which format you're using (`hub.config.ts` takes priority over `hub.yaml`).

### It becomes editor instructions

When you run `hub generate --editor <editor>`, the CLI reads your YAML and produces config files your editor understands:

```
hub generate --editor cursor
  → .cursor/rules/orchestrator.mdc   (the AI's playbook)
  → .cursor/agents/*.md              (specialized AI roles)
  → .cursor/skills/*.md              (coding patterns and conventions)
  → .cursor/mcp.json                 (tool connections)

hub generate --editor kiro
  → .kiro/steering/orchestrator.md   (the AI's playbook)
  → .kiro/steering/agent-*.md        (specialized AI roles)
  → .kiro/skills/*.md                (coding patterns and conventions)
  → .kiro/settings/mcp.json          (tool connections)
  → AGENTS.md                        (standard agents.md)
```

### Your editor is the runtime

There's no server. No daemon. No separate process. Your AI editor (Cursor, Claude Code, Kiro) reads the generated config and follows the workflow automatically when you ask it to build something.

---

## Key concepts (the jargon, explained)

| Concept | What it means | Analogy |
|---------|--------------|---------|
| **Agents** | Specialized AI roles — one refines, one codes, one reviews, one tests | Team members with specific jobs |
| **MCPs** | Plugins that connect AI to your tools (databases, monitoring, etc.) | Browser extensions, but for AI |
| **Skills** | Written docs that teach AI your coding patterns and conventions | Onboarding docs for a new hire |
| **Pipeline** | The step-by-step workflow the AI follows for every feature | A CI/CD pipeline, but for the entire dev process |
| **Hub Workspace** | A folder containing all your repos (each keeps its own git) | A VS Code workspace, but for AI |

### What are MCPs?

MCP stands for **Model Context Protocol**. In practice, it's a standard way to give AI access to external tools. Instead of you copy-pasting database schemas or log outputs, the AI queries them directly.

Examples:
- **Database MCP**: AI queries your PostgreSQL schema to write correct migrations
- **Datadog MCP**: AI reads error logs to debug a production issue
- **Playwright MCP**: AI opens a browser and clicks through your app to test it
- **AWS Secrets MCP**: AI reads environment config without you sharing credentials

---

## Quick Start

```bash
npx @arvoretech/hub init my-hub
```

This launches an interactive TUI that walks you through:
1. Naming your workspace
2. Choosing your AI editor (Cursor, Kiro, Claude Code, OpenCode)
3. Adding repositories with tech stack detection
4. Selecting agents and skills from the registry
5. Picking MCP servers for tool access
6. Choosing config format (YAML or TypeScript)

Once done:

```bash
cd my-hub
npx @arvoretech/hub setup
npx @arvoretech/hub generate --editor cursor
```

Open in your editor (Cursor, Kiro, etc.). Describe a feature. Watch it happen.

---

## What does the AI actually do?

Here's a concrete example of what happens when you say _"Add profile editing to the user settings page"_:

```
1. REFINEMENT
   The AI asks: "Should users be able to change their email?
   Should there be an avatar upload? What fields are editable?"
   → Writes a requirements doc

2. CODING (parallel)
   Backend agent: Creates PATCH /users/profile endpoint
   Frontend agent: Builds the settings form with validation
   → Each writes in the correct repo, following your patterns

3. REVIEW
   Review agent: Checks code against the requirements doc
   "The frontend doesn't handle the avatar upload error case"
   → Coding agent fixes it

4. QA
   QA agent: Opens a browser, fills in the form, submits, verifies
   → Reports pass/fail with screenshots

5. DELIVERY
   Creates PRs in each repo
   Posts summary in #eng-prs on Slack
   Updates the task in Linear
```

**You review the PRs. That's your job now.**

---

## Not a monorepo

This is important: **your repos stay completely independent**. Their own git history, their own branches, their own PRs. Repo Hub doesn't merge anything.

It's a **workspace layer** — a folder that contains your repos side by side so the AI can see them all at once. Like opening multiple projects in VS Code, but with shared context.

- No migration needed
- No shared build system
- No lock-in

---

## The full hub.yaml

Here's what a production config looks like:

```yaml
name: my-company

repos:
  - name: api
    path: ./api
    url: git@github.com:company/api.git
    tech: nestjs
    env_file: .env
    commands:
      install: pnpm install
      dev: pnpm dev
      build: pnpm build
      lint: pnpm lint
      test: pnpm test
    skills: [backend-nestjs]

  - name: frontend
    path: ./frontend
    url: git@github.com:company/frontend.git
    tech: nextjs
    env_file: .env.local
    commands:
      install: pnpm install
      dev: pnpm dev
      build: pnpm build

services:
  - name: postgres
    image: postgres:16
    port: 5432
  - name: redis
    image: redis:7-alpine
    port: 6379

env:
  profiles:
    local:
      description: "Local development"
    staging:
      aws_profile: my-company-stg
      secrets:
        api: api-staging-secret
    prod:
      aws_profile: my-company-prd
      secrets:
        api: api-prod-secret

mcps:
  - name: postgresql
    package: "@arvoretech/postgresql-mcp"
  - name: playwright
    package: "@playwright/mcp"
  - name: datadog
    package: "@arvoretech/datadog-mcp"

integrations:
  github:
    pr_branch_pattern: "{linear_id}-{slug}"
  slack:
    channels:
      prs: "#eng-prs"
  linear:
    team: Engineering

workflow:
  pipeline:
    - step: refinement
      agent: refinement
      output: refinement.md
    - step: coding
      agents: [coding-backend, coding-frontend]
      parallel: true
    - step: review
      agent: code-reviewer
      output: code-review.md
    - step: qa
      agents: [qa-backend, qa-frontend]
      parallel: true
      tools: [playwright]
    - step: deliver
      actions: [create-pr, notify-slack]
```

---

## Available MCPs

| MCP | What AI can do with it |
|-----|----------------------|
| `@arvoretech/postgresql-mcp` | Query your database schema and data (read-only) |
| `@arvoretech/mysql-mcp` | Query MySQL databases (read-only) |
| `@arvoretech/aws-secrets-manager-mcp` | Read environment configuration and secrets |
| `@arvoretech/datadog-mcp` | Read metrics, logs, and traces for debugging |
| `@arvoretech/npm-registry-mcp` | Check package security and versions |
| `@arvoretech/tempmail-mcp` | Create temporary emails for E2E test flows |
| `@playwright/mcp` | Control a browser to test your app |

MCPs are maintained at [arvore-mcp-servers](https://github.com/arvoreeducacao/arvore-mcp-servers).

---

## Supported Editors

| Editor | Status | Command |
|--------|--------|---------|
| Cursor | Supported | `hub generate --editor cursor` |
| Claude Code | Supported | `hub generate --editor claude-code` |
| Kiro | Supported | `hub generate --editor kiro` |
| Windsurf | Planned | — |
| Copilot Workspace | Planned | — |

---

## Real Results

At Arvore, Repo Hub powers our entire development workflow:

- **10x productivity** with a team 3x smaller
- **9 repositories** managed as a single AI-aware workspace
- **11 specialized AI roles** collaborating in structured pipelines
- **19 tool connections** giving AI access to databases, monitoring, secrets, and testing

This is not a demo. We ship production software with this every week.

---

## Project Structure

```
repo-hub-manifest/
├── packages/cli/         # @arvoretech/hub CLI
├── agents/               # Agent templates
├── skills/               # Built-in coding pattern libraries
├── docs/                 # Reference documentation
└── examples/             # Example configurations
    ├── arvore/           # Real-world: 9 repos, full pipeline
    └── nestjs-nextjs/    # Minimal: 2 repos
```

---

## Contributing

We welcome contributions. Areas where help is needed:

- **Editor adapters** — Windsurf, Copilot Workspace
- **Skills** — More frameworks (Go, Python/Django, Java/Spring, Vue, Svelte)
- **Agent patterns** — New roles, better prompts, workflow variations
- **MCPs** — New tool integrations
- **Documentation** — Guides, tutorials, videos

## License

MIT

---

<p align="center">
  Built with AI, for AI, by <a href="https://arvore.com.br">Arvore</a>
</p>
