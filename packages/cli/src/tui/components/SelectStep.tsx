import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { Screen } from './Screen.js'
import { colors, symbols } from '../theme.js'
import type { Step } from '../types.js'

interface Item {
  label: string
  value: string
  hint?: string
}

interface Props {
  step: Step
  subtitle?: string
  items: Item[]
  onSelect: (value: string) => void
}

export function SelectStep({ step, subtitle, items, onSelect }: Props) {
  const [cursor, setCursor] = useState(0)

  useInput((_input, key) => {
    if (key.upArrow) setCursor((p) => (p > 0 ? p - 1 : items.length - 1))
    if (key.downArrow) setCursor((p) => (p < items.length - 1 ? p + 1 : 0))
    if (key.return) onSelect(items[cursor].value)
  })

  return (
    <Screen currentStep={step} subtitle={subtitle}>
      <Box flexDirection="column">
        {items.map((item, i) => {
          const active = i === cursor
          return (
            <Box key={item.value}>
              <Text color={active ? colors.brand : colors.dim}>
                {active ? `${symbols.arrow} ` : '  '}
              </Text>
              <Text color={active ? colors.white : colors.muted} bold={active}>
                {item.label}
              </Text>
              {item.hint && (
                <Text color={colors.dim}> {item.hint}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    </Screen>
  )
}
