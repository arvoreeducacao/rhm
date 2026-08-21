import { Command } from "commander";
import chalk from "chalk";
import { listRegistryDir, listRegistrySkills } from "@arvoretech/hub-core";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";
const DEFAULT_BRANCH = "main";


export async function listRegistryAgents(repo: string): Promise<{ name: string; description: string }[]> {
  const items = await listRegistryDir(repo, "agents");
  const agents: { name: string; description: string }[] = [];

  for (const item of items) {
    if (item.type !== "file" || !item.name.endsWith(".md")) continue;

    const agentUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/agents/${item.name}`;
    try {
      const res = await fetch(agentUrl);
      if (!res.ok) continue;
      const content = await res.text();
      const descMatch = content.match(/^description:\s*(.+)$/m);
      const name = item.name.replace(/\.md$/, "");
      agents.push({
        name,
        description: descMatch?.[1]?.replace(/^["']|["']$/g, "") || "",
      });
    } catch {
      agents.push({ name: item.name.replace(/\.md$/, ""), description: "" });
    }
  }

  return agents;
}

async function listRegistryHooks(repo: string): Promise<{ name: string; description: string }[]> {
  const items = await listRegistryDir(repo, "hooks");
  const hooks: { name: string; description: string }[] = [];

  for (const item of items) {
    if (item.type !== "dir") continue;

    const readmeUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/hooks/${item.name}/README.md`;
    try {
      const res = await fetch(readmeUrl);
      if (!res.ok) {
        hooks.push({ name: item.name, description: "" });
        continue;
      }
      const content = await res.text();
      const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
      hooks.push({
        name: item.name,
        description: firstLine?.trim() || "",
      });
    } catch {
      hooks.push({ name: item.name, description: "" });
    }
  }

  return hooks;
}

