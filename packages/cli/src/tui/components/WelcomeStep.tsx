import { Box, Text, useInput } from 'ink'
import { colors, symbols } from '../theme.js'

interface Props {
  onContinue: () => void
}

const LOGO = [
  '              🌿              ',
  '             /||\\             ',
  '            / || \\            ',
  '           /  ||  \\           ',
  '          /  /||\\  \\          ',
  '         /  / || \\  \\         ',
  '        /  /  ||  \\  \\        ',
  '       /  /  /||\\  \\  \\       ',
  '      /  /  / || \\  \\  \\      ',
  '     /  /  /  ||  \\  \\  \\     ',
  '    /__/__/___||___\\__\\__\\    ',
  '             ||||             ',
  '             ||||             ',
  '             ||||             ',
  '          ___||||___          ',
]

export function WelcomeStep({ onContinue }: Props) {
  useInput((_input, key) => {
    if (key.return) onContinue()
  })

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        {LOGO.map((line, i) => (
          <Text key={i} color={i < 11 ? colors.brand : '#8B6914'}>{line}</Text>
        ))}
      </Box>
      <Box marginBottom={1}>
        <Text color={colors.brand} bold>
          {symbols.tree} Repo Hub
        </Text>
      </Box>
      <Text color={colors.white} bold>
        Give your AI coding assistant the full picture.
      </Text>
      <Text color={colors.muted}>
        Multi-repo context, agent orchestration, and end-to-end workflows.
      </Text>
      <Box marginTop={2}>
        <Text color={colors.dim}>
          Press <Text color={colors.brand} bold>Enter</Text> to get started
        </Text>
      </Box>
    </Box>
  )
}
