import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findHubRoot } from "./config.js";

describe("findHubRoot", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("walks up from a nested directory to the hub root", () => {
    dir = mkdtempSync(join(tmpdir(), "hub-root-"));
    writeFileSync(join(dir, "hub.yaml"), "name: x\nrepos: []\n");
    const nested = join(dir, "api", "src", "deep");
    mkdirSync(nested, { recursive: true });

    expect(findHubRoot(nested)).toBe(dir);
    expect(findHubRoot(dir)).toBe(dir);
  });

  it("returns null when no hub config exists upward", () => {
    dir = mkdtempSync(join(tmpdir(), "no-hub-"));
    expect(findHubRoot(dir)).toBeNull();
  });
});
