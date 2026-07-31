import { describe, it, expect } from "vitest";
import {
  buildCursorMcpEntry,
  buildClaudeCodeMcpEntry,
  buildKiroMcpEntry,
  buildPiMcpEntry,
  buildOpenCodeMcpEntry,
  buildProxyUpstreams,
} from "./prompt-builders.js";
import type { MCPConfig } from "./types.js";

const withCommand: MCPConfig = {
  name: "bee",
  command: "bee",
  args: ["mcp", "serve"],
};

const withPackage: MCPConfig = {
  name: "npm-registry",
  package: "@arvoretech/npm-registry-mcp",
};

describe("stdio MCP entries built from a local command", () => {
  it("uses the command for cursor", () => {
    expect(buildCursorMcpEntry(withCommand)).toMatchObject({
      command: "bee",
      args: ["mcp", "serve"],
    });
  });

  it("uses the command for claude code", () => {
    expect(buildClaudeCodeMcpEntry(withCommand)).toMatchObject({
      command: "bee",
      args: ["mcp", "serve"],
    });
  });

  it("uses the command for kiro", () => {
    expect(buildKiroMcpEntry(withCommand)).toMatchObject({
      command: "bee",
      args: ["mcp", "serve"],
    });
  });

  it("uses the command for pi", () => {
    expect(buildPiMcpEntry(withCommand)).toMatchObject({
      command: "bee",
      args: ["mcp", "serve"],
    });
  });

  it("uses the command for opencode", () => {
    expect(buildOpenCodeMcpEntry(withCommand)).toMatchObject({
      type: "local",
      command: ["bee", "mcp", "serve"],
    });
  });

  it("never emits a null argument when there is no package", () => {
    for (const entry of [
      buildCursorMcpEntry(withCommand),
      buildClaudeCodeMcpEntry(withCommand),
      buildKiroMcpEntry(withCommand),
      buildPiMcpEntry(withCommand),
      buildOpenCodeMcpEntry(withCommand),
    ]) {
      expect(JSON.stringify(entry)).not.toContain("null");
    }
  });

  it("omits args when the command takes none", () => {
    expect(buildClaudeCodeMcpEntry({ name: "bee", command: "bee" })).toEqual({
      command: "bee",
    });
  });

  it("routes a command-based upstream through the proxy", () => {
    const proxy: MCPConfig = { name: "proxy", package: "proxy-mcp", upstreams: ["bee"] };
    const { upstreamsJson } = buildProxyUpstreams(proxy, [withCommand]);
    expect(JSON.parse(upstreamsJson)).toEqual([
      { name: "bee", command: "bee", args: ["mcp", "serve"] },
    ]);
  });
});

describe("stdio MCP entries built from a package", () => {
  it("still shells out through npx for claude code", () => {
    expect(buildClaudeCodeMcpEntry(withPackage)).toMatchObject({
      command: "npx",
      args: ["-y", "@arvoretech/npm-registry-mcp"],
    });
  });

  it("still shells out through npx for opencode", () => {
    expect(buildOpenCodeMcpEntry(withPackage)).toMatchObject({
      type: "local",
      command: ["npx", "-y", "@arvoretech/npm-registry-mcp"],
    });
  });
});
