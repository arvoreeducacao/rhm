import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";
import type { RemoteSource } from "./hub-config.js";
import { fetchNotionPageAsMarkdown } from "./notion.js";

interface FetchedSource {
  name: string;
  type: "skill" | "steering";
  content: string;
  triggers?: string[];
  instructions?: string;
}

async function fetchFromNotion(source: RemoteSource): Promise<string> {
  if (!source.notion_page) throw new Error(`No notion_page for source: ${source.name}`);
  const { content } = await fetchNotionPageAsMarkdown(source.notion_page);
  return content;
}

async function fetchFromUrl(source: RemoteSource): Promise<string> {
  if (!source.url) throw new Error(`No url for source: ${source.name}`);
  const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch ${source.url}: ${res.status}`);
  return res.text();
}

async function fetchFromPath(source: RemoteSource, hubDir: string): Promise<string> {
  if (!source.path) throw new Error(`No path for source: ${source.name}`);
  const fullPath = resolve(hubDir, source.path);
  const rel = relative(hubDir, fullPath);
  if (rel.startsWith("..") || resolve(fullPath) === fullPath && !fullPath.startsWith(hubDir)) {
    throw new Error(`Path "${source.path}" escapes the workspace for source: ${source.name}`);
  }
  return readFile(fullPath, "utf-8");
}

async function fetchSourceContent(source: RemoteSource, hubDir: string): Promise<string> {
  if (source.notion_page) return fetchFromNotion(source);
  if (source.url) return fetchFromUrl(source);
  if (source.path) return fetchFromPath(source, hubDir);
  throw new Error(`Source "${source.name}" has no notion_page, url, or path`);
}


function buildSkillContent(source: FetchedSource): string {
  const triggers = source.triggers?.length
    ? source.triggers
    : [source.name.replace(/-/g, " ")];

  const parts = [
    "---",
    `name: ${source.name}`,
    `description: "${source.instructions || `Design source: ${source.name}`}"`,
    `triggers: [${triggers.join(", ")}]`,
    "---",
    "",
  ];

  if (source.instructions) {
    parts.push(source.instructions, "");
  }

  parts.push(source.content);
  return parts.join("\n");
}

function buildSteeringContent(source: FetchedSource): string {
  const parts: string[] = [];

  if (source.instructions) {
    parts.push(source.instructions, "");
  }

  parts.push(source.content);
  return parts.join("\n");
}

export async function fetchRemoteSources(
  sources: RemoteSource[],
  hubDir: string,
  skillsDir: string,
  steeringDir: string
): Promise<{ skills: number; steering: number; errors: string[] }> {
  let skillCount = 0;
  let steeringCount = 0;
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const rawContent = await fetchSourceContent(source, hubDir);

      const fetched: FetchedSource = {
        name: source.name,
        type: source.type,
        content: rawContent,
        triggers: source.triggers,
        instructions: source.instructions,
      };

      if (source.type === "skill") {
        const skillDir = join(skillsDir, source.name);
        await mkdir(skillDir, { recursive: true });
        const skillContent = buildSkillContent(fetched);
        await writeFile(join(skillDir, "SKILL.md"), skillContent, "utf-8");
        skillCount++;
        console.log(chalk.green(`  ✓ ${source.name} (skill)`));
      } else {
        await mkdir(steeringDir, { recursive: true });
        const steeringContent = buildSteeringContent(fetched);
        await writeFile(join(steeringDir, `${source.name}.md`), steeringContent, "utf-8");
        steeringCount++;
        console.log(chalk.green(`  ✓ ${source.name} (steering)`));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${source.name}: ${msg}`);
      console.log(chalk.yellow(`  ✗ ${source.name}: ${msg}`));
    }
  }

  return { skills: skillCount, steering: steeringCount, errors };
}
