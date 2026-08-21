import { describe, expect, it } from "vitest";
import { planClaudeCodeFiles, buildClaudeCodeMcpJson } from "./claude-code-plan.js";
import type { HubConfig, PersonaData } from "./types.js";

const baseConfig: HubConfig = {
  name: "test-hub",
  repos: [
    { name: "api", path: "./api", url: "git@github.com:org/api.git", tech: "nestjs" },
  ],
};

const persona: PersonaData = { name: "Ana", role: "CTO" };

describe("planClaudeCodeFiles", () => {
  it("plans the base set of files for a minimal config", () => {
    const plan = planClaudeCodeFiles(baseConfig);
    const paths = plan.files.map((f) => f.path);

    expect(paths).toEqual(["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".gitignore"]);
  });

  it("includes .mcp.json when mcps are configured", () => {
    const plan = planClaudeCodeFiles({
      ...baseConfig,
      mcps: [{ name: "postgresql", package: "@arvoretech/postgresql-mcp" }],
    });

    const mcpFile = plan.files.find((f) => f.path === ".mcp.json");
    expect(mcpFile).toBeDefined();
    const parsed = JSON.parse(mcpFile!.content);
    expect(parsed.mcpServers.postgresql).toBeDefined();
  });

  it("emits CLAUDE.local.md only when a persona is given", () => {
    const without = planClaudeCodeFiles(baseConfig);
    expect(without.files.some((f) => f.path === "CLAUDE.local.md")).toBe(false);

    const withPersona = planClaudeCodeFiles(baseConfig, { persona });
    const local = withPersona.files.find((f) => f.path === "CLAUDE.local.md");
    expect(local?.content).toContain("Persona — Ana");
  });

  it("appends steering content to CLAUDE.md with frontmatter stripped", () => {
    const plan = planClaudeCodeFiles(baseConfig, {
      steering: [
        { name: "rules.md", content: "---\ntitle: x\n---\nAlways write tests." },
        { name: "empty.md", content: "---\ntitle: y\n---\n" },
      ],
    });

    const claudeMd = plan.files.find((f) => f.path === "CLAUDE.md")!;
    expect(claudeMd.content).toContain("Always write tests.");
    expect(claudeMd.content).not.toContain("title: x");

    const agentsMd = plan.files.find((f) => f.path === "AGENTS.md")!;
    expect(agentsMd.content).not.toContain("Always write tests.");
  });

  it("marks .gitignore as a managed block listing every repo", () => {
    const plan = planClaudeCodeFiles(baseConfig);
    const gitignore = plan.files.find((f) => f.path === ".gitignore")!;

    expect(gitignore.kind).toBe("managed-block");
    expect(gitignore.content.split("\n")).toContain("/api");
  });

  it("allows configured MCP servers and wires hooks into settings", () => {
    const plan = planClaudeCodeFiles({
      ...baseConfig,
      mcps: [{ name: "postgresql", package: "@arvoretech/postgresql-mcp" }],
      hooks: {
        pre_tool_use: [{ type: "command", command: "./check.sh", matcher: "Bash" }],
      },
    });

    const settings = JSON.parse(plan.files.find((f) => f.path === ".claude/settings.json")!.content);
    expect(settings.permissions.allow).toContain("mcp__postgresql__*");
    expect(settings.hooks.PreToolUse).toBeDefined();
  });
});

describe("buildClaudeCodeMcpJson", () => {
  it("returns null without mcps", () => {
    expect(buildClaudeCodeMcpJson(baseConfig)).toBeNull();
  });

  it("collapses proxy upstreams into a single entry", () => {
    const json = buildClaudeCodeMcpJson({
      ...baseConfig,
      mcps: [
        { name: "postgresql", package: "@arvoretech/postgresql-mcp" },
        { name: "proxy", package: "@arvoretech/mcp-proxy", upstreams: ["postgresql"] },
      ],
    })!;

    const parsed = JSON.parse(json);
    expect(parsed.mcpServers.proxy).toBeDefined();
    expect(parsed.mcpServers.postgresql).toBeUndefined();
  });
});
