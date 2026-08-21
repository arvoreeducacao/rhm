import type { MCPConfig } from "./types.js";

export function tomlString(value: string): string {
  if (!value.includes("'") && !value.includes("\n")) {
    return `'${value}'`;
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

export function tomlArray(values: string[]): string {
  return `[${values.map((v) => tomlString(v)).join(", ")}]`;
}

const ENV_PLACEHOLDER = /^\$\{env:([A-Za-z0-9_]+)\}$/;
const ANY_ENV_PLACEHOLDER = /^\$\{env:.+\}$/;

/**
 * Codex CLI stores MCP servers in `.codex/config.toml` using snake_case
 * `[mcp_servers.<id>]` tables. Unlike Claude/Cursor, Codex does not expand
 * `${env:VAR}` inside the `env` map — host env vars must be whitelisted via
 * `env_vars` and are forwarded by name instead.
 *
 * A placeholder can only be forwarded when it references the exact same name as
 * its key (`FOO: ${env:FOO}`). Mismatched (`FOO: ${env:BAR}`) or malformed
 * placeholders cannot be represented in Codex's model, so they are reported as
 * warnings instead of being written literally (which Codex would not expand).
 */
export function splitEnvForCodex(env: Record<string, string> | undefined): {
  literal: Record<string, string>;
  forwarded: string[];
  warnings: string[];
} {
  const literal: Record<string, string> = {};
  const forwarded: string[] = [];
  const warnings: string[] = [];
  for (const [key, raw] of Object.entries(env ?? {})) {
    const match = ENV_PLACEHOLDER.exec(raw);
    if (match && match[1] === key) {
      forwarded.push(key);
    } else if (ANY_ENV_PLACEHOLDER.test(raw)) {
      warnings.push(
        `env "${key}": placeholder "${raw}" cannot be forwarded (Codex only supports \${env:${key}}); omitting it`
      );
    } else {
      literal[key] = raw;
    }
  }
  return { literal, forwarded, warnings };
}

export function buildCodexMcpBlock(
  name: string,
  mcp: MCPConfig
): { block: string; warnings: string[] } | null {
  const lines: string[] = [`[mcp_servers.${name}]`];
  const warnings: string[] = [];

  if (mcp.url) {
    lines.push(`url = ${tomlString(mcp.url)}`);
    if (mcp.auth) {
      warnings.push(
        `"${name}": auth is configured but Codex needs a bearer_token_env_var; set it manually in .codex/config.toml`
      );
    }
    return { block: lines.join("\n"), warnings };
  }

  const { literal, forwarded, warnings: envWarnings } = splitEnvForCodex(mcp.env);
  warnings.push(...envWarnings.map((w) => `"${name}": ${w}`));

  if (mcp.image) {
    const args = ["run", "-i", "--rm"];
    for (const [key, value] of Object.entries(mcp.env ?? {})) {
      const match = ENV_PLACEHOLDER.exec(value);
      if (match && match[1] === key) {
        args.push("-e", key);
      } else {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push(mcp.image);
    lines.push(`command = 'docker'`, `args = ${tomlArray(args)}`);
  } else if (mcp.command) {
    lines.push(`command = ${tomlString(mcp.command)}`);
    if (mcp.args?.length) lines.push(`args = ${tomlArray(mcp.args)}`);
  } else if (mcp.package) {
    lines.push(`command = 'npx'`, `args = ${tomlArray(["-y", mcp.package, ...(mcp.args || [])])}`);
  } else {
    return null;
  }

  if (forwarded.length) {
    lines.push(`env_vars = ${tomlArray(forwarded)}`);
  }
  const literalKeys = Object.keys(literal);
  if (literalKeys.length) {
    lines.push("", `[mcp_servers.${name}.env]`);
    for (const key of literalKeys) {
      lines.push(`${key} = ${tomlString(literal[key])}`);
    }
  }

  return { block: lines.join("\n"), warnings };
}
