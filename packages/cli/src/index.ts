#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addRepoCommand } from "./commands/add-repo.js";
import { setupCommand } from "./commands/setup.js";
import { generateCommand } from "./commands/generate.js";
import { envCommand } from "./commands/env.js";
import { servicesCommand } from "./commands/services.js";
import { skillsCommand } from "./commands/skills.js";
import { agentsCommand } from "./commands/agents.js";
import { hooksCommand } from "./commands/hooks.js";
import { commandsCommand } from "./commands/commands.js";
import { registryCommand } from "./commands/registry.js";
import { pullCommand, statusCommand, execCommand } from "./commands/repos.js";
import { worktreeCommand } from "./commands/worktree.js";
import { doctorCommand } from "./commands/doctor.js";
import { toolsCommand } from "./commands/tools.js";
import { memoryCommand } from "./commands/memory.js";
import { updateCommand } from "./commands/update.js";
import { directoryCommand } from "./commands/directory.js";
import { scanCommand } from "./commands/scan.js";

const program = new Command();

program
  .name("hub")
  .description(
    "Give your AI coding assistant the full picture. Multi-repo context, agent orchestration, and end-to-end workflows."
  )
  .version("0.6.2")
  .enablePositionalOptions();

program.addCommand(initCommand);
program.addCommand(addRepoCommand);
program.addCommand(setupCommand);
program.addCommand(generateCommand);
program.addCommand(envCommand);
program.addCommand(servicesCommand);
program.addCommand(skillsCommand);
program.addCommand(agentsCommand);
program.addCommand(hooksCommand);
program.addCommand(commandsCommand);
program.addCommand(registryCommand);
program.addCommand(pullCommand);
program.addCommand(statusCommand);
program.addCommand(execCommand);
program.addCommand(worktreeCommand);
program.addCommand(doctorCommand);
program.addCommand(toolsCommand);
program.addCommand(memoryCommand);
program.addCommand(updateCommand);
program.addCommand(directoryCommand);
program.addCommand(scanCommand);

program.parse();
