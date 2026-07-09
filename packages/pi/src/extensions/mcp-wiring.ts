import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildPiMcpEntry,
  readExistingMcpDisabledState,
  applyDisabledState,
  type MCPConfig,
  type MCPOAuthConfig,
} from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

function resolveEnvRefs(value: string): string {
  return value
    .replace(/\$\{env:(\w+)\}/g, (_, name) => process.env[name] ?? "")
    .replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

export function buildOAuthBlock(auth: MCPOAuthConfig): Record<string, unknown> | undefined {
  const oauth: Record<string, unknown> = {};
  const clientId = auth.clientId ? resolveEnvRefs(auth.clientId) : undefined;
  const clientSecret = auth.clientSecret ? resolveEnvRefs(auth.clientSecret) : undefined;
  if (clientId) oauth.clientId = clientId;
  if (clientSecret) oauth.clientSecret = clientSecret;
  if (auth.scope) oauth.scope = auth.scope;
  if (auth.redirectUri) oauth.redirectUri = auth.redirectUri;
  if (auth.clientName) oauth.clientName = auth.clientName;
  if (auth.clientUri) oauth.clientUri = auth.clientUri;
  if (auth.grantType) oauth.grantType = auth.grantType;
  return Object.keys(oauth).length ? oauth : undefined;
}

export function buildEntry(mcp: MCPConfig): Record<string, unknown> {
  const entry = buildPiMcpEntry(mcp);
  if (mcp.auth && typeof mcp.auth !== "string") {
    const oauth = buildOAuthBlock(mcp.auth);
    if (oauth) entry.oauth = oauth;
  }
  return entry;
}

export function mcpWiring(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { hubDir, config, pi: toggles } = getSessionState();
    if (!config || !toggles) return;
    if (!toggles.autoMcpWiring) return;
    if (!config.mcps?.length) return;

    const mcpConfig: Record<string, Record<string, unknown>> = {};

    for (const mcp of config.mcps) {
      if (mcp.upstreams?.length) continue;
      mcpConfig[mcp.name] = buildEntry(mcp);
    }

    const mcpJsonPath = join(hubDir, ".pi", "mcp.json");
    const disabledState = await readExistingMcpDisabledState(mcpJsonPath);
    applyDisabledState(mcpConfig, disabledState);

    const newContent = JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n";
    const newHash = createHash("sha256").update(newContent).digest("hex");

    let existingHash = "";
    if (existsSync(mcpJsonPath)) {
      try {
        const existing = await readFile(mcpJsonPath, "utf-8");
        existingHash = createHash("sha256").update(existing).digest("hex");
      } catch { /* skip */ }
    }

    if (newHash !== existingHash) {
      await mkdir(join(hubDir, ".pi"), { recursive: true });
      await writeFile(mcpJsonPath, newContent, "utf-8");
      ctx.ui.notify("Updated .pi/mcp.json from hub config", "info");
    }
  });
}
