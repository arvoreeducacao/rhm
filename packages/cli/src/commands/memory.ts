import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile, rm, appendFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

async function ensureLanceDbIgnored(memoriesDir: string, hubDir: string): Promise<void> {
  const relative = memoriesDir.replace(hubDir + "/", "");
  const pattern = `${relative}/.lancedb/`;

  const gitignorePath = join(hubDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf-8");
    if (content.includes(".lancedb")) return;
    await appendFile(gitignorePath, `\n# Memory vector store (generated)\n${pattern}\n`);
  } else {
    await writeFile(gitignorePath, `# Memory vector store (generated)\n${pattern}\n`, "utf-8");
  }
}

const VALID_CATEGORIES = [
  "decisions",
  "conventions",
  "incidents",
  "domain",
  "gotchas",
] as const;

function getMemoriesPath(hubDir: string, configPath?: string): string {
  return resolve(hubDir, configPath || "memories");
}

interface MemoryFrontmatter {
  title: string;
  category: string;
  date: string;
  author?: string;
  tags?: string[];
  status?: string;
}

function parseFrontmatter(raw: string): {
  data: Partial<MemoryFrontmatter>;
  content: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const data: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: unknown = line.slice(idx + 1).trim();

    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim());
    }
    data[key] = value;
  }

  return { data: data as Partial<MemoryFrontmatter>, content: match[2] };
}

function buildFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

