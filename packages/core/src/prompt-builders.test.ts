import { describe, it, expect } from "vitest";
import {
  buildClaudeHooks,
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

describe("claude hooks follow the settings.json nested schema", () => {
  it("wraps entries in matcher groups with an inner hooks array", () => {
    expect(
      buildClaudeHooks({
        post_tool_use: [
          { type: "command", command: "node track.mjs", matcher: "Edit|Write" },
        ],
        stop: [{ type: "command", command: "node remind.mjs" }],
      })
    ).toEqual({
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "node track.mjs" }],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "node remind.mjs" }] }],
    });
  });

  it("groups entries that share a matcher", () => {
    const result = buildClaudeHooks({
      post_tool_use: [
        { type: "command", command: "a.sh", matcher: "Edit" },
        { type: "command", command: "b.sh", matcher: "Edit" },
      ],
    });
    expect(result?.PostToolUse).toHaveLength(1);
  });

  it("drops events claude does not support and returns null when empty", () => {
    expect(buildClaudeHooks({ before_shell_execution: [{ type: "command", command: "x" }] })).toBeNull();
  });
});
