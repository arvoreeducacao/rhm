import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";

interface ConsolidationState {
  last_run?: string;
  indexed: Record<
    string,
    {
      sessions: string[];
      last_session_date?: string;
    }
  >;
}

interface NormalizedMessage {
  role: "user" | "assistant";
  content: string;
}

interface NormalizedSession {
  id: string;
  editor: string;
  date: string;
  messages: NormalizedMessage[];
}

type EditorCli = "kiro-cli" | "claude" | "opencode";

const STATE_FILE = ".hub/consolidation-state.json";
const BATCH_DIR = ".hub/consolidation";

async function readState(hubDir: string): Promise<ConsolidationState> {
  const filePath = join(hubDir, STATE_FILE);
  if (!existsSync(filePath)) return { indexed: {} };
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return { indexed: {} };
  }
}

async function writeState(
  hubDir: string,
  state: ConsolidationState
): Promise<void> {
  const dir = join(hubDir, ".hub");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(hubDir, STATE_FILE),
    JSON.stringify(state, null, 2) + "\n",
    "utf-8"
  );
}

function detectEditorCli(): EditorCli | null {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const candidates: EditorCli[] = ["kiro-cli", "claude", "opencode"];
  for (const cli of candidates) {
    try {
      execSync(`which ${cli}`, { stdio: "pipe" });
      return cli;
    } catch {
      continue;
    }
  }
  return null;
}

function getKiroSessionsDir(): string | null {
  const base = join(
    homedir(),
    "Library",
    "Application Support",
    "Kiro",
    "User",
    "globalStorage",
    "kiro.kiroagent",
    "workspace-sessions"
  );
  if (!existsSync(base)) return null;
  return base;
}

function getClaudeProjectsDir(): string | null {
  const base = join(homedir(), ".claude", "projects");
  if (!existsSync(base)) return null;
  return base;
}

function getOpenCodeStorageDir(): string | null {
  const base = join(homedir(), ".local", "share", "opencode", "storage");
  if (!existsSync(base)) return null;
  return base;
}

async function parseKiroSession(
  filePath: string
): Promise<NormalizedMessage[]> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    const messages: NormalizedMessage[] = [];
    if (!raw.history || !Array.isArray(raw.history)) return messages;

    for (const entry of raw.history) {
      const msg = entry.message;
      if (!msg || !msg.role) continue;
      if (msg.role !== "user" && msg.role !== "assistant") continue;

      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("\n");
      }

      if (!content || content.length < 5) continue;

      const isToolOutput =
        content.startsWith("[") ||
        content.startsWith("{") ||
        content.includes("```\n") && content.length > 2000;
      if (msg.role === "assistant" && isToolOutput && content.length > 3000)
        continue;

      messages.push({
        role: msg.role as "user" | "assistant",
        content:
          content.length > 800 ? content.substring(0, 800) + "..." : content,
      });
    }
    return messages;
  } catch {
    return [];
  }
}

async function parseClaudeSession(
  filePath: string
): Promise<NormalizedMessage[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const messages: NormalizedMessage[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.message || !entry.message.role) continue;
        if (entry.type === "file-history-snapshot") continue;

        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;

        let content = "";
        if (typeof entry.message.content === "string") {
          content = entry.message.content;
        } else if (Array.isArray(entry.message.content)) {
          content = entry.message.content
            .filter(
              (c: { type: string }) =>
                c.type === "text" || c.type === "thinking"
            )
            .map((c: { text?: string; thinking?: string }) => c.text || "")
            .filter(Boolean)
            .join("\n");
        }

        if (!content || content.length < 5) continue;
        if (role === "assistant" && content.length > 3000) continue;

        messages.push({
          role: role as "user" | "assistant",
          content:
            content.length > 800 ? content.substring(0, 800) + "..." : content,
        });
      } catch {
        continue;
      }
    }
    return messages;
  } catch {
    return [];
  }
}

async function parseOpenCodeSession(
  storageDir: string,
  sessionId: string
): Promise<NormalizedMessage[]> {
  try {
    const messagesDir = join(storageDir, "message", sessionId);
    if (!existsSync(messagesDir)) return [];

    const msgFiles = await readdir(messagesDir);
    const messages: NormalizedMessage[] = [];

    for (const msgFile of msgFiles.sort()) {
      const msgData = JSON.parse(
        await readFile(join(messagesDir, msgFile), "utf-8")
      );
      if (msgData.role !== "user" && msgData.role !== "assistant") continue;

      const partsDir = join(storageDir, "part", msgData.id);
      if (!existsSync(partsDir)) continue;

      const partFiles = await readdir(partsDir);
      let content = "";
      for (const partFile of partFiles.sort()) {
        const part = JSON.parse(
          await readFile(join(partsDir, partFile), "utf-8")
        );
        if (part.type === "text" && part.text) {
          content += part.text;
        }
      }

      if (!content || content.length < 5) continue;
      if (msgData.role === "assistant" && content.length > 3000) continue;

      messages.push({
        role: msgData.role as "user" | "assistant",
        content:
          content.length > 800 ? content.substring(0, 800) + "..." : content,
      });
    }
    return messages;
  } catch {
    return [];
  }
}

