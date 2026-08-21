import { Command } from "commander";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import React from "react";
import { render } from "ink";
import { PersonaApp, type PersonaData } from "../tui/PersonaApp.js";
import { stringify } from "yaml";

const ENTER_ALT_SCREEN = "\x1B[?1049h";
const EXIT_ALT_SCREEN = "\x1B[?1049l";
const CLEAR = "\x1B[2J\x1B[H";
const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";

import { loadPersona as coreLoadPersona } from "@arvoretech/hub-core";

export async function loadPersona(hubDir: string): Promise<PersonaData | null> {
  return (await coreLoadPersona(hubDir)) as PersonaData | null;
}

function getPersonaPath(hubDir: string): string {
  return join(hubDir, ".hub", "persona.yaml");
}

export const personaCommand = new Command("persona")
  .description("Set up your personal AI profile — adapts how the agent communicates with you")
  .action(async () => {
    const hubDir = process.cwd();
    const hubPath = join(hubDir, ".hub");
    await mkdir(hubPath, { recursive: true });

    const existing = await loadPersona(hubDir);

    process.stdout.write(ENTER_ALT_SCREEN + CLEAR + HIDE_CURSOR);

    const cleanup = () => {
      process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
    };

    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });

    const { waitUntilExit } = render(
      React.createElement(PersonaApp, {
        existing: existing ?? undefined,
        onComplete: async (persona: PersonaData) => {
          const personaPath = getPersonaPath(hubDir);
          await writeFile(personaPath, stringify(persona), "utf-8");
        },
      })
    );

    await waitUntilExit();
    cleanup();
  });
