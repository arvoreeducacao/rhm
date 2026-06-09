import { useState, useCallback, useMemo, useEffect } from 'react'
import { Box, useStdout } from 'ink'
import { WelcomeStep } from './components/WelcomeStep.js'
import { NameStep } from './components/NameStep.js'
import { SelectStep } from './components/SelectStep.js'
import { MultiSelectStep } from './components/MultiSelectStep.js'
import { ReposStep } from './components/ReposStep.js'
import { SummaryStep } from './components/SummaryStep.js'
import { CreatingStep } from './components/CreatingStep.js'
import { DoneStep } from './components/DoneStep.js'
import {
  AVAILABLE_EDITORS,
  AVAILABLE_MCPS,
  type InitState,
  type EditorChoice,
  type ConfigFormat,
  type Step,
  type RegistryItem,
} from './types.js'


interface Props {
  defaultName: string
  createWorkspace: (state: InitState) => { label: string; run: () => Promise<void> }[]
}

const DEFAULT_AGENTS = ['refinement', 'coding-backend', 'coding-frontend', 'code-reviewer']
const DIRECTORY_URL = 'https://hub.arvore.com.br/directory.json'
const CLEAR = '\x1B[2J\x1B[H'

export function App({ defaultName, createWorkspace }: Props) {
  const { stdout } = useStdout()

  const [state, setState] = useState<InitState>({
    step: 'welcome',
    hubName: defaultName,
    editor: null,
    repos: [],
    agents: DEFAULT_AGENTS,
    skills: [],
    mcps: [],
    configFormat: 'yaml',
  })

  const [registryAgents, setRegistryAgents] = useState<RegistryItem[]>([])
  const [registrySkills, setRegistrySkills] = useState<RegistryItem[]>([])
  const [registryLoading, setRegistryLoading] = useState(true)
  const [registrySource, setRegistrySource] = useState('')

  useEffect(() => {
    const fetchDirectory = async () => {
      try {
        const res = await fetch(DIRECTORY_URL)
        const items = await res.json() as Array<{ name: string; description: string; type: string; source: string; repo: string }>
        const agents = items
          .filter((i) => i.type === 'agent')
          .map((i) => ({ name: i.name, description: i.description, tags: i.source !== 'registry' ? [i.repo] : undefined }))
        const skills = items
          .filter((i) => i.type === 'skill')
          .map((i) => ({ name: i.name, description: i.description, tags: i.source !== 'registry' ? [i.repo] : undefined }))

        if (agents.length === 0 && skills.length === 0) {
          throw new Error('empty directory')
        }

        setRegistryAgents(agents)
        setRegistrySkills(skills)
        setRegistrySource('from hub.arvore.com.br')
      } catch {
        setRegistryAgents([
          { name: 'refinement', description: 'Collects requirements and defines contracts' },
          { name: 'coding-backend', description: 'Implements backend features' },
          { name: 'coding-frontend', description: 'Implements frontend features' },
          { name: 'code-reviewer', description: 'Reviews code against requirements' },
          { name: 'qa-backend', description: 'Tests backend implementations' },
          { name: 'qa-frontend', description: 'Tests frontend with Playwright' },
          { name: 'debugger', description: 'Investigates bugs and production issues' },
        ])
        setRegistrySkills([
          { name: 'backend-nestjs', description: 'NestJS patterns and conventions' },
          { name: 'frontend-nextjs', description: 'Next.js App Router patterns' },
          { name: 'database-mysql', description: 'MySQL schema and query patterns' },
          { name: 'aws', description: 'AWS infrastructure patterns' },
          { name: 'kubernetes', description: 'Kubernetes/EKS operations' },
          { name: 'qa-test-planner', description: 'Test planning and QA patterns' },
        ])
        setRegistrySource('offline (using defaults)')
      } finally {
        setRegistryLoading(false)
      }
    }
    fetchDirectory()
  }, [])

  const clearAndGo = useCallback((step: Step) => {
    stdout?.write(CLEAR)
    setState((prev) => ({ ...prev, step }))
  }, [stdout])

  const tasks = useMemo(() => {
    if (state.step !== 'creating') return []
    return createWorkspace(state)
  }, [state.step, state, createWorkspace])

  const skillTechMap: Record<string, string[]> = {
    'backend-nestjs': ['nestjs'],
    'frontend-nextjs': ['nextjs'],
    'backend-elixir': ['elixir'],
    'frontend-react': ['react'],
  }

  const repoTechs = new Set(state.repos.map((r) => r.tech).filter(Boolean))

  return (
    <Box flexDirection="column">
      {state.step === 'welcome' && (
        <WelcomeStep onContinue={() => clearAndGo('name')} />
      )}

      {state.step === 'name' && (
        <NameStep
          initialValue={state.hubName}
          onSubmit={(name) => {
            stdout?.write(CLEAR)
            setState((prev) => ({ ...prev, hubName: name, step: 'editor' }))
          }}
        />
      )}

      {state.step === 'editor' && (
        <SelectStep
          step="editor"
          subtitle="Which AI editor will you use?"
          items={AVAILABLE_EDITORS.map((e) => ({ label: e.label, value: e.value }))}
          onSelect={(value) => {
            stdout?.write(CLEAR)
            setState((prev) => ({ ...prev, editor: value as EditorChoice, step: 'repos' }))
          }}
        />
      )}

      {state.step === 'repos' && (
        <ReposStep
          repos={state.repos}
          onSubmit={(repos) => {
            stdout?.write(CLEAR)
            setState((prev) => ({ ...prev, repos, step: 'agents' }))
          }}
        />
      )}

      {state.step === 'agents' && (
        <MultiSelectStep
          step="agents"
          subtitle="Select agents for your development pipeline"
          source={registrySource}
          items={registryAgents.map((a) => ({
            name: a.name,
            description: a.description,
            defaultSelected: DEFAULT_AGENTS.includes(a.name),
            tags: a.tags,
          }))}
          onSubmit={(agents) => {
            stdout?.write(CLEAR)
            const recommended = registrySkills
              .filter((s) => {
                const techs = skillTechMap[s.name]
                return techs?.some((t) => repoTechs.has(t))
              })
              .map((s) => s.name)

            setState((prev) => ({
              ...prev,
              agents,
              skills: recommended,
              step: 'skills',
            }))
          }}
          loading={registryLoading}
        />
      )}

      {state.step === 'skills' && (
        <MultiSelectStep
          step="skills"
          subtitle="Select skills — recommended ones for your tech stack are pre-selected ★"
          source={registrySource}
          items={registrySkills.map((s) => {
            const techs = skillTechMap[s.name]
            const isRecommended = techs?.some((t) => repoTechs.has(t)) ?? false
            return {
              name: s.name,
              description: s.description,
              defaultSelected: state.skills.includes(s.name),
              recommended: isRecommended,
              tags: s.tags,
            }
          })}
          onSubmit={(skills) => {
            stdout?.write(CLEAR)
            setState((prev) => ({ ...prev, skills, step: 'mcps' }))
          }}
          loading={registryLoading}
        />
      )}

      {state.step === 'mcps' && (
        <MultiSelectStep
          step="mcps"
          subtitle="Select MCP servers to connect your AI to infrastructure"
          items={AVAILABLE_MCPS.map((m) => ({
            name: m.name,
            description: m.description,
            defaultSelected: m.name === 'playwright',
          }))}
          onSubmit={(mcps) => {
            stdout?.write(CLEAR)
            setState((prev) => ({ ...prev, mcps, step: 'format' }))
          }}
        />
      )}

      {state.step === 'format' && (
        <SelectStep
          step="format"
          subtitle="How do you want to define your hub configuration?"
          items={[
            { label: 'YAML', value: 'yaml', hint: '— hub.yaml (simple, declarative)' },
            { label: 'TypeScript', value: 'typescript', hint: '— hub.config.ts (composable, type-safe)' },
          ]}
          onSelect={(value) => {
            stdout?.write(CLEAR)
            setState((prev) => ({
              ...prev,
              configFormat: value as ConfigFormat,
              step: 'summary',
            }))
          }}
        />
      )}

      {state.step === 'summary' && (
        <SummaryStep
          state={state}
          onConfirm={() => clearAndGo('creating')}
          onBack={() => clearAndGo('format')}
        />
      )}

      {state.step === 'creating' && (
        <CreatingStep tasks={tasks} onDone={() => clearAndGo('done')} />
      )}

      {state.step === 'done' && <DoneStep state={state} />}
    </Box>
  )
}
