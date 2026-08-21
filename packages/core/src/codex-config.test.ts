import { describe, it, expect } from "vitest";
import { splitEnvForCodex, buildCodexMcpBlock } from "./codex-config.js";
import type { MCPConfig } from "./types.js";

describe("splitEnvForCodex", () => {
  it("returns empty result for undefined env", () => {
    expect(splitEnvForCodex(undefined)).toEqual({
      literal: {},
      forwarded: [],
      warnings: [],
    });
  });

  it("forwards a placeholder that matches its key", () => {
    const result = splitEnvForCodex({ FIGMA_API_KEY: "${env:FIGMA_API_KEY}" });
    expect(result.forwarded).toEqual(["FIGMA_API_KEY"]);
    expect(result.literal).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("keeps non-placeholder values as literals", () => {
    const result = splitEnvForCodex({ LOG_LEVEL: "info" });
    expect(result.literal).toEqual({ LOG_LEVEL: "info" });
    expect(result.forwarded).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when a placeholder references a different key", () => {
    const result = splitEnvForCodex({ FOO: "${env:BAR}" });
    expect(result.forwarded).toEqual([]);
    expect(result.literal).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("FOO");
    expect(result.warnings[0]).toContain("${env:BAR}");
  });

  it("forwards lowercase placeholder that matches its key", () => {
    const result = splitEnvForCodex({ foo: "${env:foo}" });
    expect(result.forwarded).toEqual(["foo"]);
    expect(result.warnings).toEqual([]);
  });

  it("handles a mix of forwarded, literal and mismatched entries", () => {
    const result = splitEnvForCodex({
      TOKEN: "${env:TOKEN}",
      LOG_LEVEL: "info",
      MISMATCH: "${env:OTHER}",
    });
    expect(result.forwarded).toEqual(["TOKEN"]);
    expect(result.literal).toEqual({ LOG_LEVEL: "info" });
    expect(result.warnings).toHaveLength(1);
  });
});

describe("buildCodexMcpBlock", () => {
  const build = (mcp: MCPConfig) => buildCodexMcpBlock(mcp.name, mcp);

  it("returns null when no url, image, command or package is set", () => {
    expect(build({ name: "empty" })).toBeNull();
  });

  it("builds an http block from url", () => {
    const result = build({ name: "figma", url: "https://mcp.figma.com/mcp" });
    expect(result).not.toBeNull();
    expect(result!.block).toContain("[mcp_servers.figma]");
    expect(result!.block).toContain("url = 'https://mcp.figma.com/mcp'");
    expect(result!.warnings).toEqual([]);
  });

  it("warns when a url MCP declares auth (Codex needs bearer_token_env_var)", () => {
    const result = build({
      name: "secure",
      url: "https://mcp.example.com/mcp",
      auth: "bearer",
    });
    expect(result).not.toBeNull();
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0]).toContain("bearer_token_env_var");
  });

  it("builds an npx block from package and appends args", () => {
    const result = build({
      name: "framelink",
      package: "figma-developer-mcp",
      args: ["--stdio"],
    });
    expect(result!.block).toContain("command = 'npx'");
    expect(result!.block).toContain("args = ['-y', 'figma-developer-mcp', '--stdio']");
  });

  it("builds a direct command block", () => {
    const result = build({ name: "bee", command: "bee", args: ["mcp", "serve"] });
    expect(result!.block).toContain("command = 'bee'");
    expect(result!.block).toContain("args = ['mcp', 'serve']");
  });

  it("builds a docker block and forwards matching env placeholders", () => {
    const result = build({
      name: "signoz",
      image: "signoz/signoz-mcp-server:latest",
      env: { SIGNOZ_URL: "${env:SIGNOZ_URL}", LOG_LEVEL: "info" },
    });
    expect(result!.block).toContain("command = 'docker'");
    expect(result!.block).toContain("'-e', 'SIGNOZ_URL'");
    expect(result!.block).toContain("'-e', 'LOG_LEVEL=info'");
    expect(result!.block).toContain("'signoz/signoz-mcp-server:latest'");
  });

  it("emits env_vars and a literal env table for a package MCP", () => {
    const result = build({
      name: "client-hub",
      package: "@arvoretech/client-hub-mcp",
      env: { CLIENT_HUB_API_TOKEN: "${env:CLIENT_HUB_API_TOKEN}", MODE: "prod" },
    });
    expect(result!.block).toContain("env_vars = ['CLIENT_HUB_API_TOKEN']");
    expect(result!.block).toContain("[mcp_servers.client-hub.env]");
    expect(result!.block).toContain("MODE = 'prod'");
  });

  it("propagates env warnings prefixed with the server name", () => {
    const result = build({
      name: "broken",
      package: "some-mcp",
      env: { FOO: "${env:BAR}" },
    });
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0]).toContain("broken");
    expect(result!.warnings[0]).toContain("FOO");
  });
});
