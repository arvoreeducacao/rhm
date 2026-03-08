import { useState, useEffect, useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import { Screen } from './Screen.js'
import { colors, symbols } from '../theme.js'
import type { Step } from '../types.js'

interface Item {
  name: string
  description: string
  defaultSelected?: boolean
  recommended?: boolean
  tags?: string[]
}

interface Props {
  step: Step
  subtitle?: string
  items: Item[]
  onSubmit: (selected: string[]) => void
  loading?: boolean
  source?: string
}

const VIEWPORT_PADDING = 16

export function MultiSelectStep({ step, subtitle, items, onSubmit, loading, source }: Props) {
  const { stdout } = useStdout()
  const terminalRows = stdout?.rows || 24
  const maxVisible = Math.max(5, terminalRows - VIEWPORT_PADDING)

  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (items.length === 0) return
    const defaults = new Set<string>()
    for (const item of items) {
      if (item.defaultSelected) defaults.add(item.name)
    }
    setSelected(defaults)
  }, [items])

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags?.some((t) => t.toLowerCase().includes(q)),
    )
  }, [items, searchQuery])

  useEffect(() => {
    setCursor(0)
    setScrollOffset(0)
  }, [searchQuery])

  useEffect(() => {
    if (cursor < scrollOffset) {
      setScrollOffset(cursor)
    } else if (cursor >= scrollOffset + maxVisible) {
      setScrollOffset(cursor - maxVisible + 1)
    }
  }, [cursor, maxVisible, scrollOffset])

  useInput((input, key) => {
    if (loading || items.length === 0) return

    if (searchMode) {
      if (key.escape || (key.return && searchQuery === '')) {
        setSearchMode(false)
        setSearchQuery('')
        return
      }
      if (key.return) {
        setSearchMode(false)
        return
      }
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setSearchQuery((prev) => prev + input)
        return
      }
      return
    }

    if (input === '/') {
      setSearchMode(true)
      setSearchQuery('')
      return
    }

    if (key.upArrow) setCursor((p) => (p > 0 ? p - 1 : filteredItems.length - 1))
    if (key.downArrow) setCursor((p) => (p < filteredItems.length - 1 ? p + 1 : 0))
    if (input === ' ' && filteredItems[cursor]) {
      setSelected((prev) => {
        const next = new Set(prev)
        const name = filteredItems[cursor].name
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
    }
    if (key.return) onSubmit([...selected])
    if (input === 'a') {
      const allFiltered = new Set(filteredItems.map((i) => i.name))
      setSelected((prev) => {
        const allSelected = filteredItems.every((i) => prev.has(i.name))
        if (allSelected) {
          const next = new Set(prev)
          for (const name of allFiltered) next.delete(name)
          return next
        }
        return new Set([...prev, ...allFiltered])
      })
    }
  })

  if (loading) {
    return (
      <Screen currentStep={step} subtitle={subtitle}>
        <Box>
          <Text color={colors.blue}><Spinner type="dots" /></Text>
          <Text color={colors.muted}> Fetching from registry...</Text>
        </Box>
      </Screen>
    )
  }

  const visibleItems = filteredItems.slice(scrollOffset, scrollOffset + maxVisible)
  const hasScrollUp = scrollOffset > 0
  const hasScrollDown = scrollOffset + maxVisible < filteredItems.length
  const activeItem = filteredItems[cursor]

  return (
    <Screen currentStep={step} subtitle={subtitle}>
      <Box flexDirection="column">
        {source && (
          <Box marginBottom={1}>
            <Text color={colors.dim}>{symbols.vertical} </Text>
            <Text color={colors.purple}>{source}</Text>
            <Text color={colors.dim}> ({filteredItems.length} items)</Text>
          </Box>
        )}

        {searchMode ? (
          <Box marginBottom={1}>
            <Text color={colors.brand}>/ </Text>
            <Text color={colors.white}>{searchQuery}</Text>
            <Text color={colors.dim}>▌</Text>
          </Box>
        ) : (
          <Box marginBottom={1}>
            <Text color={colors.dim}>type </Text>
            <Text color={colors.muted} bold>/</Text>
            <Text color={colors.dim}> to search</Text>
            {searchQuery && (
              <>
                <Text color={colors.dim}> — filter: </Text>
                <Text color={colors.purple}>{searchQuery}</Text>
                <Text color={colors.dim}> ({filteredItems.length})</Text>
              </>
            )}
          </Box>
        )}

        {hasScrollUp && (
          <Box>
            <Text color={colors.dim}>      ↑ {scrollOffset} more above</Text>
          </Box>
        )}

        {visibleItems.map((item) => {
          const idx = filteredItems.indexOf(item)
          const active = idx === cursor
          const checked = selected.has(item.name)

          return (
            <Box key={item.name}>
              <Text color={active ? colors.brand : colors.dim}>
                {active ? symbols.arrow : ' '}{' '}
              </Text>
              <Text color={checked ? colors.brand : colors.dim}>
                {checked ? '[✓]' : '[ ]'}
              </Text>
              <Text color={active || checked ? colors.white : colors.muted} bold={active}>
                {' '}{item.name}
              </Text>
              {item.recommended && (
                <Text color={colors.warning}> ★</Text>
              )}
              {item.tags && item.tags.length > 0 && (
                <Text color={colors.purple}> [{item.tags.join(', ')}]</Text>
              )}
            </Box>
          )
        })}

        {hasScrollDown && (
          <Box>
            <Text color={colors.dim}>      ↓ {filteredItems.length - scrollOffset - maxVisible} more below</Text>
          </Box>
        )}

        {filteredItems.length === 0 && searchQuery && (
          <Text color={colors.muted}>No matches for "{searchQuery}"</Text>
        )}

        {activeItem && (
          <Box marginTop={1} paddingLeft={1} flexDirection="column">
            <Text color={colors.white} wrap="truncate-end">{activeItem.description}</Text>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={colors.dim}>
              <Text color={colors.muted} bold>space</Text> toggle
              {'  '}
              <Text color={colors.muted} bold>a</Text> all/none
              {'  '}
              <Text color={colors.muted} bold>/</Text> search
              {'  '}
              <Text color={colors.muted} bold>enter</Text> confirm
            </Text>
          </Box>
          <Box>
            <Text color={colors.brand}>{selected.size}</Text>
            <Text color={colors.dim}>/{items.length} selected</Text>
          </Box>
        </Box>
      </Box>
    </Screen>
  )
}
