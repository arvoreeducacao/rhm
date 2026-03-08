import { Box, Text, useStdout } from 'ink'
import { colors, symbols } from '../theme.js'
import type { Step } from '../types.js'

const STEP_LABELS: Partial<Record<Step, string>> = {
  name: 'Name',
  editor: 'Editor',
  repos: 'Repositories',
  agents: 'Agents',
  skills: 'Skills',
  mcps: 'MCPs',
  format: 'Config Format',
  summary: 'Review',
}

const ORDERED_STEPS: Step[] = ['name', 'editor', 'repos', 'agents', 'skills', 'mcps', 'format', 'summary']

interface Props {
  currentStep: Step
  children: React.ReactNode
  subtitle?: string
}

export function Screen({ currentStep, children, subtitle }: Props) {
  const { stdout } = useStdout()
  const width = Math.min(stdout?.columns || 80, 100)

  const currentIdx = ORDERED_STEPS.indexOf(currentStep)
  const total = ORDERED_STEPS.length
  const progress = currentIdx >= 0 ? Math.round(((currentIdx + 1) / total) * 100) : 0
  const barWidth = width - 20
  const filled = Math.round((barWidth * progress) / 100)

  return (
    <Box flexDirection="column" width={width}>
      <Box marginBottom={1}>
        <Text color={colors.brand} bold>{symbols.tree} Repo Hub</Text>
        <Text color={colors.dim}> {symbols.line} Interactive Setup</Text>
      </Box>

      {currentIdx >= 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            {ORDERED_STEPS.map((step, i) => {
              const isDone = i < currentIdx
              const isCurrent = i === currentIdx
              const label = STEP_LABELS[step] || step
              if (!isDone && !isCurrent) return null
              return (
                <Box key={step} marginRight={1}>
                  <Text color={isDone ? colors.brand : colors.blue}>
                    {isDone ? symbols.check : symbols.arrow}
                  </Text>
                  <Text color={isDone ? colors.dim : colors.white} bold={isCurrent}>
                    {' '}{label}
                  </Text>
                  {i < currentIdx && <Text color={colors.dim}> {symbols.line}</Text>}
                </Box>
              )
            })}
          </Box>
          <Box>
            <Text color={colors.dim}>[</Text>
            <Text color={colors.brand}>{'█'.repeat(filled)}</Text>
            <Text color={colors.dim}>{'░'.repeat(Math.max(0, barWidth - filled))}</Text>
            <Text color={colors.dim}>] </Text>
            <Text color={colors.muted}>{progress}%</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" paddingLeft={1}>
        {subtitle && (
          <Text color={colors.muted} dimColor>{subtitle}</Text>
        )}
        <Box flexDirection="column" marginTop={subtitle ? 1 : 0}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
