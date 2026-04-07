import { useState, useCallback } from 'react'
import { Box, Text, useInput, useStdout, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { colors, symbols } from './theme.js'

export interface PersonaData {
  name: string
  role: string
  context: string
  technical_level: 'non-technical' | 'beginner' | 'intermediate' | 'advanced'
  language: string
}

type PersonaStep = 'name' | 'role' | 'technical_level' | 'context' | 'language' | 'review' | 'done'

const TECHNICAL_LEVELS = [
  { value: 'non-technical' as const, label: 'Non-technical', description: 'No coding experience — CEO, PM, designer, etc.' },
  { value: 'beginner' as const, label: 'Beginner', description: 'Learning to code or just started working with devs' },
  { value: 'intermediate' as const, label: 'Intermediate', description: 'Comfortable with code, still learning some tools' },
  { value: 'advanced' as const, label: 'Advanced', description: 'Experienced developer, knows the stack well' },
]

const STEP_INFO: Record<string, { title: string; subtitle: string }> = {
  name: { title: 'What\'s your name?', subtitle: 'So the AI knows who it\'s talking to.' },
  role: { title: 'What\'s your role?', subtitle: 'e.g. CEO, Product Manager, Designer, Backend Dev, QA Engineer...' },
  technical_level: { title: 'How technical are you?', subtitle: 'This changes how the AI explains things to you.' },
  context: { title: 'Anything else the AI should know about you?', subtitle: 'e.g. "I focus on business metrics", "I only work on the mobile app", "I review PRs but don\'t code"' },
  language: { title: 'What language should the AI use?', subtitle: 'e.g. English, Português, Español...' },
}

interface Props {
  existing?: PersonaData
  onComplete: (persona: PersonaData) => void
}

export function PersonaApp({ existing, onComplete }: Props) {
  const { stdout } = useStdout()
  const { exit } = useApp()
  const width = Math.min(stdout?.columns || 80, 80)
  const CLEAR = '\x1B[2J\x1B[H'

  const [step, setStep] = useState<PersonaStep>('name')
  const [data, setData] = useState<PersonaData>({
    name: existing?.name || '',
    role: existing?.role || '',
    context: existing?.context || '',
    technical_level: existing?.technical_level || 'intermediate',
    language: existing?.language || 'English',
  })
  const [inputValue, setInputValue] = useState(existing?.name || '')
  const [levelCursor, setLevelCursor] = useState(
    TECHNICAL_LEVELS.findIndex((l) => l.value === (existing?.technical_level || 'intermediate'))
  )

  const goTo = useCallback((next: PersonaStep) => {
    stdout?.write(CLEAR)
    setStep(next)
  }, [stdout])

  const handleTextSubmit = useCallback((value: string, field: keyof PersonaData, next: PersonaStep) => {
    if (!value.trim()) return
    setData((prev) => ({ ...prev, [field]: value.trim() }))
    setInputValue('')
    goTo(next)
  }, [goTo])

  useInput((input, key) => {
    if (step === 'technical_level') {
      if (key.upArrow) setLevelCursor((p) => (p > 0 ? p - 1 : TECHNICAL_LEVELS.length - 1))
      if (key.downArrow) setLevelCursor((p) => (p < TECHNICAL_LEVELS.length - 1 ? p + 1 : 0))
      if (key.return) {
        setData((prev) => ({ ...prev, technical_level: TECHNICAL_LEVELS[levelCursor].value }))
        setInputValue(data.context || '')
        goTo('context')
      }
    }
    if (step === 'review') {
      if (key.return || input === 'y') {
        onComplete(data)
        goTo('done')
      }
      if (input === 'b' || key.leftArrow) {
        setInputValue(data.name)
        goTo('name')
      }
    }
    if (step === 'done' && key.return) {
      exit()
    }
  })

  const info = STEP_INFO[step]

  return (
    <Box flexDirection="column" width={width}>
      <Box marginBottom={1}>
        <Text color={colors.brand} bold>{symbols.tree} Repo Hub</Text>
        <Text color={colors.dim}> {symbols.line} Persona Setup</Text>
      </Box>

      {info && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
          <Text color={colors.white} bold>{info.title}</Text>
          <Text color={colors.dim}>{info.subtitle}</Text>
        </Box>
      )}

      <Box flexDirection="column" paddingLeft={2}>
        {step === 'name' && (
          <Box>
            <Text color={colors.brand} bold>{'❯ '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(v) => {
                handleTextSubmit(v, 'name', 'role')
                setInputValue(data.role || '')
              }}
              placeholder="João"
            />
          </Box>
        )}

        {step === 'role' && (
          <Box>
            <Text color={colors.brand} bold>{'❯ '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(v) => {
                handleTextSubmit(v, 'role', 'technical_level')
              }}
              placeholder="CEO"
            />
          </Box>
        )}

        {step === 'technical_level' && (
          <Box flexDirection="column">
            {TECHNICAL_LEVELS.map((level, i) => {
              const active = i === levelCursor
              return (
                <Box key={level.value} flexDirection="column" marginBottom={1}>
                  <Box>
                    <Text color={active ? colors.brand : colors.dim}>
                      {active ? `${symbols.arrow} ` : '  '}
                    </Text>
                    <Text color={active ? colors.white : colors.muted} bold={active}>
                      {level.label}
                    </Text>
                  </Box>
                  <Box paddingLeft={4}>
                    <Text color={colors.dim}>{level.description}</Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}

        {step === 'context' && (
          <Box flexDirection="column">
            <Box>
              <Text color={colors.brand} bold>{'❯ '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={(v) => {
                  setData((prev) => ({ ...prev, context: v.trim() }))
                  setInputValue(data.language || 'English')
                  goTo('language')
                }}
                placeholder="(optional — press Enter to skip)"
              />
            </Box>
          </Box>
        )}

        {step === 'language' && (
          <Box>
            <Text color={colors.brand} bold>{'❯ '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(v) => {
                handleTextSubmit(v || 'English', 'language', 'review')
              }}
              placeholder="English"
            />
          </Box>
        )}

        {step === 'review' && (
          <Box flexDirection="column">
            <Box flexDirection="column" paddingLeft={1} borderStyle="round" borderColor={colors.dim} paddingRight={1}>
              <ReviewRow label="Name" value={data.name} />
              <ReviewRow label="Role" value={data.role} />
              <ReviewRow label="Level" value={TECHNICAL_LEVELS.find((l) => l.value === data.technical_level)?.label || data.technical_level} />
              {data.context && <ReviewRow label="Context" value={data.context} />}
              <ReviewRow label="Language" value={data.language} />
            </Box>
            <Box marginTop={1}>
              <Text color={colors.dim}>
                <Text color={colors.brand}>enter</Text> save  <Text color={colors.muted}>b</Text> start over
              </Text>
            </Box>
          </Box>
        )}

        {step === 'done' && (
          <Box flexDirection="column" alignItems="center">
            <Text color={colors.brand} bold>{symbols.check} Persona saved</Text>
            <Box marginTop={1}>
              <Text color={colors.dim}>
                Run <Text color={colors.white} bold>hub generate</Text> to apply it to your AI agent.
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={colors.dim}>
                Press <Text color={colors.brand} bold>Enter</Text> to exit
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={10}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Text color={colors.white} bold>{value}</Text>
    </Box>
  )
}
