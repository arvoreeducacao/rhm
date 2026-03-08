import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { InitState } from './types.js'
import { downloadDirFromGitHub } from '../commands/registry.js'

const SCHEMA_COMMENT =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/arvoreeducacao/rhm/main/schemas/hub.schema.json\n'

const REPO_HELPER_MAP: Record<string, string> = {
  nestjs: 'repo.nestjs',
  nextjs: 'repo.nextjs',
  react: 'repo.react',
  elixir: 'repo.elixir',
  go: 'repo.go',
  python: 'repo.python',
}

interface McpHelperInfo {
  helper: string
  hasNameArg: boolean
}

const MCP_HELPER_MAP: Record<string, McpHelperInfo> = {
  postgresql: { helper: 'mcp.postgresql', hasNameArg: true },
  mysql: { helper: 'mcp.mysql', hasNameArg: true },
  clickhouse: { helper: 'mcp.clickhouse', hasNameArg: true },
  datadog: { helper: 'mcp.datadog', hasNameArg: false },
  memory: { helper: 'mcp.memory', hasNameArg: false },
  sendgrid: { helper: 'mcp.sendgrid', hasNameArg: false },
  launchdarkly: { helper: 'mcp.launchdarkly', hasNameArg: false },
  tempmail: { helper: 'mcp.tempmail', hasNameArg: false },
  'aws-secrets-manager': { helper: 'mcp.awsSecretsManager', hasNameArg: false },
  'npm-registry': { helper: 'mcp.npmRegistry', hasNameArg: false },
  'runtime-lens': { helper: 'mcp.runtimeLens', hasNameArg: false },
  'meet-transcriptions': { helper: 'mcp.meetTranscriptions', hasNameArg: false },
  'google-chat': { helper: 'mcp.googleChat', hasNameArg: false },
  playwright: { helper: 'mcp.playwright', hasNameArg: false },
  context7: { helper: 'mcp.context7', hasNameArg: false },
  'mcp-proxy': { helper: 'mcp.proxy', hasNameArg: true },
}

function buildTypeScriptConfig(state: InitState): string {
  const lines: string[] = []
  lines.push('import { defineConfig, repo, mcp } from "@arvoretech/hub/config";')
  lines.push('')
  lines.push('export default defineConfig({')
  lines.push(`  name: "${state.hubName}",`)
  lines.push('')

  lines.push('  repos: [')
  for (const r of state.repos) {
    const helper = r.tech ? REPO_HELPER_MAP[r.tech] : undefined
    if (helper) {
      lines.push(`    ${helper}("${r.name}", "${r.url}"),`)
    } else {
      lines.push(`    repo.custom("${r.name}", "${r.url}"),`)
    }
  }
  lines.push('  ],')
  lines.push('')

  if (state.mcps.length > 0) {
    lines.push('  mcps: [')
    for (const name of state.mcps) {
      const info = MCP_HELPER_MAP[name]
      if (info) {
        lines.push(`    ${info.helper}(${info.hasNameArg ? `"${name}"` : ''}),`)
      } else {
        lines.push(`    mcp.custom("${name}"),`)
      }
    }
    lines.push('  ],')
    lines.push('')
  }

  lines.push('  integrations: {')
  lines.push('    github: { pr_branch_pattern: "{task_id}-{slug}" },')
  lines.push('    slack: { channels: { prs: "#eng-prs" } },')
  lines.push('  },')
  lines.push('')

  const pipeline = buildPipeline(state.agents)
  lines.push('  workflow: {')
  lines.push('    task_folder: "./tasks/{task_id}/",')
  lines.push(`    pipeline: ${JSON.stringify(pipeline, null, 6).replace(/\n/g, '\n    ')},`)
  lines.push('  },')

  lines.push('});')
  lines.push('')

  return lines.join('\n')
}

function buildYamlConfig(state: InitState): string {
  const config: Record<string, unknown> = {
    name: state.hubName,
    repos: state.repos.map((r) => ({
      name: r.name,
      path: `./${r.name}`,
      url: r.url,
      ...(r.tech && { tech: r.tech }),
    })),
    services: [],
    mcps: state.mcps.map((name) => ({ name })),
    integrations: {
      github: { pr_branch_pattern: '{task_id}-{slug}' },
      slack: { channels: { prs: '#eng-prs' } },
    },
    workflow: {
      task_folder: './tasks/{task_id}/',
      pipeline: buildPipeline(state.agents),
    },
  }
  return SCHEMA_COMMENT + stringify(config)
}

