import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HUB_MANAGED_END,
  HUB_MANAGED_START,
  applyPlan,
  diffPlan,
  managedBlockOf,
  mergeManagedBlock,
  verdictOf,
  writeManagedFile,
} from "./apply-plan.js";
import type { PlannedFile } from "./claude-code-plan.js";

const block = (inside: string) => `${HUB_MANAGED_START}\n${inside}\n${HUB_MANAGED_END}`;

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const fresh = () => (dir = mkdtempSync(join(tmpdir(), "apply-plan-")));

describe("mergeManagedBlock", () => {
  it("writes the block alone when there is no file yet", () => {
    expect(mergeManagedBlock(null, ["a", "b"])).toBe(`${block("a\nb")}\n`);
  });

  it("replaces only what sits between the markers", () => {
    const existing = `topo\n\n${block("velho")}\n\nrodape\n`;
    const merged = mergeManagedBlock(existing, ["novo"]);

    expect(merged).toContain("topo");
    expect(merged).toContain("rodape");
    expect(merged).toContain("novo");
    expect(merged).not.toContain("velho");
  });

  it("keeps a file that has no markers, putting the block on top", () => {
    const merged = mergeManagedBlock("escrito a mao\n", ["x"]);
    expect(merged.startsWith(HUB_MANAGED_START)).toBe(true);
    expect(merged).toContain("escrito a mao");
  });

  it("round-trips through managedBlockOf", () => {
    expect(managedBlockOf(mergeManagedBlock(null, ["a", "b"]))).toBe("a\nb");
    expect(managedBlockOf("sem marcador")).toBeNull();
  });
});

describe("applyPlan", () => {
  it("writes plain files, creating the folders they need", async () => {
    const root = fresh();
    const files: PlannedFile[] = [
      { path: "AGENTS.md", content: "corpo\n", kind: "file" },
      { path: ".claude/settings.json", content: "{}\n", kind: "file" },
    ];

    const written = await applyPlan(root, files);

    expect(written).toEqual(["AGENTS.md", ".claude/settings.json"]);
    expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("corpo\n");
    expect(readFileSync(join(root, ".claude/settings.json"), "utf-8")).toBe("{}\n");
  });

  it("preserves what the user keeps around a managed block", async () => {
    const root = fresh();
    writeFileSync(join(root, ".gitignore"), `minha-linha\n\n${block("antigo")}\n`);

    await applyPlan(root, [{ path: ".gitignore", content: "node_modules/\n/api", kind: "managed-block" }]);

    const after = readFileSync(join(root, ".gitignore"), "utf-8");
    expect(after).toContain("minha-linha");
    expect(after).toContain("/api");
    expect(after).not.toContain("antigo");
  });

  it("is idempotent — applying the same plan twice leaves the same bytes", async () => {
    const root = fresh();
    const files: PlannedFile[] = [
      { path: "CLAUDE.md", content: "um\n", kind: "file" },
      { path: ".gitignore", content: "node_modules/", kind: "managed-block" },
    ];

    await applyPlan(root, files);
    const first = readFileSync(join(root, ".gitignore"), "utf-8");
    await applyPlan(root, files);

    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(first);
  });

  it("writeManagedFile creates the folder of a nested path", async () => {
    const root = fresh();
    await writeManagedFile(join(root, "fundo", "do", "poco.txt"), ["ok"]);
    expect(managedBlockOf(readFileSync(join(root, "fundo/do/poco.txt"), "utf-8"))).toBe("ok");
  });
});

describe("diffPlan", () => {
  it("says what is the same, what changed and what is new", async () => {
    const root = fresh();
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "igual\n");
    writeFileSync(join(root, "CLAUDE.md"), "velho\n");
    writeFileSync(join(root, ".gitignore"), block("node_modules/"));

    const out = await diffPlan(root, [
      { path: "AGENTS.md", content: "igual\n", kind: "file" },
      { path: "CLAUDE.md", content: "novo\n", kind: "file" },
      { path: ".mcp.json", content: "{}\n", kind: "file" },
      { path: ".gitignore", content: "node_modules/", kind: "managed-block" },
    ]);

    expect(out.map((o) => o.verdict)).toEqual(["same", "changed", "new", "same"]);
  });

  it("a managed file whose markers were wiped counts as changed, never same", () => {
    expect(verdictOf({ path: "x", content: "a", kind: "managed-block" }, "a")).toBe("changed");
    expect(verdictOf({ path: "x", content: "a", kind: "file" }, "a")).toBe("same");
  });

  it("what applyPlan wrote reads back as the same", async () => {
    const root = fresh();
    const files: PlannedFile[] = [
      { path: "AGENTS.md", content: "corpo\n", kind: "file" },
      { path: ".gitignore", content: "node_modules/\n/api", kind: "managed-block" },
    ];

    await applyPlan(root, files);

    expect((await diffPlan(root, files)).every((o) => o.verdict === "same")).toBe(true);
  });
});
