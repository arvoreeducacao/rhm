export type EditorChoice = 'pi' | 'cursor' | 'kiro' | 'claude-code' | 'opencode'
export type ConfigFormat = 'typescript' | 'yaml'

export interface RepoEntry {
  url: string
  name: string
  tech?: string
}

export interface RegistryItem {
  name: string
  description: string
  tags?: string[]
}

export interface InitState {
  step: Step
  hubName: string
  editor: EditorChoice | null
  repos: RepoEntry[]
  skills: string[]
  mcps: string[]
  configFormat: ConfigFormat
}

export type Step =
  | 'welcome'
  | 'name'
  | 'editor'
  | 'repos'
  | 'skills'
  | 'mcps'
  | 'format'
  | 'summary'
  | 'creating'
  | 'done'

export const AVAILABLE_EDITORS: { label: string; value: EditorChoice }[] = [
  { label: 'Pi', value: 'pi' },
  { label: 'Cursor', value: 'cursor' },
  { label: 'Kiro', value: 'kiro' },
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'OpenCode', value: 'opencode' },
]

export const AVAILABLE_MCPS: RegistryItem[] = [
  { name: 'postgresql', description: 'Read-only PostgreSQL database operations' },
  { name: 'mysql', description: 'Read-only MySQL database operations' },
  { name: 'clickhouse', description: 'Read-only ClickHouse database operations' },
  { name: 'datadog', description: 'Monitoring and observability data' },
  { name: 'aws-secrets-manager', description: 'AWS Secrets Manager for managing secrets' },
  { name: 'launchdarkly', description: 'Feature flag management' },
  { name: 'sendgrid', description: 'SendGrid dynamic email templates' },
  { name: 'npm-registry', description: 'NPM package information and security checks' },
  { name: 'memory', description: 'Team knowledge base with semantic search' },
  { name: 'runtime-lens', description: 'Runtime inspection with inline values for React/NestJS/Next.js' },
  { name: 'meet-transcriptions', description: 'Semantic search across meeting transcriptions' },
  { name: 'google-chat', description: 'Google Chat spaces, members, and messages' },
  { name: 'tempmail', description: 'Temporary email for testing' },
  { name: 'agent-teams-lead', description: 'Spawn AI teammate teams that work in parallel on tasks' },
  { name: 'agent-teams-chat', description: 'Cross-developer agent communication via Slack threads' },
  { name: 'mcp-proxy', description: 'Proxy gateway that reduces token usage via mcp_search/mcp_call' },
  { name: 'kanban', description: 'Kanban board for managing agent tasks across sessions' },
]
