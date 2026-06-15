import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Repo } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function readRepoContext(
  repo: Repo,
  hubDir: string,
): Promise<{ sections: string[]; missing: string[] }> {
  const repoRoot = resolve(hubDir, repo.path);
  const sections: string[] = [];
  const missing: string[] = [];

  for (const file of repo.context_files ?? []) {
    const filePath = resolve(repoRoot, file);

    if (!isPathInside(repoRoot, filePath)) {
      missing.push(`${file} (outside repository, skipped)`);
      continue;
    }

    if (!existsSync(filePath)) {
      missing.push(file);
      continue;
    }

    try {
      const content = (await readFile(filePath, "utf-8")).trim();
      if (content) {
        sections.push(`<!-- ${file} -->\n\n${content}`);
      }
    } catch {
      missing.push(file);
    }
  }

  return { sections, missing };
}

export function repoContext(pi: ExtensionAPI) {
  let steeringEnabled = false;

  pi.on("session_start", async (_event, ctx) => {
    steeringEnabled = false;

    const { config, pi: toggles } = getSessionState();
    if (!config || !toggles?.repoContext) return;

    const reposWithContext = config.repos.filter((r) => r.context_files?.length);
    if (reposWithContext.length === 0) return;

    steeringEnabled = true;
    const repoNames = reposWithContext.map((r) => r.name);

    pi.registerTool({
      name: "hub_repo_context",
      label: "Hub Repo Context",
      description: `Load the rich, repo-specific context (architecture, conventions, gotchas, where things live) for a workspace repository before working on it. Call this the first time you start working on one of these repos: ${repoNames.join(", ")}.`,
      parameters: Type.Object({
        repo: Type.String({ description: "Repository name to load context for" }),
      }),
      async execute(_toolCallId, params) {
        const repo = config.repos.find((r) => r.name === params.repo);
        if (!repo) {
          return {
            content: [
              {
                type: "text",
                text: `Repository "${params.repo}" not found. Repos with context: ${repoNames.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        if (!repo.context_files?.length) {
          return {
            content: [
              {
                type: "text",
                text: `Repository "${params.repo}" has no context_files configured. Repos with context: ${repoNames.join(", ")}`,
              },
            ],
          };
        }

        const { sections, missing } = await readRepoContext(repo, ctx.cwd);

        if (sections.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No context could be loaded for "${params.repo}". Missing or empty files: ${missing.join(", ") || "none"}. Make sure the repo is cloned.`,
              },
            ],
            isError: true,
          };
        }

        const header = `# Context for ${repo.display_name || repo.name}\n`;
        const body = sections.join("\n\n---\n\n");
        const footer = missing.length
          ? `\n\n---\n\n(Could not load: ${missing.join(", ")})`
          : "";

        return {
          content: [{ type: "text", text: header + "\n" + body + footer }],
          details: { repo: repo.name, loaded: sections.length, missing },
        };
      },
    });
  });

  pi.on("before_agent_start", async (event) => {
    if (!steeringEnabled) return;

    const { config } = getSessionState();
    if (!config) return;

    const repoNames = config.repos
      .filter((r) => r.context_files?.length)
      .map((r) => r.name);
    if (repoNames.length === 0) return;

    const steering = `\n## Repository Context\n\nBefore you start working on any of these repositories, call the \`hub_repo_context\` tool once to load its architecture, conventions, and gotchas: ${repoNames.join(", ")}. Do this the first time you touch a repo in a session, before reading or editing its files.`;

    return {
      systemPrompt: event.systemPrompt + "\n" + steering,
    };
  });
}
