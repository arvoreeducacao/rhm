import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { planInitWorkspace, DEFAULT_HUB_CLI_VERSION_RANGE } from "./init-plan.js";

const options = {
  name: "meu-hub",
  repos: [
    { name: "api", url: "git@github.com:org/api.git", tech: "nestjs" },
    { name: "docs", url: "git@github.com:org/docs.git" },
  ],
  mcps: ["postgresql", "datadog", "custom-thing"],
  skills: ["code-review"],
};

describe("planInitWorkspace", () => {
  it("plans a typescript workspace by default", () => {
    const files = planInitWorkspace(options);
    expect(files.map((f) => f.path)).toEqual([
      "hub.config.ts",
      "package.json",
      "tsconfig.json",
      ".gitignore",
      "README.md",
    ]);

    const config = files.find((f) => f.path === "hub.config.ts")!.content;
    expect(config).toContain('repo.nestjs("api", "git@github.com:org/api.git")');
    expect(config).toContain('repo.custom("docs", "git@github.com:org/docs.git")');
    expect(config).toContain('mcp.postgresql("postgresql")');
    expect(config).toContain("mcp.datadog()");
    expect(config).toContain('mcp.custom("custom-thing")');
    expect(config).toContain('skills: ["code-review"]');

    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    expect(pkg.devDependencies["@arvoretech/hub"]).toBe(DEFAULT_HUB_CLI_VERSION_RANGE);
  });

  it("pins the CLI version the caller passes", () => {
    const files = planInitWorkspace({ ...options, hubCliVersionRange: "^9.9.9" });
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    expect(pkg.devDependencies["@arvoretech/hub"]).toBe("^9.9.9");
  });

  it("plans a yaml workspace that parses and carries the schema comment", () => {
    const files = planInitWorkspace({ ...options, configFormat: "yaml" });
    expect(files.map((f) => f.path)).toEqual(["hub.yaml", ".gitignore", "README.md"]);

    const yaml = files.find((f) => f.path === "hub.yaml")!.content;
    expect(yaml.startsWith("# yaml-language-server: $schema=")).toBe(true);
    const parsed = parse(yaml) as { name: string; repos: { path: string }[] };
    expect(parsed.name).toBe("meu-hub");
    expect(parsed.repos[0].path).toBe("./api");
  });

  it("gitignores each repo and README points at the chosen editor", () => {
    const files = planInitWorkspace({ ...options, editor: "claude-code" });
    expect(files.find((f) => f.path === ".gitignore")!.content).toContain("/api");
    expect(files.find((f) => f.path === "README.md")!.content).toContain("hub generate --editor claude-code");
  });
});
