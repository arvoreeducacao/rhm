import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Screen } from './Screen.js'
import { colors, symbols } from '../theme.js'
import type { RepoEntry } from '../types.js'

interface Props {
  repos: RepoEntry[]
  onSubmit: (repos: RepoEntry[]) => void
}

function inferName(url: string): string {
  return url.split('/').pop()?.replace(/\.git$/, '') || url
}

function inferTech(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.includes('api') || lower.includes('backend')) return 'nestjs'
  if (lower.includes('frontend') || lower.includes('web') || lower.includes('next')) return 'nextjs'
  if (lower.includes('mobile') || lower.includes('app')) return 'react'
  return undefined
}

export function ReposStep({ repos: initialRepos, onSubmit }: Props) {
  const [repos, setRepos] = useState<RepoEntry[]>(initialRepos)
  const [inputValue, setInputValue] = useState('')

  useInput((_input, key) => {
    if (key.return && inputValue === '') {
      onSubmit(repos)
    }
  })

  const handleSubmit = (url: string) => {
    if (!url.trim()) return
    const name = inferName(url.trim())
    const tech = inferTech(name)
    setRepos((prev) => [...prev, { url: url.trim(), name, tech }])
    setInputValue('')
  }

  return (
    <Screen currentStep="repos" subtitle="Paste git URLs one at a time. Press Enter on empty line to continue.">
      <Box flexDirection="column">
        {repos.map((repo, i) => (
          <Box key={`${repo.url}-${i}`}>
            <Text color={colors.brand}>{symbols.check} </Text>
            <Text color={colors.white}>{repo.name}</Text>
            {repo.tech && (
              <Text color={colors.purple}> [{repo.tech}]</Text>
            )}
            <Text color={colors.dim}> {repo.url}</Text>
          </Box>
        ))}

        <Box marginTop={repos.length > 0 ? 1 : 0}>
          <Text color={colors.brand} bold>{'❯ '}</Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder="git@github.com:org/repo.git"
          />
        </Box>

        {repos.length > 0 && (
          <Box marginTop={1}>
            <Text color={colors.dim}>
              {repos.length} repo(s) added. Press <Text color={colors.muted}>Enter</Text> on empty line to continue.
            </Text>
          </Box>
        )}

        {repos.length === 0 && (
          <Box marginTop={1}>
            <Text color={colors.dim}>
              You can also skip this and add repos later with <Text color={colors.muted}>hub add-repo</Text>
            </Text>
          </Box>
        )}
      </Box>
    </Screen>
  )
}
