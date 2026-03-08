import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { colors, symbols } from '../theme.js'

interface TaskResult {
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

interface Props {
  tasks: { label: string; run: () => Promise<void> }[]
  onDone: () => void
}

export function CreatingStep({ tasks, onDone }: Props) {
  const [results, setResults] = useState<TaskResult[]>(
    tasks.map((t) => ({ label: t.label, status: 'pending' }))
  )
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (started) return
    setStarted(true)

    const runTasks = async () => {
      for (let i = 0; i < tasks.length; i++) {
        setResults((prev) =>
          prev.map((r, j) => (j === i ? { ...r, status: 'running' } : r))
        )
        try {
          await tasks[i].run()
          setResults((prev) =>
            prev.map((r, j) => (j === i ? { ...r, status: 'done' } : r))
          )
        } catch (err) {
          setResults((prev) =>
            prev.map((r, j) =>
              j === i ? { ...r, status: 'error', error: String(err) } : r
            )
          )
        }
      }
      onDone()
    }

    runTasks()
  }, [started, tasks, onDone])

  const doneCount = results.filter((r) => r.status === 'done').length

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.brand} bold>{symbols.tree} Repo Hub</Text>
        <Text color={colors.dim}> {symbols.line} Creating workspace ({doneCount}/{results.length})</Text>
      </Box>
      <Box flexDirection="column">
        {results.map((task) => (
          <Box key={task.label}>
            {task.status === 'pending' && (
              <Text color={colors.dim}>{symbols.circle} </Text>
            )}
            {task.status === 'running' && (
              <Text color={colors.blue}><Spinner type="dots" />{' '}</Text>
            )}
            {task.status === 'done' && (
              <Text color={colors.brand}>{symbols.check} </Text>
            )}
            {task.status === 'error' && (
              <Text color={colors.error}>{symbols.cross} </Text>
            )}
            <Text color={task.status === 'done' ? colors.white : task.status === 'error' ? colors.error : colors.muted}>
              {task.label}
            </Text>
            {task.error && (
              <Text color={colors.error} dimColor> ({task.error})</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
