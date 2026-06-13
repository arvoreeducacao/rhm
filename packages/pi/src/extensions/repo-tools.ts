import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSessionState } from "./session-state.js";

export function repoTools(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { config } = getSessionState();
    if (!config) return;

    const repoNames = config.repos.map((r) => r.name);
    const commandNames = new Set<string>();
    for (const repo of config.repos) {
      if (repo.commands) {
        for (const cmd of Object.keys(repo.commands)) {
          commandNames.add(cmd);
        }
      }
    }

    pi.registerTool({
      name: "hub_repo",
      label: "Hub Repo Command",
      description: `Run a configured command in a workspace repository. Available repos: ${repoNames.join(", ")}. Available commands: ${[...commandNames].join(", ")}.`,
      parameters: Type.Object({
        repo: Type.String({ description: "Repository name" }),
        command: Type.String({ description: "Command to run (install, dev, build, test, lint, or custom)" }),
      }),
      async execute(_toolCallId, params) {
        const repo = config!.repos.find((r) => r.name === params.repo);
        if (!repo) {
          return {
            content: [{ type: "text", text: `Repository "${params.repo}" not found. Available: ${repoNames.join(", ")}` }],
            isError: true,
          };
        }

        const cmd = repo.commands?.[params.command];
        if (!cmd) {
          const available = repo.commands ? Object.keys(repo.commands).join(", ") : "none";
          return {
            content: [{ type: "text", text: `Command "${params.command}" not configured for ${params.repo}. Available: ${available}` }],
            isError: true,
          };
        }

        const cwd = resolve(ctx.cwd, repo.path);
        const { execSync } = await import("node:child_process");

        try {
          const output = execSync(cmd, {
            cwd,
            encoding: "utf-8",
            timeout: 120_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return {
            content: [{ type: "text", text: output || "(no output)" }],
            details: { repo: params.repo, command: params.command, cwd },
          };
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string; message?: string };
          const output = error.stderr || error.stdout || error.message || "Command failed";
          return {
            content: [{ type: "text", text: output }],
            isError: true,
          };
        }
      },
    });
  });
}
