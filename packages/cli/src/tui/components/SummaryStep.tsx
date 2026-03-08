import { Box, Text, useInput } from 'ink'
import { Screen } from './Screen.js'
import { colors } from '../theme.js'
import type { InitState } from '../types.js'

interface Props {
  state: InitState
  onConfirm: () => void
  onBack: () => void
}

function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Box>
      <Box width={12}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Text color={colors.white} bold>{value}</Text>
      {detail && <Text color={colors.dim}> {detail}</Text>}
    </Box>
  )
}

export function SummaryStep({ state, onConfirm, onBack }: Props) {
  useInput((input, key) => {
    if (key.return || input === 'y') onConfirm()
    if (input === 'b' || key.leftArrow) onBack()
  })

  return (
    <Screen currentStep="summary" subtitle="Review your configuration before creating">
      <Box flexDirection="column">
        <Box flexDirection="column" paddingLeft={1} borderStyle="round" borderColor={colors.dim} paddingRight={1} paddingTop={0} paddingBottom={0}>
          <SummaryRow label="Name" value={state.hubName} />
          <SummaryRow label="Editor" value={state.editor || 'none'} />
          <SummaryRow label="Format" value={state.configFormat === 'typescript' ? 'hub.config.ts' : 'hub.yaml'} />
          <SummaryRow
            label="Repos"
            value={String(state.repos.length)}
            detail={state.repos.length > 0 ? `(${state.repos.map((r) => r.name).join(', ')})` : undefined}
          />
          <SummaryRow
            label="Agents"
            value={String(state.agents.length)}
            detail={state.agents.length > 0 ? `(${state.agents.join(', ')})` : undefined}
          />
          <SummaryRow
            label="Skills"
            value={String(state.skills.length)}
            detail={state.skills.length > 0 ? `(${state.skills.join(', ')})` : undefined}
          />
          <SummaryRow
            label="MCPs"
            value={String(state.mcps.length)}
            detail={state.mcps.length > 0 ? `(${state.mcps.join(', ')})` : undefined}
          />
        </Box>

        <Box marginTop={1}>
          <Text color={colors.dim}>
            <Text color={colors.brand}>enter</Text> create workspace  <Text color={colors.muted}>b</Text> go back
          </Text>
        </Box>
      </Box>
    </Screen>
  )
}
