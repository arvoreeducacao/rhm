import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { HubConfig, MCPConfig } from "../core/hub-config.js";

function extractEnvVarsByMcp(mcps: MCPConfig[]): { name: string; vars: string[] }[] {
  const envVarPattern = /\$\{(?:env:)?(\w+)\}/g;
  const groups: { name: string; vars: string[] }[] = [];

  for (const mcp of mcps) {
    const values: string[] = [];
    if (mcp.env) values.push(...Object.values(mcp.env));
    if (mcp.auth && typeof mcp.auth !== "string") {
      if (mcp.auth.clientId) values.push(mcp.auth.clientId);
      if (mcp.auth.clientSecret) values.push(mcp.auth.clientSecret);
    }
    if (values.length === 0) continue;
    const vars: string[] = [];
    const seenInGroup = new Set<string>();
    for (const value of values) {
      for (const match of value.matchAll(envVarPattern)) {
        if (!seenInGroup.has(match[1])) {
          seenInGroup.add(match[1]);
          vars.push(match[1]);
        }
      }
    }
    if (vars.length > 0) {
      groups.push({ name: mcp.name, vars: vars.sort() });
    }
  }

  return groups;
}

export async function generateEnvExample(config: HubConfig, hubDir: string): Promise<void> {
  const groups = extractEnvVarsByMcp(config.mcps || []);

  for (const [name, vars] of Object.entries(config.env?.example_extras || {})) {
    if (vars.length > 0) {
      groups.push({ name, vars: [...vars].sort() });
    }
  }

  let totalVars = 0;
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const uniqueVars = group.vars.filter((v) => !seen.has(v));
    if (uniqueVars.length === 0) continue;
    for (const v of uniqueVars) seen.add(v);

    if (lines.length > 0) lines.push("");
    lines.push(`# ${group.name}`);
    for (const v of uniqueVars) {
      lines.push(`${v}=`);
    }
    totalVars += uniqueVars.length;
  }

  const hasNotionSources = config.remote_sources?.some((s) => s.notion_page);
  if (hasNotionSources && !seen.has("NOTION_API_KEY")) {
    if (lines.length > 0) lines.push("");
    lines.push("# Remote Sources (Notion)");
    lines.push("NOTION_API_KEY=");
    totalVars++;
  }

  if (totalVars === 0) return;

  await writeFile(join(hubDir, ".env.example"), lines.join("\n") + "\n", "utf-8");
  console.log(chalk.green(`  Generated .env.example (${totalVars} vars)`));
}