async function collectKiroSessions(
  hubDir: string,
  indexed: Set<string>,
  limit: number,
  since?: string
): Promise<NormalizedSession[]> {
  const sessionsBase = getKiroSessionsDir();
  if (!sessionsBase) return [];

  const workspaceDirs = await readdir(sessionsBase);
  const candidates: { file: string; wsPath: string; mtime: Date }[] = [];

  for (const wsDir of workspaceDirs) {
    const wsPath = join(sessionsBase, wsDir);
    const wsStat = await stat(wsPath);
    if (!wsStat.isDirectory()) continue;

    const files = await readdir(wsPath);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    for (const file of jsonFiles) {
      const id = file.replace(".json", "");
      if (indexed.has(`kiro:${id}`)) continue;
      const fileStat = await stat(join(wsPath, file));
      if (since && fileStat.mtime < new Date(since)) continue;
      candidates.push({ file, wsPath, mtime: fileStat.mtime });
    }
  }

  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const sessions: NormalizedSession[] = [];
  for (const { file, wsPath, mtime } of candidates) {
    if (sessions.length >= limit) break;
    const messages = await parseKiroSession(join(wsPath, file));
    if (messages.length < 2) continue;

    sessions.push({
      id: file.replace(".json", ""),
      editor: "kiro",
      date: mtime.toISOString().split("T")[0],
      messages,
    });
  }

  return sessions;
}

async function collectClaudeSessions(
  hubDir: string,
  indexed: Set<string>,
  limit: number,
  since?: string
): Promise<NormalizedSession[]> {
  const projectsDir = getClaudeProjectsDir();
  if (!projectsDir) return [];

  const projects = await readdir(projectsDir);
  const candidates: { file: string; projectPath: string; mtime: Date }[] = [];

  for (const project of projects) {
    const projectPath = join(projectsDir, project);
    const projectStat = await stat(projectPath);
    if (!projectStat.isDirectory()) continue;

    const files = await readdir(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const id = file.replace(".jsonl", "");
      if (indexed.has(`claude:${id}`)) continue;
      const fileStat = await stat(join(projectPath, file));
      if (since && fileStat.mtime < new Date(since)) continue;
      candidates.push({ file, projectPath, mtime: fileStat.mtime });
    }
  }

  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const sessions: NormalizedSession[] = [];
  for (const { file, projectPath, mtime } of candidates) {
    if (sessions.length >= limit) break;
    const messages = await parseClaudeSession(join(projectPath, file));
    if (messages.length < 2) continue;

    sessions.push({
      id: file.replace(".jsonl", ""),
      editor: "claude",
      date: mtime.toISOString().split("T")[0],
      messages,
    });
  }

  return sessions;
}

async function collectOpenCodeSessions(
  hubDir: string,
  indexed: Set<string>,
  limit: number,
  since?: string
): Promise<NormalizedSession[]> {
  const storageDir = getOpenCodeStorageDir();
  if (!storageDir) return [];

  const sessionDirs = join(storageDir, "session");
  if (!existsSync(sessionDirs)) return [];

  const projects = await readdir(sessionDirs);
  const candidates: { sessionId: string; mtime: Date }[] = [];

  for (const project of projects) {
    const projectPath = join(sessionDirs, project);
    const projectStat = await stat(projectPath);
    if (!projectStat.isDirectory()) continue;

    const files = await readdir(projectPath);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    for (const file of jsonFiles) {
      const sessionId = file.replace(".json", "");
      if (indexed.has(`opencode:${sessionId}`)) continue;
      const fileStat = await stat(join(projectPath, file));
      if (since && fileStat.mtime < new Date(since)) continue;
      candidates.push({ sessionId, mtime: fileStat.mtime });
    }
  }

  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const sessions: NormalizedSession[] = [];
  for (const { sessionId, mtime } of candidates) {
    if (sessions.length >= limit) break;
    const messages = await parseOpenCodeSession(storageDir, sessionId);
    if (messages.length < 2) continue;

    sessions.push({
      id: sessionId,
      editor: "opencode",
      date: mtime.toISOString().split("T")[0],
      messages,
    });
  }

  return sessions;
}

