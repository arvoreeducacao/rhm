import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import chalk from "chalk";
import { resolveConfigPath, loadHubConfig, type HubConfig, type MCPConfig } from "../core/hub-config.js";

const SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/arvoreeducacao/rhm/main/schemas/hub.schema.json\n";

export const mcpCommand = new Command("mcp")
  .description("Manage MCP servers")
  .addCommand(
    new Command("add")
      .description("Add an MCP server")
      .argument("<name>", "MCP server name")
      .option("-p, --package <package>", "NPM package")
      .option("-u, --url <url>", "HTTP URL")
      .option("--image <image>", "Docker image")
      .option("-a, --args <args...>", "Additional arguments")
      .option("-e, --env <env...>", "Environment variables (KEY=VALUE)")
      .option("--auto-approve", "Auto-approve tool calls")
      .action(async (name: string, opts: {
        package?: string;
        url?: string;
        image?: string;
        args?: string[];
        env?: string[];
        autoApprove?: boolean;
      }) => {
        const hubDir = process.cwd();
        const { path: configPath, format } = resolveConfigPath(hubDir);

        if (format === "typescript") {
          console.log(chalk.yellow("\nTypeScript config detected. Add this to your mcps array:\n"));
          console.log(chalk.cyan(buildSnippet(name, opts)));
          return;
        }

        const content = await readFile(configPath, "utf-8");
        const config = parse(content) as HubConfig;
        if (!config.mcps) config.mcps = [];

        if (config.mcps.some((m) => m.name === name)) {
          console.log(chalk.yellow(`MCP '${name}' already exists in hub.yaml`));
          return;
        }

        const entry: MCPConfig = { name };
        if (opts.package) entry.package = opts.package;
        if (opts.url) entry.url = opts.url;
        if (opts.image) entry.image = opts.image;
        if (opts.args?.length) entry.args = opts.args;
        if (opts.autoApprove) entry.autoApprove = true;
        if (opts.env?.length) {
          entry.env = {};
          for (const pair of opts.env) {
            const eq = pair.indexOf("=");
            if (eq > 0) entry.env[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
        }

        config.mcps.push(entry);
        await writeFile(configPath, SCHEMA_COMMENT + stringify(config), "utf-8");
        console.log(chalk.green(`\nAdded MCP '${name}' to hub.yaml`));
        console.log(chalk.cyan(`Run ${chalk.bold("hub generate")} to sync editor configs.\n`));
      })
  )
  .addCommand(
    new Command("list")
      .description("List configured MCP servers")
      .action(async () => {
        const config = await loadHubConfig(process.cwd());
        if (!config.mcps?.length) {
          console.log(chalk.yellow("\nNo MCPs configured.\n"));
          return;
        }
        console.log(chalk.blue(`\n━━━ MCP Servers (${config.mcps.length}) ━━━\n`));
        for (const m of config.mcps) {
          const type = m.url ? "url" : m.image ? "docker" : m.upstreams ? "proxy" : "npx";
          const target = m.url || m.image || m.package || "(proxy)";
          const args = m.args?.length ? ` ${m.args.join(" ")}` : "";
          console.log(`  ${chalk.green(m.name)} ${chalk.dim(`[${type}]`)} ${target}${chalk.yellow(args)}`);
        }
        console.log();
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove an MCP server")
      .argument("<name>", "MCP server name")
      .action(async (name: string) => {
        const hubDir = process.cwd();
        const { path: configPath, format } = resolveConfigPath(hubDir);

        if (format === "typescript") {
          console.log(chalk.yellow(`Remove '${name}' from your mcps array manually.`));
          return;
        }

        const content = await readFile(configPath, "utf-8");
        const config = parse(content) as HubConfig;
        const idx = (config.mcps || []).findIndex((m) => m.name === name);
        if (idx === -1) {
          console.log(chalk.yellow(`MCP '${name}' not found.`));
          return;
        }
        config.mcps!.splice(idx, 1);
        await writeFile(configPath, SCHEMA_COMMENT + stringify(config), "utf-8");
        console.log(chalk.green(`Removed MCP '${name}'.`));
        console.log(chalk.cyan(`Run ${chalk.bold("hub generate")} to sync editor configs.\n`));
      })
  );

function buildSnippet(name: string, opts: {
  package?: string; url?: string; image?: string;
  args?: string[]; env?: string[]; autoApprove?: boolean;
}): string {
  const lines: string[] = [`  mcp.custom("${name}", {`];
  if (opts.package) lines.push(`    package: "${opts.package}",`);
  if (opts.url) lines.push(`    url: "${opts.url}",`);
  if (opts.image) lines.push(`    image: "${opts.image}",`);
  if (opts.args?.length) lines.push(`    args: ${JSON.stringify(opts.args)},`);
  if (opts.autoApprove) lines.push(`    autoApprove: true,`);
  if (opts.env?.length) {
    lines.push(`    env: {`);
    for (const pair of opts.env) {
      const eq = pair.indexOf("=");
      if (eq > 0) lines.push(`      ${pair.slice(0, eq)}: "${pair.slice(eq + 1)}",`);
    }
    lines.push(`    },`);
  }
  lines.push(`  }),`);
  return lines.join("\n");
}
