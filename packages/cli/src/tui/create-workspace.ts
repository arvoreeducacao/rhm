import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { planInitWorkspace } from '@arvoretech/hub-core'
import { applyPlannedFiles } from '../core/plan-apply.js'
import type { InitState } from './types.js'
import { downloadDirFromGitHub } from '../commands/registry.js'
import { isValidSkillName } from '../core/install-skills.js'

export function createWorkspaceTasks(
  state: InitState,
  targetDir: string,
): { label: string; run: () => Promise<void> }[] {
  const tasks: { label: string; run: () => Promise<void> }[] = []

  tasks.push({
    label: 'Create directories',
    run: async () => {
      await mkdir(targetDir, { recursive: true })
      await mkdir(join(targetDir, 'tasks'), { recursive: true })
      await mkdir(join(targetDir, 'skills'), { recursive: true })
      await mkdir(join(targetDir, 'steering'), { recursive: true })
    },
  })

  const files = planInitWorkspace({
    name: state.hubName,
    repos: state.repos,
    mcps: state.mcps,
    skills: state.skills,
    configFormat: state.configFormat,
    editor: state.editor ?? undefined,
  })

  tasks.push({
    label: `Write ${state.configFormat === 'typescript' ? 'hub.config.ts' : 'hub.yaml'} and project files`,
    run: async () => {
      await applyPlannedFiles(targetDir, files)
    },
  })

  const capabilitySkillsToInstall = state.skills
  if (capabilitySkillsToInstall.length > 0) {
    tasks.push({
      label: `Install ${capabilitySkillsToInstall.length} skills from registry`,
      run: async () => {
        const skillsDir = join(targetDir, 'skills')
        for (const skill of capabilitySkillsToInstall) {
          if (!isValidSkillName(skill)) continue
          try {
            await downloadDirFromGitHub(
              'arvoreeducacao/rhm',
              `skills/${skill}`,
              join(skillsDir, skill),
            )
          } catch {
            // skip
          }
        }
      },
    })
  }

  return tasks
}