function buildBatchContent(sessions: NormalizedSession[]): string {
  const parts: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    parts.push(`## Session ${i + 1} (${session.date}, ${session.editor})\n`);

    for (const msg of session.messages) {
      const label = msg.role === "user" ? "User" : "Assistant";
      parts.push(`${label}: ${msg.content}\n`);
    }

    parts.push("");
  }

  return parts.join("\n");
}

function buildConsolidationPrompt(batchPath: string, memoriesPath: string): string {
  return [
    "You are a knowledge extractor. Your task is to read transcripts of chat sessions between developers and AI agents, and extract information that would be useful for future sessions.",
    "",
    `Read the file ${batchPath}`,
    "",
    "For each useful piece of information you find, create a file in the appropriate category folder:",
    "",
    `- ${memoriesPath}/decisions/ — technical choices (e.g. "use Drizzle instead of TypeORM")`,
    `- ${memoriesPath}/conventions/ — patterns defined (e.g. "API errors return { code, message }")`,
    `- ${memoriesPath}/gotchas/ — problems to avoid (e.g. "Sentry v8 leak with NestJS")`,
    `- ${memoriesPath}/domain/ — business knowledge (e.g. "enrollment can stay pending for 30 days")`,
    "",
    "File format:",
    "---",
    "title: <short title>",
    "category: <category>",
    "date: <today's date>",
    "status: active",
    "tags: [tag1, tag2]",
    "source:",
    "  type: consolidation",
    "---",
    "",
    "## Context",
    "<2-3 sentences of context>",
    "",
    "## Details",
    "<specific details>",
    "",
    "Rules:",
    "- Ignore specific implementation, generated code, compilation errors, tool call outputs",
    "- Focus on DECISIONS, PATTERNS, DISCOVERIES, and BUSINESS KNOWLEDGE",
    "- If a session has nothing useful, skip it",
    `- Before creating a file, read existing files in ${memoriesPath}/ to avoid duplicates`,
    "- If a similar memory already exists, do NOT create another one",
    "- Use kebab-case for filenames with today's date prefix (e.g. 2026-04-03-use-drizzle.md)",
    "- Write memory content in the same language the developers used in the chat",
  ].join("\n");
}

