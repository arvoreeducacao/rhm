import { Command } from "commander";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import React from "react";
import { render } from "ink";
import { PersonaApp, type PersonaData } from "../tui/PersonaApp.js";
import { stringify } from "yaml";

const ENTER_ALT_SCREEN = "\x1B[?1049h";
const EXIT_ALT_SCREEN = "\x1B[?1049l";
const CLEAR = "\x1B[2J\x1B[H";
const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";

function getPersonaPath(hubDir: string): string {
  return join(hubDir, ".hub", "persona.yaml");
}

export async function loadPersona(hubDir: string): Promise<PersonaData | null> {
  const personaPath = getPersonaPath(hubDir);
  if (!existsSync(personaPath)) return null;
  try {
    const { parse } = await import("yaml");
    const content = await readFile(personaPath, "utf-8");
    return parse(content) as PersonaData;
  } catch {
    return null;
  }
}

export function buildPersonaSection(persona: PersonaData): string {
  const lines: string[] = [];

  lines.push(`\n## User Persona\n`);
  lines.push(`You are talking to **${persona.name}**, who is a **${persona.role}**.`);

  if (persona.technical_level === "non-technical") {
    lines.push(`
${persona.name} is not technical. Adapt your communication:
- Never use jargon, acronyms, or technical terms without explaining them in plain language first.
- Explain decisions in terms of business impact, user experience, and outcomes — not implementation details.
- When showing progress, focus on what changed for the user/product, not what code was modified.
- If you need to mention something technical, use analogies and simple language.
- Keep responses short and focused on what matters to them.
- When asking questions, frame them as business/product decisions, not technical choices.
- Never show code snippets, terminal output, or file paths unless explicitly asked.`);
  } else if (persona.technical_level === "beginner") {
    lines.push(`
${persona.name} is learning and not deeply technical yet. Adapt your communication:
- Explain technical concepts briefly when you first mention them.
- Avoid deep implementation details unless asked.
- Use simple language but don't shy away from introducing technical terms with context.
- When showing code or commands, briefly explain what they do.
- Be encouraging and patient — frame things as learning opportunities.`);
  } else if (persona.technical_level === "intermediate") {
    lines.push(`
${persona.name} is comfortable with code but may not know every tool or pattern. Adapt your communication:
- Use technical language normally but explain niche or advanced concepts when relevant.
- Show code and commands without excessive explanation, but add context for non-obvious decisions.
- Focus on the "why" behind architectural choices.`);
  } else {
    lines.push(`
${persona.name} is an experienced developer. Communicate directly:
- Be concise and technical. Skip basic explanations.
- Focus on trade-offs, edge cases, and non-obvious implications.
- Show code directly without hand-holding.`);
  }

  if (persona.focus_areas) {
    lines.push(`\n${persona.name} focuses on: ${persona.focus_areas}. Prioritize these areas in suggestions and discussions.`);
  }

  if (persona.aws_profiles?.length) {
    lines.push(`\n### AWS Profiles\n`);
    for (const profile of persona.aws_profiles) {
      lines.push(`- \`${profile.name}\`: ${profile.description}`);
    }
    lines.push(`\nWhen running AWS commands, ask which environment if not clear from context.`);
  }

  if (persona.github_username) {
    lines.push(`\nGitHub username: **${persona.github_username}**`);
  }

  if (persona.timezone) {
    lines.push(`\nTimezone: ${persona.timezone}`);
  }

  if (persona.context) {
    lines.push(`\nAdditional context about ${persona.name}: ${persona.context}`);
  }

  if (persona.language && persona.language.toLowerCase() !== "english") {
    lines.push(`\nAlways communicate with ${persona.name} in **${persona.language}**.`);
  }

  return lines.join("\n");
}

export function buildPersonaEditorFile(persona: PersonaData, editor: "kiro" | "cursor" | "claude-code" | "opencode"): string {
  const content = buildPersonaSection(persona);

  if (editor === "kiro") {
    return `---\ninclusion: always\nname: persona\n---\n\n# Persona — ${persona.name}\n${content}\n`;
  }

  if (editor === "cursor") {
    return `---\ndescription: "Personal AI profile for ${persona.name}"\nalwaysApply: true\n---\n\n# Persona — ${persona.name}\n${content}\n`;
  }

  return `# Persona — ${persona.name}\n${content}\n`;
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
