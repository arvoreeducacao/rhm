import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { colors, symbols, horizontalLine } from '../theme.js'
import type { InitState } from '../types.js'

interface Props {
  state: InitState
}

export function DoneStep({ state }: Props) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const width = Math.min(stdout?.columns || 80, 60)

  useInput((_input, key) => {
    if (key.return) exit()
  })

  const configFile = state.configFormat === 'typescript' ? 'hub.config.ts' : 'hub.yaml'

  const stats = [
    { label: 'repos', value: String(state.repos.length) },
    { label: 'agents', value: String(state.agents.length) },
    { label: 'skills', value: String(state.skills.length) },
    { label: 'mcps', value: String(state.mcps.length) },
  ]

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box flexDirection="column" alignItems="center" marginBottom={1} width={width}>
        <Text color={colors.brand}>{horizontalLine(width)}</Text>
        <Text color={colors.brand} bold>
          {symbols.tree}  Workspace ready
        </Text>
        <Text color={colors.brand}>{horizontalLine(width)}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column" alignItems="center">
        <Box>
          <Text color={colors.dim}>name   </Text>
          <Text color={colors.white} bold>{state.hubName}</Text>
        </Box>
        <Box>
          <Text color={colors.dim}>editor </Text>
          <Text color={colors.white}>{state.editor || 'none'}</Text>
        </Box>
        <Box>
          <Text color={colors.dim}>config </Text>
          <Text color={colors.white}>{configFile}</Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        {stats.map((s, i) => (
          <Box key={s.label}>
            {i > 0 && <Text color={colors.dim}>  {symbols.vertical}  </Text>}
            <Text color={colors.brand} bold>{s.value}</Text>
            <Text color={colors.dim}> {s.label}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" alignItems="center" marginBottom={1} width={width}>
        <Text color={colors.dim}>{horizontalLine(width - 10)}</Text>
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text color={colors.muted}>Next steps</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={colors.brand}>{symbols.arrow} </Text>
              <Text color={colors.dim}>cd </Text>
              <Text color={colors.white} bold>{state.hubName}</Text>
            </Box>
            <Box>
              <Text color={colors.brand}>{symbols.arrow} </Text>
              <Text color={colors.dim}>hub </Text>
              <Text color={colors.white} bold>setup</Text>
            </Box>
            <Box>
              <Text color={colors.brand}>{symbols.arrow} </Text>
              <Text color={colors.dim}>hub </Text>
              <Text color={colors.white} bold>generate</Text>
              <Text color={colors.dim}> --editor {state.editor || 'cursor'}</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Text color={colors.dim}>
        {symbols.check} Happy coding {symbols.tree}
      </Text>

      <Box marginTop={1}>
        <Text color={colors.dim}>
          Press <Text color={colors.brand} bold>Enter</Text> to exit
        </Text>
      </Box>
    </Box>
  )
}
