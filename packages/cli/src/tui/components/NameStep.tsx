import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { Screen } from './Screen.js'
import { colors } from '../theme.js'

interface Props {
  initialValue: string
  onSubmit: (name: string) => void
}

export function NameStep({ initialValue, onSubmit }: Props) {
  const [value, setValue] = useState(initialValue)

  return (
    <Screen currentStep="name" subtitle="Choose a name for your workspace">
      <Box flexDirection="column">
        <Box>
          <Text color={colors.brand} bold>{'❯ '}</Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={() => {
              if (value.trim()) onSubmit(value.trim())
            }}
            placeholder="my-hub"
          />
        </Box>
        <Box marginTop={1}>
          <Text color={colors.dim}>
            This will create a <Text color={colors.white}>./{value || 'my-hub'}</Text> directory
          </Text>
        </Box>
      </Box>
    </Screen>
  )
}
