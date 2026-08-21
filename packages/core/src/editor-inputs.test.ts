import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_NAMES, gatherEditorInputs, isEditorName, planEditor, planForEditor, readSteeringInputs } from "./editor-inputs.js";
import type { HubConfig } from "./types.js";

const config: HubConfig = {
  name: "hub",
  repos: [{ name: "api", path: "./api", url: "git@github.com:o/api.git", tech: "nestjs" }],
  mcps: [{ name: "postgresql", package: "@arvoretech/postgresql-mcp" }],
};

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function hub(): string {
  dir = mkdtempSync(join(tmpdir(), "editor-inputs-"));
  mkdirSync(join(dir, "steering"), { recursive: true });
  writeFileSync(join(dir, "steering", "regras.md"), "---\ntitle: x\n---\nSempre escreva testes.\n");
  writeFileSync(join(dir, "steering", "leia.txt"), "não é markdown");
  return dir;
}

describe("readSteeringInputs", () => {
  it("reads only the markdown of the steering folder", async () => {
    const steering = await readSteeringInputs(hub());
    expect(steering.map((s) => s.name)).toEqual(["regras.md"]);
    expect(steering[0].content).toContain("Sempre escreva testes.");
  });

  it("a hub with no steering folder is not an error", async () => {
    dir = mkdtempSync(join(tmpdir(), "sem-steering-"));
    expect(await readSteeringInputs(dir)).toEqual([]);
  });
});

describe("gatherEditorInputs", () => {
  it("kiro also collects the mode and what is already written", async () => {
    const root = hub();
    mkdirSync(join(root, ".kiro", "steering"), { recursive: true });
    mkdirSync(join(root, ".kiro", "settings"), { recursive: true });
    writeFileSync(join(root, ".kiro", "steering", "regras.md"), "---\ninclusion: auto\n---\nvelho");
    writeFileSync(join(root, ".kiro", "settings", "mcp.json"), '{"mcpServers":{"postgresql":{"disabled":true}}}');

    const inputs = await gatherEditorInputs(root, "kiro", { kiroMode: "cli" });

    expect(inputs.kiroMode).toBe("cli");
    expect(inputs.kiroSteering?.[0].existingContent).toContain("inclusion: auto");
    expect(inputs.existingMcpJson).toContain("disabled");
  });

  it("pi reads the settings it must preserve", async () => {
    const root = hub();
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, ".pi", "settings.json"), '{"packages":["npm:outro"],"theme":"dark"}');

    const inputs = await gatherEditorInputs(root, "pi");

    expect(inputs.existingSettings).toEqual({ packages: ["npm:outro"], theme: "dark" });
    expect(inputs.blocked).toBeUndefined();
  });

  it("pi settings that are not valid JSON block the plan instead of being overwritten", async () => {
    const root = hub();
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, ".pi", "settings.json"), "{ nao sou json");

    const inputs = await gatherEditorInputs(root, "pi");
    expect(inputs.blocked).toMatch(/not valid JSON/);

    const plan = await planEditor(root, config, "pi");
    expect(plan.blocked).toMatch(/not valid JSON/);
    expect(plan.files).toEqual([]);
  });
});

describe("planForEditor", () => {
  it("every editor name plans something", async () => {
    const root = hub();
    for (const editor of EDITOR_NAMES) {
      const plan = await planEditor(root, config, editor);
      expect(plan.files.length, editor).toBeGreaterThan(0);
      expect(plan.files.some((f) => f.path === ".gitignore"), editor).toBe(true);
    }
  });

  it("dispatches to the editor asked for", () => {
    const cursor = planForEditor(config, "cursor", { steering: [], persona: null });
    const claude = planForEditor(config, "claude-code", { steering: [], persona: null });

    expect(cursor.files.some((f) => f.path === ".cursor/mcp.json")).toBe(true);
    expect(claude.files.some((f) => f.path === ".mcp.json")).toBe(true);
  });

  it("isEditorName refuses what is not an editor", () => {
    expect(isEditorName("kiro")).toBe(true);
    expect(isEditorName("vscode")).toBe(false);
  });
});
