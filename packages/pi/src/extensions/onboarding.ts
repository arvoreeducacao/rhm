import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type HubConfig, type Repo } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

interface MissingItems {
  repos: Repo[];
  tools: { name: string; version?: string }[];
  deps: Repo[];
}

function detectMissingRepos(config: HubConfig, hubDir: string): Repo[] {
  return config.repos.filter((repo) => {
    const repoPath = resolve(hubDir, repo.path);
    return !existsSync(repoPath);
  });
}

function detectMissingTools(config: HubConfig): { name: string; version?: string }[] {
  const missing: { name: string; version?: string }[] = [];
  const tools = config.tools || {};

  for (const [name, version] of Object.entries(tools)) {
    try {
      execFileSync("which", [name], { stdio: "pipe" });
    } catch {
      missing.push({ name, version });
    }
  }

  return missing;
}

function detectMissingDeps(config: HubConfig, hubDir: string): Repo[] {
  const missing: Repo[] = [];

  for (const repo of config.repos) {
    const repoPath = resolve(hubDir, repo.path);
    if (!existsSync(repoPath)) continue;

    const hasNodeModules = existsSync(resolve(repoPath, "node_modules"));
    const hasDeps = existsSync(resolve(repoPath, "deps")) || existsSync(resolve(repoPath, "_build"));
    const needsInstall = repo.commands?.install;

    if (needsInstall && !hasNodeModules && !hasDeps) {
      missing.push(repo);
    }
  }

  return missing;
}

function detectMissing(config: HubConfig, hubDir: string): MissingItems {
  return {
    repos: detectMissingRepos(config, hubDir),
    tools: detectMissingTools(config),
    deps: detectMissingDeps(config, hubDir),
  };
}

export function onboarding(pi: ExtensionAPI) {
  let config: HubConfig | null = null;
  let hubDir: string = "";

  pi.on("session_start", async (_event, ctx) => {
    hubDir = ctx.cwd;

    const session = getSessionState();
    config = session.config;
    if (!config) return;
    if (!session.pi?.onboarding) return;

    const missing = detectMissing(config, hubDir);
    const total = missing.repos.length + missing.tools.length + missing.deps.length;

    if (total > 0) {
      const parts: string[] = [];
      if (missing.repos.length) parts.push(`${missing.repos.length} repo(s) not cloned`);
      if (missing.tools.length) parts.push(`${missing.tools.length} tool(s) missing`);
      if (missing.deps.length) parts.push(`${missing.deps.length} repo(s) need install`);
      ctx.ui.notify(`Setup incomplete: ${parts.join(", ")}. Run /setup to fix.`, "warning");
    }
  });

  pi.registerCommand("setup", {
    description: "Check workspace health and fix missing repos, tools, and dependencies",
    handler: async (_args, ctx) => {
      if (!config) {
        ctx.ui.notify("No hub config found", "warning");
        return;
      }

      const missing = detectMissing(config, hubDir);
      const total = missing.repos.length + missing.tools.length + missing.deps.length;

      if (total === 0) {
        ctx.ui.notify("Workspace is fully set up ✓", "info");
        return;
      }

      if (missing.repos.length > 0) {
        const names = missing.repos.map((r) => r.name).join(", ");
        const ok = await ctx.ui.confirm("Clone repos", `Clone ${missing.repos.length} missing repo(s)? (${names})`);
        if (ok) {
          for (const repo of missing.repos) {
            const dest = resolve(hubDir, repo.path);
            try {
              ctx.ui.notify(`Cloning ${repo.name}...`, "info");
              execFileSync("git", ["clone", repo.url, dest], { stdio: "pipe", timeout: 120_000 });
              ctx.ui.notify(`✓ ${repo.name} cloned`, "info");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              ctx.ui.notify(`✗ ${repo.name}: ${msg}`, "warning");
            }
          }
        }
      }

      if (missing.tools.length > 0) {
        const names = missing.tools.map((t) => t.version ? `${t.name}@${t.version}` : t.name).join(", ");
        ctx.ui.notify(`Missing tools: ${names}. Install them manually or via mise.`, "warning");
      }

      if (missing.deps.length > 0) {
        const names = missing.deps.map((r) => r.name).join(", ");
        const ok = await ctx.ui.confirm("Install deps", `Install dependencies for ${missing.deps.length} repo(s)? (${names})`);
        if (ok) {
          for (const repo of missing.deps) {
            const repoPath = resolve(hubDir, repo.path);
            const cmd = repo.commands!.install!;
            try {
              ctx.ui.notify(`Installing ${repo.name}...`, "info");
              execFileSync("sh", ["-c", cmd], { cwd: repoPath, stdio: "pipe", timeout: 300_000 });
              ctx.ui.notify(`✓ ${repo.name} installed`, "info");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              ctx.ui.notify(`✗ ${repo.name}: ${msg}`, "warning");
            }
          }
        }
      }

      ctx.ui.notify("Setup complete", "info");
    },
  });

  pi.registerCommand("env", {
    description: "Switch environment profile: /env <profile>",
    handler: async (args, ctx) => {
      if (!config) {
        ctx.ui.notify("No hub config found", "warning");
        return;
      }

      const profiles = config.env?.profiles;
      if (!profiles || Object.keys(profiles).length === 0) {
        ctx.ui.notify("No env profiles configured in hub config", "warning");
        return;
      }

      const profileName = args.trim();
      if (!profileName) {
        const available = Object.keys(profiles).join(", ");
        ctx.ui.notify(`Available profiles: ${available}`, "info");
        return;
      }

      const profile = profiles[profileName];
      if (!profile) {
        const available = Object.keys(profiles).join(", ");
        ctx.ui.notify(`Profile "${profileName}" not found. Available: ${available}`, "warning");
        return;
      }

      if (profile.aws_profile) {
        try {
          execFileSync("aws", ["sts", "get-caller-identity", "--profile", profile.aws_profile], { stdio: "pipe", timeout: 10_000 });
          ctx.ui.notify(`AWS profile "${profile.aws_profile}" active ✓`, "info");
        } catch {
          ctx.ui.notify(`AWS profile "${profile.aws_profile}" failed — check credentials`, "warning");
        }
      }

      if (profile.secrets) {
        const count = Object.keys(profile.secrets).length;
        ctx.ui.notify(`Profile "${profileName}" has ${count} secret(s). Use AWS Secrets Manager MCP to pull them.`, "info");
      }

      ctx.ui.notify(`Switched to env profile: ${profileName}`, "info");
    },
  });
}
