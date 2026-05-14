import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadHubConfig, buildKiroMcpEntry, type MCPConfig } from "@arvoretech/hub-core";

export function mcpWiring(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const hubDir = ctx.cwd;

    let config;
    try {
      config = await loadHubConfig(hubDir);
    } catch {
      return;
    }

    if (!config.mcps?.length) return;

    const mcpConfig: Record<string, Record<string, unknown>> = {};

    for (const mcp of config.mcps) {
      if (mcp.upstreams?.length) continue;
      mcpConfig[mcp.name] = buildKiroMcpEntry(mcp, "cli");
    }

    const mcpJsonPath = join(hubDir, ".pi", "mcp.json");
    const newContent = JSON.stringify({ mcpServers: mcpConfig }, null, 2) + "\n";
    const newHash = createHash("sha256").update(newContent).digest("hex");

    let existingHash = "";
    if (existsSync(mcpJsonPath)) {
      try {
        const existing = await readFile(mcpJsonPath, "utf-8");
        existingHash = createHash("sha256").update(existing).digest("hex");
      } catch {}
    }

    if (newHash !== existingHash) {
      await mkdir(join(hubDir, ".pi"), { recursive: true });
      await writeFile(mcpJsonPath, newContent, "utf-8");
      ctx.ui.notify("Updated .pi/mcp.json from hub config", "info");
    }
  });
}
