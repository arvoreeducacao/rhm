import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, stackOf } from "./scan.js";
import { load } from "./load.js";

let root: string;

const repo = (name: string, files: Record<string, string> = {}) => {
  const dir = join(root, name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
  return dir;
};

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "manifest-"));
  repo("api", { "package.json": pkg({ "@nestjs/core": "10" }) });
  repo("web", { "package.json": pkg({ next: "16", react: "19" }) });
  repo("mobile", { "package.json": pkg({ "react-native": "0.76" }) });
  repo("ui", { "package.json": pkg({ react: "19" }) });
  repo("tool", { "package.json": pkg({}) });
  repo("legacy", { "mix.exs": "" });
  repo("etl", { "requirements.txt": "" });
  repo("mystery");
  mkdirSync(join(root, "not-a-repo"), { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scan", () => {
  it("finds only directories that are git repositories", () => {
    const names = scan(root).map((r) => r.name);
    expect(names).toContain("api");
    expect(names).not.toContain("not-a-repo");
  });

  it("returns repositories sorted by name", () => {
    const names = scan(root).map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("stackOf", () => {
  it.each([
    ["api", "nestjs"],
    ["web", "nextjs"],
    ["mobile", "react-native"],
    ["ui", "react"],
    ["tool", "node"],
    ["legacy", "elixir"],
    ["etl", "python"],
    ["mystery", "unknown"],
  ])("reads %s as %s", (name, stack) => {
    expect(stackOf(join(root, name))).toBe(stack);
  });

  it("does not throw on a broken package.json", () => {
    const dir = repo("broken", { "package.json": "{ not json" });
    expect(stackOf(dir)).toBe("node");
  });
});

describe("load", () => {
  it("throws with the path when the manifest is missing", () => {
    expect(() => load(root)).toThrow(/no hive\.json/);
  });

  it("throws when repos is not an array", () => {
    writeFileSync(join(root, "hive.json"), JSON.stringify({ repos: "nope" }));
    expect(() => load(root)).toThrow(/"repos" must be an array/);
  });

  it("reads a valid manifest", () => {
    writeFileSync(join(root, "hive.json"), JSON.stringify({ repos: ["acme/api"] }));
    expect(load(root).repos).toEqual(["acme/api"]);
  });
});