function buildPipeline(agents: string[]) {
  const pipeline: Record<string, unknown>[] = []
  const hasAgent = (name: string) => agents.includes(name)

  if (hasAgent('refinement')) {
    pipeline.push({ step: 'refinement', agent: 'refinement', output: 'refinement.md' })
  }

  const codingAgents = ['coding-backend', 'coding-frontend'].filter(hasAgent)
  if (codingAgents.length > 0) {
    pipeline.push({
      step: 'coding',
      agents: codingAgents,
      parallel: codingAgents.length > 1,
    })
  }

  if (hasAgent('code-reviewer')) {
    pipeline.push({ step: 'review', agent: 'code-reviewer', output: 'code-review.md' })
  }

  const qaAgents = ['qa-backend', 'qa-frontend'].filter(hasAgent)
  if (qaAgents.length > 0) {
    pipeline.push({
      step: 'qa',
      agents: qaAgents,
      parallel: qaAgents.length > 1,
      tools: ['playwright'],
    })
  }

  pipeline.push({ step: 'deliver', actions: ['create-pr', 'notify-slack'] })

  return pipeline
}

function buildGitignore(state: InitState): string {
  const lines = [
    'node_modules/',
    '.DS_Store',
    '',
    ...state.repos.map((r) => r.name),
    '',
    '*_data/',
    '',
    '*.env',
    '*.env.local',
    '!.env.example',
    '',
    'tasks/',
    '',
  ]
  return lines.join('\n')
}

function buildReadme(state: InitState): string {
  const editorFlag = state.editor ? ` --editor ${state.editor}` : ''
  return [
    `# ${state.hubName}`,
    '',
    `Powered by [Repo Hub](https://github.com/arvoreeducacao/rhm).`,
    '',
    '## Getting Started',
    '',
    '```bash',
    'hub setup',
    `hub generate${editorFlag}`,
    '```',
    '',
  ].join('\n')
}

export function createWorkspaceTasks(
  state: InitState,
  targetDir: string,
): { label: string; run: () => Promise<void> }[] {
  const tasks: { label: string; run: () => Promise<void> }[] = []

  tasks.push({
    label: 'Create directories',
    run: async () => {
      await mkdir(targetDir, { recursive: true })
      await mkdir(join(targetDir, 'tasks'), { recursive: true })
      await mkdir(join(targetDir, 'agents'), { recursive: true })
      await mkdir(join(targetDir, 'skills'), { recursive: true })
      await mkdir(join(targetDir, 'steering'), { recursive: true })
    },
  })

  tasks.push({
    label: `Write ${state.configFormat === 'typescript' ? 'hub.config.ts' : 'hub.yaml'}`,
    run: async () => {
      if (state.configFormat === 'typescript') {
        await writeFile(join(targetDir, 'hub.config.ts'), buildTypeScriptConfig(state), 'utf-8')
      } else {
        await writeFile(join(targetDir, 'hub.yaml'), buildYamlConfig(state), 'utf-8')
      }
    },
  })

  tasks.push({
    label: 'Write .gitignore and README',
    run: async () => {
      await writeFile(join(targetDir, '.gitignore'), buildGitignore(state), 'utf-8')
      await writeFile(join(targetDir, 'README.md'), buildReadme(state), 'utf-8')
    },
  })

  if (state.agents.length > 0) {
    tasks.push({
      label: `Install ${state.agents.length} agents from registry`,
      run: async () => {
        const agentsDir = join(targetDir, 'agents')
        for (const agent of state.agents) {
          try {
            const url = `https://raw.githubusercontent.com/arvoreeducacao/rhm/main/agents/${agent}.md`
            const res = await fetch(url)
            if (res.ok) {
              const content = await res.text()
              await writeFile(join(agentsDir, `${agent}.md`), content, 'utf-8')
            }
          } catch {
            // skip
          }
        }
      },
    })
  }

  if (state.skills.length > 0) {
    tasks.push({
      label: `Install ${state.skills.length} skills from registry`,
      run: async () => {
        const skillsDir = join(targetDir, 'skills')
        for (const skill of state.skills) {
          try {
            await downloadDirFromGitHub(
              'arvoreeducacao/rhm',
              `skills/${skill}`,
              join(skillsDir, skill),
            )
          } catch {
            // skip
          }
        }
      },
    })
  }

  return tasks
}