async function listRegistryCommands(repo: string): Promise<{ name: string; description: string }[]> {
  const items = await listRegistryDir(repo, "commands");
  const commands: { name: string; description: string }[] = [];

  for (const item of items) {
    if (item.type !== "file" || !item.name.endsWith(".md")) continue;

    const cmdUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/commands/${item.name}`;
    try {
      const res = await fetch(cmdUrl);
      if (!res.ok) continue;
      const content = await res.text();
      const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
      const name = item.name.replace(/\.md$/, "");
      commands.push({
        name,
        description: firstLine?.trim() || "",
      });
    } catch {
      commands.push({ name: item.name.replace(/\.md$/, ""), description: "" });
    }
  }

  return commands;
}

const TYPE_LABELS: Record<string, (text: string) => string> = {
  skill: (t) => chalk.green(t),
  agent: (t) => chalk.blue(t),
  hook: (t) => chalk.magenta(t),
  command: (t) => chalk.cyan(t),
};

const INSTALL_HINTS: Record<string, string> = {
  skill: "hub skills add <name>",
  agent: "hub agents add <name>",
  hook: "hub hooks add <name>",
  command: "hub commands add <name>",
};

export const registryCommand = new Command("registry")
  .description("Browse and install skills, agents, hooks, and commands from the registry")
  .option("-r, --repo <repo>", "Registry repository (owner/repo)", DEFAULT_REGISTRY_REPO)
  .addCommand(
    new Command("search")
      .description("Search the registry")
      .argument("[query]", "Search term")
      .option("-t, --type <type>", "Filter by type (skill, agent, hook, command)")
      .action(async (query?: string, opts?: { type?: string }) => {
        const repo = registryCommand.opts().repo || DEFAULT_REGISTRY_REPO;
        console.log(chalk.blue(`\n━━━ Hub Registry (${repo}) ━━━\n`));

        const results: { type: string; name: string; description: string }[] = [];
        const typeFilter = opts?.type;

        if (!typeFilter || typeFilter === "skill") {
          try {
            const skills = await listRegistrySkills(repo);
            for (const s of skills) results.push({ type: "skill", ...s });
          } catch {
            console.log(chalk.yellow("  Could not fetch skills from registry."));
          }
        }

        if (!typeFilter || typeFilter === "agent") {
          try {
            const agents = await listRegistryAgents(repo);
            for (const a of agents) results.push({ type: "agent", ...a });
          } catch {
            console.log(chalk.yellow("  Could not fetch agents from registry."));
          }
        }

        if (!typeFilter || typeFilter === "hook") {
          try {
            const hooks = await listRegistryHooks(repo);
            for (const h of hooks) results.push({ type: "hook", ...h });
          } catch {
            console.log(chalk.yellow("  Could not fetch hooks from registry."));
          }
        }

        if (!typeFilter || typeFilter === "command") {
          try {
            const commands = await listRegistryCommands(repo);
            for (const c of commands) results.push({ type: "command", ...c });
          } catch {
            console.log(chalk.yellow("  Could not fetch commands from registry."));
          }
        }

        let filtered = results;
        if (query) {
          const q = query.toLowerCase();
          filtered = results.filter(
            (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
          );
        }

        if (filtered.length === 0) {
          console.log(chalk.dim("  No results found.\n"));
          return;
        }

        for (const entry of filtered) {
          const labelFn = TYPE_LABELS[entry.type] || ((t: string) => t);
          console.log(`  ${labelFn(`[${entry.type}]`)} ${chalk.yellow(entry.name)}`);
          if (entry.description) console.log(`    ${entry.description}`);
          console.log();
        }

        console.log(chalk.cyan(`  ${filtered.length} result(s)\n`));

        const types = [...new Set(filtered.map((e) => e.type))];
        for (const type of types) {
          const hint = INSTALL_HINTS[type];
          if (hint) console.log(chalk.dim(`  Install ${type}:  ${hint}`));
        }
        console.log();
      })
  )
  .addCommand(
    new Command("list")
      .description("List everything in the registry")
      .option("-t, --type <type>", "Filter by type (skill, agent, hook, command)")
      .action(async (opts?: { type?: string }) => {
        const repo = registryCommand.opts().repo || DEFAULT_REGISTRY_REPO;
        console.log(chalk.blue(`\n━━━ Hub Registry (${repo}) ━━━\n`));
        const typeFilter = opts?.type;

        if (!typeFilter || typeFilter === "skill") {
          try {
            const skills = await listRegistrySkills(repo);
            if (skills.length) {
              console.log(chalk.green(`Skills (${skills.length}):`));
              for (const s of skills) {
                console.log(`  ${chalk.yellow(s.name)}${s.description ? ` — ${s.description}` : ""}`);
              }
              console.log();
            }
          } catch {
            console.log(chalk.yellow("  Could not fetch skills.\n"));
          }
        }

        if (!typeFilter || typeFilter === "agent") {
          try {
            const agents = await listRegistryAgents(repo);
            if (agents.length) {
              console.log(chalk.blue(`Agents (${agents.length}):`));
              for (const a of agents) {
                console.log(`  ${chalk.yellow(a.name)}${a.description ? ` — ${a.description}` : ""}`);
              }
              console.log();
            }
          } catch {
            console.log(chalk.yellow("  Could not fetch agents.\n"));
          }
        }

        if (!typeFilter || typeFilter === "hook") {
          try {
            const hooks = await listRegistryHooks(repo);
            if (hooks.length) {
              console.log(chalk.magenta(`Hooks (${hooks.length}):`));
              for (const h of hooks) {
                console.log(`  ${chalk.yellow(h.name)}${h.description ? ` — ${h.description}` : ""}`);
              }
              console.log();
            }
          } catch {
            console.log(chalk.yellow("  Could not fetch hooks.\n"));
          }
        }

        if (!typeFilter || typeFilter === "command") {
          try {
            const commands = await listRegistryCommands(repo);
            if (commands.length) {
              console.log(chalk.cyan(`Commands (${commands.length}):`));
              for (const c of commands) {
                console.log(`  ${chalk.yellow(c.name)}${c.description ? ` — ${c.description}` : ""}`);
              }
              console.log();
            }
          } catch {
            console.log(chalk.yellow("  Could not fetch commands.\n"));
          }
        }
      })
  );
