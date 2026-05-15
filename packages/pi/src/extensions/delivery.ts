import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadHubConfig, type HubConfig } from "@arvoretech/hub-core";

function getReposWithChanges(config: HubConfig, hubDir: string): { name: string; path: string }[] {
  const changed: { name: string; path: string }[] = [];
  for (const repo of config.repos) {
    const repoPath = resolve(hubDir, repo.path);
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf-8" });
      if (status.trim()) {
        changed.push({ name: repo.name, path: repoPath });
      }
    } catch {
      // skip
    }
  }
  return changed;
}

function createBranch(repoPath: string, branchName: string): void {
  try {
    execFileSync("git", ["checkout", "-b", branchName], { cwd: repoPath, stdio: "pipe" });
  } catch {
    execFileSync("git", ["checkout", branchName], { cwd: repoPath, stdio: "pipe" });
  }
}

function pushAndCreatePr(repoPath: string, branchName: string, title: string, body: string): string {
  execFileSync("git", ["add", "-A"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", title], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["push", "-u", "origin", branchName], { cwd: repoPath, stdio: "pipe" });

  const prUrl = execFileSync(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--head", branchName],
    { cwd: repoPath, encoding: "utf-8", stdio: "pipe" }
  ).trim();

  return prUrl;
}

export function delivery(pi: ExtensionAPI) {
  let config: HubConfig | null = null;
  let hubDir: string = "";

  pi.on("session_start", async (_event, ctx) => {
    hubDir = ctx.cwd;
    try {
      config = await loadHubConfig(hubDir);
    } catch {
      // skip
    }
  });

  pi.registerCommand("deliver", {
    description: "Create PRs for repos with changes and notify Slack: /deliver <task-id> <title>",
    handler: async (args, ctx) => {
      if (!config) {
        ctx.ui.notify("No hub config found", "warning");
        return;
      }

      const parts = args.trim().split(/\s+/);
      const taskId = parts[0] || "no-task";
      const title = parts.slice(1).join(" ") || "Feature delivery";

      const github = config.integrations?.github;
      const slack = config.integrations?.slack;

      const changed = getReposWithChanges(config, hubDir);
      if (changed.length === 0) {
        ctx.ui.notify("No repositories with changes found", "info");
        return;
      }

      const branchPattern = github?.pr_branch_pattern || "{task_id}-{slug}";
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      const branchName = branchPattern
        .replace("{task_id}", taskId)
        .replace("{slug}", slug);

      const prUrls: string[] = [];

      for (const repo of changed) {
        try {
          createBranch(repo.path, branchName);
          const prUrl = pushAndCreatePr(repo.path, branchName, title, `Task: ${taskId}\n\n${title}`);
          prUrls.push(prUrl);
          ctx.ui.notify(`PR created for ${repo.name}: ${prUrl}`, "info");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Failed to create PR for ${repo.name}: ${msg}`, "warning");
        }
      }

      if (slack?.channels?.prs && prUrls.length > 0) {
        const template = slack.templates?.prs || ":point_right: [PR]({pr_link}) para [{task_name}]({task_link})";
        for (const prUrl of prUrls) {
          const message = template
            .replace("{pr_link}", prUrl)
            .replace("{task_name}", `${taskId}: ${title}`)
            .replace("{task_link}", prUrl);
          ctx.ui.notify(`Slack notification: ${message}`, "info");
        }
      }
    },
  });
}
