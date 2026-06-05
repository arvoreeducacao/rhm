import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { partitionOptional, resolveOptionalRepos } from "./optional-repos.js";
import type { Repo } from "./hub-config.js";

function makeRepo(name: string, overrides: Partial<Repo> = {}): Repo {
  return {
    name,
    path: `./${name}`,
    url: `git@github.com:org/${name}.git`,
    ...overrides,
  };
}

describe("partitionOptional", () => {
  it("splits required and optional repos", () => {
    const repos = [
      makeRepo("api"),
      makeRepo("design-flows", { optional: true, group: "design" }),
      makeRepo("web"),
      makeRepo("design-brand", { optional: true, group: "design" }),
    ];

    const { required, optional } = partitionOptional(repos);

    expect(required.map((r) => r.name)).toEqual(["api", "web"]);
    expect(optional.map((r) => r.name)).toEqual([
      "design-flows",
      "design-brand",
    ]);
  });

  it("treats missing optional flag as required", () => {
    const { required, optional } = partitionOptional([makeRepo("api")]);
    expect(required).toHaveLength(1);
    expect(optional).toHaveLength(0);
  });
});

describe("resolveOptionalRepos", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "optional-repos-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns all pending optional repos when withOptional is set", async () => {
    const optional = [
      makeRepo("design-flows", { optional: true }),
      makeRepo("design-brand", { optional: true }),
    ];

    const result = await resolveOptionalRepos(optional, tempDir, {
      withOptional: true,
    });

    expect(result.map((r) => r.name)).toEqual([
      "design-flows",
      "design-brand",
    ]);
  });

  it("returns nothing when skipOptional is set", async () => {
    const optional = [makeRepo("design-flows", { optional: true })];
    const result = await resolveOptionalRepos(optional, tempDir, {
      skipOptional: true,
    });
    expect(result).toEqual([]);
  });

  it("ignores optional repos already present on disk", async () => {
    await mkdir(join(tempDir, "design-flows"), { recursive: true });
    const optional = [
      makeRepo("design-flows", { optional: true }),
      makeRepo("design-brand", { optional: true }),
    ];

    const result = await resolveOptionalRepos(optional, tempDir, {
      withOptional: true,
    });

    expect(result.map((r) => r.name)).toEqual(["design-brand"]);
  });

  it("skips prompting in non-interactive runs", async () => {
    const previous = process.stdout.isTTY;
    process.stdout.isTTY = false;
    try {
      const optional = [makeRepo("design-flows", { optional: true })];
      const result = await resolveOptionalRepos(optional, tempDir);
      expect(result).toEqual([]);
    } finally {
      process.stdout.isTTY = previous;
    }
  });
});