function spawnEditorCli(
  cli: EditorCli,
  prompt: string,
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let args: string[];

    switch (cli) {
      case "kiro-cli":
        args = ["chat", "--no-interactive", "--trust-all-tools", prompt];
        break;
      case "claude":
        args = [
          "-p",
          "--dangerously-skip-permissions",
          "--allowedTools",
          "Read,Write,Edit,Glob,Grep",
          prompt,
        ];
        break;
      case "opencode":
        args = ["--non-interactive", prompt];
        break;
    }

    const proc = spawn(cli, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

export const consolidateCommand = new Command("consolidate")
  .description(
    "Extract knowledge from chat sessions across editors into team memories"
  )
  .option("-n, --last <count>", "Number of recent sessions to process", "20")
  .option("-s, --since <date>", "Only process sessions after this date (YYYY-MM-DD)")
  .option(
    "-e, --editor <editor>",
    "Editor to collect from (kiro, claude, opencode, all)",
    "all"
  )
  .option(
    "--cli <cli>",
    "Editor CLI to use for extraction (kiro-cli, claude, opencode)"
  )
  .option("--dry-run", "Show batch content without running extraction")
  .option("--reset", "Reset consolidation state and reprocess all sessions")
  .action(
    async (opts: {
      last: string;
      since?: string;
      editor: string;
      cli?: string;
      dryRun?: boolean;
      reset?: boolean;
    }) => {
      const hubDir = process.cwd();
      const limit = parseInt(opts.last, 10);

      console.log(chalk.blue("\nConsolidating chat sessions into memories\n"));

      let state = await readState(hubDir);
      if (opts.reset) {
        state = { indexed: {} };
        await writeState(hubDir, state);
        console.log(chalk.yellow("  Reset consolidation state\n"));
      }

      const indexed = new Set<string>();
      for (const [editor, data] of Object.entries(state.indexed)) {
        for (const sessionId of data.sessions) {
          indexed.add(`${editor}:${sessionId}`);
        }
      }

      console.log(chalk.dim(`  Already indexed: ${indexed.size} sessions`));

      const allSessions: NormalizedSession[] = [];

      if (opts.editor === "all" || opts.editor === "kiro") {
        const kiroSessions = await collectKiroSessions(
          hubDir,
          indexed,
          limit,
          opts.since
        );
        allSessions.push(...kiroSessions);
        if (kiroSessions.length > 0) {
          console.log(
            chalk.green(`  Found ${kiroSessions.length} new Kiro sessions`)
          );
        }
      }

      if (opts.editor === "all" || opts.editor === "claude") {
        const claudeSessions = await collectClaudeSessions(
          hubDir,
          indexed,
          limit,
          opts.since
        );
        allSessions.push(...claudeSessions);
        if (claudeSessions.length > 0) {
          console.log(
            chalk.green(
              `  Found ${claudeSessions.length} new Claude Code sessions`
            )
          );
        }
      }

      if (opts.editor === "all" || opts.editor === "opencode") {
        const openCodeSessions = await collectOpenCodeSessions(
          hubDir,
          indexed,
          limit,
          opts.since
        );
        allSessions.push(...openCodeSessions);
        if (openCodeSessions.length > 0) {
          console.log(
            chalk.green(
              `  Found ${openCodeSessions.length} new OpenCode sessions`
            )
          );
        }
      }

      if (allSessions.length === 0) {
        console.log(chalk.yellow("\n  No new sessions to process.\n"));
        return;
      }

      allSessions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const toProcess = allSessions.slice(0, limit);

      console.log(
        chalk.blue(`\n  Processing ${toProcess.length} sessions...\n`)
      );

      const batchContent = buildBatchContent(toProcess);
      const batchDir = join(hubDir, BATCH_DIR);
      await mkdir(batchDir, { recursive: true });
      const batchFile = `batch-${new Date().toISOString().split("T")[0]}.md`;
      const batchPath = join(batchDir, batchFile);
      await writeFile(batchPath, batchContent, "utf-8");
      console.log(chalk.dim(`  Batch written to ${BATCH_DIR}/${batchFile}`));

      if (opts.dryRun) {
        console.log(chalk.yellow("\n  Dry run — batch content:\n"));
        const preview =
          batchContent.length > 3000
            ? batchContent.substring(0, 3000) + "\n\n... (truncated)"
            : batchContent;
        console.log(chalk.dim(preview));
        console.log(
          chalk.yellow(
            `\n  Would process ${toProcess.length} sessions. Run without --dry-run to extract.\n`
          )
        );
        return;
      }

      let memoriesPath = "./memories";
      try {
        const config = await loadHubConfig(hubDir);
        if (config.memory?.path) memoriesPath = config.memory.path;
      } catch {
        // use default
      }

      for (const cat of ["decisions", "conventions", "gotchas", "domain"]) {
        await mkdir(join(hubDir, memoriesPath, cat), { recursive: true });
      }

      let cli = opts.cli as EditorCli | undefined;
      if (!cli) {
        const detected = detectEditorCli();
        if (!detected) {
          console.log(
            chalk.red(
              "\n  No editor CLI found (kiro-cli, claude, opencode)."
            )
          );
          console.log(
            chalk.dim(
              "  Install one or specify with --cli <kiro-cli|claude|opencode>\n"
            )
          );
          return;
        }
        cli = detected;
      }

      console.log(chalk.blue(`  Using ${cli} for extraction...\n`));

      const relativeBatchPath = `.hub/consolidation/${batchFile}`;
      const prompt = buildConsolidationPrompt(relativeBatchPath, memoriesPath);

      const result = await spawnEditorCli(cli, prompt, hubDir);

      if (result.code !== 0) {
        console.log(chalk.red(`\n  Extraction failed (exit code ${result.code})`));
        if (result.stderr) {
          console.log(chalk.dim(`  stderr: ${result.stderr.substring(0, 500)}`));
        }
        return;
      }

      console.log(chalk.green("\n  Extraction complete!"));

      const processedIds = toProcess.map((s) => s.id);
      for (const session of toProcess) {
        const editorKey = session.editor;
        if (!state.indexed[editorKey]) {
          state.indexed[editorKey] = { sessions: [] };
        }
        state.indexed[editorKey].sessions.push(session.id);
        state.indexed[editorKey].last_session_date = session.date;
      }
      state.last_run = new Date().toISOString();
      await writeState(hubDir, state);

      console.log(
        chalk.dim(`  Marked ${processedIds.length} sessions as indexed`)
      );

      let newMemories = 0;
      for (const cat of ["decisions", "conventions", "gotchas", "domain"]) {
        const catDir = join(hubDir, memoriesPath, cat);
        if (existsSync(catDir)) {
          const files = await readdir(catDir);
          newMemories += files.filter((f) => f.endsWith(".md")).length;
        }
      }

      console.log(chalk.green(`  Total memories: ${newMemories}`));
      console.log(chalk.green("\nDone!\n"));
    }
  );
