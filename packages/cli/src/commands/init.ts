import { Command } from 'commander'
import { join } from 'node:path'
import React from 'react'
import { render } from 'ink'
import { App } from '../tui/App.js'
import { createWorkspaceTasks } from '../tui/create-workspace.js'
import type { InitState } from '../tui/types.js'

const ENTER_ALT_SCREEN = '\x1B[?1049h'
const EXIT_ALT_SCREEN = '\x1B[?1049l'
const CLEAR = '\x1B[2J\x1B[H'
const HIDE_CURSOR = '\x1B[?25l'
const SHOW_CURSOR = '\x1B[?25h'

export const initCommand = new Command('init')
  .description('Initialize a new Repo Hub workspace')
  .argument('[name]', 'Hub name', 'my-hub')
  .action(async (name: string) => {
    process.stdout.write(ENTER_ALT_SCREEN + CLEAR + HIDE_CURSOR)

    const cleanup = () => {
      process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN)
    }

    process.on('SIGINT', () => {
      cleanup()
      process.exit(0)
    })

    const { waitUntilExit } = render(
      React.createElement(App, {
        defaultName: name,
        createWorkspace: (state: InitState) =>
          createWorkspaceTasks(state, join(process.cwd(), state.hubName)),
      }),
    )

    await waitUntilExit()
    cleanup()
  })
