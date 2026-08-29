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

describe("http MCP entries that authenticate through headers", () => {
  const withHeaders: MCPConfig = {
    name: "secure",
    url: "https://mcp.example.com/mcp",
    headers: {
      Authorization: "Bearer ${env:SECURE_MCP_TOKEN}",
      "X-Actor-Email": "${env:SECURE_ACTOR_EMAIL}",
    },
  };

  it("keeps the headers for claude code and strips the env: prefix", () => {
    expect(buildClaudeCodeMcpEntry(withHeaders)).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${SECURE_MCP_TOKEN}",
        "X-Actor-Email": "${SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("omits headers when the http MCP declares none", () => {
    expect(buildClaudeCodeMcpEntry({ name: "open", url: "https://mcp.example.com/mcp" })).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("never inlines a secret — the value stays an env reference", () => {
    const entry = buildClaudeCodeMcpEntry(withHeaders) as {
      headers: Record<string, string>;
    };
    for (const value of Object.values(entry.headers)) {
      expect(value).toMatch(/\$\{\w+\}/);
    }
  });

  it("keeps the headers for cursor without rewriting the env reference", () => {
    expect(buildCursorMcpEntry(withHeaders)).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${env:SECURE_MCP_TOKEN}",
        "X-Actor-Email": "${env:SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("keeps the headers for kiro and strips the env: prefix in editor mode", () => {
    expect(buildKiroMcpEntry(withHeaders)).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${SECURE_MCP_TOKEN}",
        "X-Actor-Email": "${SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("keeps the raw env: prefix in the kiro headers when generating for the CLI", () => {
    expect(buildKiroMcpEntry(withHeaders, "cli")).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${env:SECURE_MCP_TOKEN}",
        "X-Actor-Email": "${env:SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("keeps the headers for opencode in the opencode brace syntax", () => {
    expect(buildOpenCodeMcpEntry(withHeaders)).toEqual({
      type: "remote",
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer {env:SECURE_MCP_TOKEN}",
        "X-Actor-Email": "{env:SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("keeps the headers for pi and strips the env: prefix", () => {
    expect(buildPiMcpEntry(withHeaders)).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: "Bearer ${SECURE_MCP_TOKEN}",
        "X-Actor-Email": "${SECURE_ACTOR_EMAIL}",
      },
    });
  });

  it("omits headers for cursor, kiro, opencode and pi when the http MCP declares none", () => {
    const bare: MCPConfig = { name: "open", url: "https://mcp.example.com/mcp" };
    expect(buildCursorMcpEntry(bare)).toEqual({ url: "https://mcp.example.com/mcp" });
    expect(buildKiroMcpEntry(bare)).toEqual({ url: "https://mcp.example.com/mcp" });
    expect(buildOpenCodeMcpEntry(bare)).toEqual({
      type: "remote",
      url: "https://mcp.example.com/mcp",
    });
    expect(buildPiMcpEntry(bare)).toEqual({ url: "https://mcp.example.com/mcp" });
  });

  it("never inlines a secret for cursor, kiro, opencode or pi either", () => {
    const entries = [
      buildCursorMcpEntry(withHeaders),
      buildKiroMcpEntry(withHeaders),
      buildOpenCodeMcpEntry(withHeaders),
      buildPiMcpEntry(withHeaders),
    ] as Array<{ headers: Record<string, string> }>;
    for (const entry of entries) {
      for (const value of Object.values(entry.headers)) {
        expect(value).toMatch(/\$?\{(?:env:)?\w+\}/);
        expect(value).not.toContain("SECURE_MCP_TOKEN=");
      }
    }
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

  it("converts timeout_ms to whole seconds for claude", () => {
    const result = buildClaudeHooks({
      stop: [{ type: "command", command: "lint.mjs", timeout_ms: 200000 }],
    });
    expect(result?.Stop).toEqual([
      { hooks: [{ type: "command", command: "lint.mjs", timeout: 200 }] },
    ]);
  });

  it("drops events claude does not support and returns null when empty", () => {
    expect(buildClaudeHooks({ before_shell_execution: [{ type: "command", command: "x" }] })).toBeNull();
  });
});
