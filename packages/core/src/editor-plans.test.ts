import { describe, expect, it } from "vitest";
import { planCursorFiles } from "./cursor-plan.js";
import { planOpenCodeFiles } from "./opencode-plan.js";
import { planKiroFiles, parseMcpDisabledState } from "./kiro-plan.js";
import { planCodexFiles } from "./codex-plan.js";
import { planPiFiles, buildPiSettingsJson, HUB_PI_PACKAGE } from "./pi-plan.js";
import type { HubConfig, PersonaData } from "./types.js";

const config: HubConfig = {
  name: "test-hub",
  repos: [
    { name: "api", path: "./api", url: "git@github.com:org/api.git", tech: "nestjs" },
    { name: "web", path: "./web", url: "git@github.com:org/web.git" },
  ],
  mcps: [
    { name: "postgresql", package: "@arvoretech/postgresql-mcp", env: { PG_PASSWORD: "${env:PG_PASSWORD}" } },
    { name: "proxy", package: "@arvoretech/mcp-proxy", upstreams: ["postgresql"] },
  ],
  hooks: {
    pre_tool_use: [{ type: "command", command: "./check.sh", matcher: "Bash" }],
    after_file_edit: [{ type: "command", command: "./fmt.sh" }],
  },
};

const persona: PersonaData = { name: "Ana", role: "CTO" };
const steering = [{ name: "regras.md", content: "---\ntitle: x\n---\nSempre escreva testes." }];

function paths(plan: { files: { path: string }[] }): string[] {
  return plan.files.map((f) => f.path);
}

describe("planCursorFiles", () => {
  it("plans the cursor file set", () => {
    const plan = planCursorFiles(config, { steering, persona });
    expect(paths(plan)).toEqual([
      ".gitignore",
      ".cursorignore",
      ".cursor/mcp.json",
      ".cursor/rules/orchestrator.mdc",
      "AGENTS.md",
      ".cursor/rules/persona.mdc",
      ".cursor/rules/regras.mdc",
      ".cursor/hooks.json",
    ]);
  });

  it("collapses proxy upstreams and re-includes repos in .cursorignore", () => {
    const plan = planCursorFiles(config);
    const mcp = JSON.parse(plan.files.find((f) => f.path === ".cursor/mcp.json")!.content);
    expect(mcp.mcpServers.proxy).toBeDefined();
    expect(mcp.mcpServers.postgresql).toBeUndefined();

    const ignore = plan.files.find((f) => f.path === ".cursorignore")!;
    expect(ignore.kind).toBe("managed-block");
    expect(ignore.content).toContain("!api/");
    expect(ignore.content).toContain("!web/");
  });

  it("wraps steering as always-applied .mdc rules", () => {
    const plan = planCursorFiles(config, { steering });
    const rule = plan.files.find((f) => f.path === ".cursor/rules/regras.mdc")!;
    expect(rule.content).toContain("alwaysApply: true");
    expect(rule.content).toContain("Sempre escreva testes.");
    expect(rule.content).not.toContain("title: x");
  });
});

describe("planOpenCodeFiles", () => {
  it("plans the opencode file set with the primary agent", () => {
    const plan = planOpenCodeFiles(config, { steering, persona });
    expect(paths(plan)).toEqual([
      ".gitignore",
      ".ignore",
      ".opencode/agents/orchestrator.md",
      "AGENTS.md",
      ".opencode/rules/persona.md",
      ".opencode/rules/regras.md",
      "opencode.json",
      ".opencode/plugins/hub-hooks.js",
    ]);
    const agent = plan.files.find((f) => f.path === ".opencode/agents/orchestrator.md")!;
    expect(agent.content).toContain("mode: primary");
  });

  it("emits opencode.json with mcp entries in opencode shape", () => {
    const plan = planOpenCodeFiles(config);
    const json = JSON.parse(plan.files.find((f) => f.path === "opencode.json")!.content);
    expect(json.default_agent).toBe("orchestrator");
    expect(json.mcp.proxy.type).toBe("local");
    expect(json.instructions).toEqual([".opencode/rules/*.md"]);
  });
});

describe("planKiroFiles", () => {
  it("preserves the user's disabled state from the existing mcp.json", () => {
    const existing = JSON.stringify({ mcpServers: { proxy: { command: "npx", disabled: true } } });
    const plan = planKiroFiles(config, { existingMcpJson: existing });
    const mcp = JSON.parse(plan.files.find((f) => f.path === ".kiro/settings/mcp.json")!.content);
    expect(mcp.mcpServers.proxy.disabled).toBe(true);
  });

  it("merges inclusion and meta from source and existing steering frontmatter", () => {
    const plan = planKiroFiles(config, {
      steering: [
        {
          name: "dicas.md",
          content: "---\ninclusion: auto\nname: dicas\n---\nUse flags.",
          existingContent: "---\ninclusion: always\ndescription: antiga\n---\nvelho",
        },
      ],
    });
    const file = plan.files.find((f) => f.path === ".kiro/steering/dicas.md")!;
    expect(file.content).toContain("inclusion: auto");
    expect(file.content).toContain("name: dicas");
    expect(file.content).toContain("description: antiga");
  });

  it("returns kiro hook notes on the plan notes", () => {
    const plan = planKiroFiles(config);
    expect(plan.notes?.some((w) => w.includes("pre_tool_use"))).toBe(true);
    expect(plan.notes?.some((w) => w.includes("file_save"))).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it("parseMcpDisabledState tolerates invalid json", () => {
    expect(parseMcpDisabledState("{nope")).toEqual({});
    expect(parseMcpDisabledState(null)).toEqual({});
  });
});

describe("planCodexFiles", () => {
  it("plans AGENTS.md, config.toml and gitignore, surfacing warnings", () => {
    const plan = planCodexFiles({
      ...config,
      mcps: [...(config.mcps ?? []), { name: "quebrado" }],
    });
    expect(paths(plan)).toEqual(["AGENTS.md", ".codex/config.toml", ".gitignore"]);
    const toml = plan.files.find((f) => f.path === ".codex/config.toml")!.content;
    expect(toml).toContain("[mcp_servers.proxy]");
    expect(toml).not.toContain("[mcp_servers.postgresql]");
    expect(plan.warnings.some((w) => w.includes('"quebrado"'))).toBe(true);
  });

  it("omits config.toml without mcps", () => {
    const plan = planCodexFiles({ name: "x", repos: config.repos });
    expect(paths(plan)).toEqual(["AGENTS.md", ".gitignore"]);
  });
});

describe("planPiFiles", () => {
  it("registers hub-pi and the skills dir while preserving existing settings", () => {
    const settings = JSON.parse(
      buildPiSettingsJson({ packages: ["npm:other"], theme: "dark" })
    );
    expect(settings.packages).toEqual(["npm:other", HUB_PI_PACKAGE]);
    expect(settings.skills).toEqual(["skills"]);
    expect(settings.theme).toBe("dark");
  });

  it("skips AGENTS.md when injectCapabilities is off", () => {
    const withAgents = planPiFiles(config);
    expect(paths(withAgents)).toContain("AGENTS.md");

    const without = planPiFiles({ ...config, pi: { injectCapabilities: false } });
    expect(paths(without)).toEqual([".gitignore", ".pi/settings.json"]);
  });
});
