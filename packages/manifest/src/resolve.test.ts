import { describe, it, expect } from "vitest";
import { applies, pathFor, repoName, resolve } from "./resolve.js";
import { reconcile } from "./reconcile.js";
import type { Manifest } from "./types.js";

const manifest: Manifest = {
  repos: ["acme/api", "acme/web", "acme/design-system"],
  skills: {
    delivery: "*",
    "backend-nestjs": "api",
    "design-system": ["web", "design-system"],
    "writing-tokens": [{ repo: "web", path: "src/app/writing/**" }],
  },
  mcps: {
    context7: "*",
    postgres: "api",
  },
  env: { web: ".env.local" },
  integrations: { branch: "{task}-{slug}", slack: "C123" },
};

describe("applies", () => {
  it("matches every repository for *", () => {
    expect(applies("*", "anything")).toBe(true);
  });

  it("matches a single repository by name", () => {
    expect(applies("api", "api")).toBe(true);
    expect(applies("api", "web")).toBe(false);
  });

  it("matches any entry of a list", () => {
    expect(applies(["web", "design-system"], "design-system")).toBe(true);
    expect(applies(["web", "design-system"], "api")).toBe(false);
  });

  it("matches a path-narrowed target by its repo", () => {
    expect(applies([{ repo: "web", path: "src/**" }], "web")).toBe(true);
    expect(applies([{ repo: "web", path: "src/**" }], "api")).toBe(false);
  });
});

describe("pathFor", () => {
  it("returns the glob when the target narrows one", () => {
    expect(pathFor([{ repo: "web", path: "src/app/writing/**" }], "web")).toBe(
      "src/app/writing/**",
    );
  });

  it("returns undefined for a whole-repository target", () => {
    expect(pathFor("web", "web")).toBeUndefined();
    expect(pathFor("*", "web")).toBeUndefined();
  });

  it("returns undefined for a repository the scope does not cover", () => {
    expect(pathFor([{ repo: "web", path: "src/**" }], "api")).toBeUndefined();
  });
});

describe("repoName", () => {
  it("takes the name after the org", () => {
    expect(repoName("acme/api")).toBe("api");
  });

  it("passes through a bare name", () => {
    expect(repoName("api")).toBe("api");
  });
});

describe("resolve", () => {
  it("collects what a repository carries", () => {
    const r = resolve(manifest, "api");
    expect(r.skills.map((s) => s.name)).toEqual(["delivery", "backend-nestjs"]);
    expect(r.mcps.map((m) => m.name)).toEqual(["context7", "postgres"]);
    expect(r.declared).toBe(true);
  });

  it("keeps the path on a narrowed skill", () => {
    const r = resolve(manifest, "web");
    expect(r.skills).toContainEqual({ name: "writing-tokens", path: "src/app/writing/**" });
    expect(r.skills).toContainEqual({ name: "design-system" });
  });

  it("falls back to .env when no env file is declared", () => {
    expect(resolve(manifest, "api").envFile).toBe(".env");
    expect(resolve(manifest, "web").envFile).toBe(".env.local");
  });

  it("still resolves a repository missing from repos, and says so", () => {
    const r = resolve(manifest, "stranger");
    expect(r.declared).toBe(false);
    expect(r.skills.map((s) => s.name)).toEqual(["delivery"]);
  });

  it("defaults integrations to an empty object", () => {
    expect(resolve({ repos: [] }, "api").integrations).toEqual({});
  });
});

describe("reconcile", () => {
  it("splits declared and present repositories three ways", () => {
    const r = reconcile(manifest, ["api", "web", "extra"]);
    expect(r.matched).toEqual(["api", "web"]);
    expect(r.missing).toEqual(["design-system"]);
    expect(r.undeclared).toEqual(["extra"]);
  });

  it("reports everything missing when the disk is empty", () => {
    const r = reconcile(manifest, []);
    expect(r.missing).toHaveLength(3);
    expect(r.undeclared).toEqual([]);
  });
});