async function listMemories(
  memoriesDir: string,
  opts: { category?: string; status?: string }
) {
  if (!existsSync(memoriesDir)) {
    console.log(chalk.dim("  No memories directory found."));
    return;
  }

  let total = 0;

  for (const cat of VALID_CATEGORIES) {
    if (opts.category && opts.category !== cat) continue;

    const catDir = join(memoriesDir, cat);
    if (!existsSync(catDir)) continue;

    const files = (await readdir(catDir)).filter((f) => f.endsWith(".md"));
    if (files.length === 0) continue;

    const entries: { id: string; title: string; date: string; status: string; tags: string[] }[] = [];

    for (const file of files) {
      const raw = await readFile(join(catDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const status = (data.status as string) || "active";

      if (opts.status && status !== opts.status) continue;

      entries.push({
        id: basename(file, ".md"),
        title: (data.title as string) || basename(file, ".md"),
        date: (data.date as string) || "unknown",
        status,
        tags: (data.tags as string[]) || [],
      });
    }

    if (entries.length === 0) continue;

    console.log(chalk.cyan(`\n  ${cat} (${entries.length})`));
    for (const e of entries) {
      const statusIcon = e.status === "active" ? chalk.green("●") : chalk.dim("○");
      const tags = e.tags.length > 0 ? chalk.dim(` [${e.tags.join(", ")}]`) : "";
      console.log(`    ${statusIcon} ${chalk.yellow(e.id)} — ${e.title} ${chalk.dim(`(${e.date})`)}${tags}`);
    }
    total += entries.length;
  }

  if (total === 0) {
    console.log(chalk.dim("  No memories found."));
  } else {
    console.log(chalk.green(`\n  Total: ${total} memories\n`));
  }
}

export const memoryCommand = new Command("memory")
  .description("Manage team memories — persistent knowledge base for AI context")
  .addCommand(
    new Command("add")
      .description("Create a new memory entry")
      .argument("<category>", `Category: ${VALID_CATEGORIES.join(", ")}`)
      .argument("<title>", "Memory title")
      .option("-c, --content <content>", "Memory content (or provide via stdin)")
      .option("-t, --tags <tags>", "Comma-separated tags")
      .option("-a, --author <author>", "Author name")
      .action(
        async (
          category: string,
          title: string,
          opts: { content?: string; tags?: string; author?: string }
        ) => {
          if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
            console.log(
              chalk.red(`\n  Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(", ")}\n`)
            );
            return;
          }

          const hubDir = process.cwd();
          let memoriesDir: string;

          try {
            const config = await loadHubConfig(hubDir);
            memoriesDir = getMemoriesPath(hubDir, config.memory?.path);
          } catch {
            memoriesDir = getMemoriesPath(hubDir);
          }

          const catDir = join(memoriesDir, category);
          await mkdir(catDir, { recursive: true });
          await ensureLanceDbIgnored(memoriesDir, hubDir);

          const date = new Date().toISOString().split("T")[0];
          const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const id = `${date}-${slug}`;
          const filePath = join(catDir, `${id}.md`);

          const fm: Record<string, unknown> = {
            title,
            category,
            date,
            status: "active",
          };
          if (opts.author) fm.author = opts.author;
          if (opts.tags) fm.tags = opts.tags.split(",").map((t) => t.trim());

          const content = opts.content || `## Context\n\n\n\n## Details\n\n`;
          const fileContent = `${buildFrontmatter(fm)}\n\n${content}\n`;

          await writeFile(filePath, fileContent, "utf-8");
          console.log(chalk.green(`\n  Created: ${category}/${id}.md`));
          console.log(chalk.dim(`  Path: ${filePath}`));
          if (!opts.content) {
            console.log(chalk.yellow("  Edit the file to add content.\n"));
          } else {
            console.log();
          }
        }
      )
  )
  .addCommand(
    new Command("list")
      .description("List all memories")
      .option("-c, --category <category>", "Filter by category")
      .option("-s, --status <status>", "Filter by status (active, archived, superseded)")
      .action(async (opts: { category?: string; status?: string }) => {
        const hubDir = process.cwd();
        let memoriesDir: string;

        try {
          const config = await loadHubConfig(hubDir);
          memoriesDir = getMemoriesPath(hubDir, config.memory?.path);
        } catch {
          memoriesDir = getMemoriesPath(hubDir);
        }

        console.log(chalk.blue("\nTeam Memories"));
        await listMemories(memoriesDir, opts);
      })
  )
  .addCommand(
    new Command("archive")
      .description("Archive a memory (soft-delete)")
      .argument("<id>", "Memory ID (filename without .md)")
      .action(async (id: string) => {
        const hubDir = process.cwd();
        let memoriesDir: string;

        try {
          const config = await loadHubConfig(hubDir);
          memoriesDir = getMemoriesPath(hubDir, config.memory?.path);
        } catch {
          memoriesDir = getMemoriesPath(hubDir);
        }

        let found = false;
        for (const cat of VALID_CATEGORIES) {
          const filePath = join(memoriesDir, cat, `${id}.md`);
          if (!existsSync(filePath)) continue;

          const raw = await readFile(filePath, "utf-8");
          const { data, content } = parseFrontmatter(raw);
          data.status = "archived";
          const updated = `${buildFrontmatter(data as Record<string, unknown>)}\n${content}`;
          await writeFile(filePath, updated, "utf-8");
          console.log(chalk.green(`\n  Archived: ${cat}/${id}.md\n`));
          found = true;
          break;
        }

        if (!found) {
          console.log(chalk.red(`\n  Memory "${id}" not found.\n`));
        }
      })
  )
  .addCommand(
    new Command("remove")
      .description("Permanently delete a memory")
      .argument("<id>", "Memory ID (filename without .md)")
      .action(async (id: string) => {
        const hubDir = process.cwd();
        let memoriesDir: string;

        try {
          const config = await loadHubConfig(hubDir);
          memoriesDir = getMemoriesPath(hubDir, config.memory?.path);
        } catch {
          memoriesDir = getMemoriesPath(hubDir);
        }

        let found = false;
        for (const cat of VALID_CATEGORIES) {
          const filePath = join(memoriesDir, cat, `${id}.md`);
          if (!existsSync(filePath)) continue;

          await rm(filePath);
          console.log(chalk.green(`\n  Removed: ${cat}/${id}.md\n`));
          found = true;
          break;
        }

        if (!found) {
          console.log(chalk.red(`\n  Memory "${id}" not found.\n`));
        }
      })
  );
