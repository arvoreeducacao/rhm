import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  files?: string[];
  pi?: { extensions?: string[] };
  scripts?: Record<string, string>;
}

describe("package manifest", () => {
  it("ships the bundled extension entry", async () => {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf-8")) as PackageManifest;

    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.pi?.extensions).toEqual(["./dist/index.js"]);
    expect(manifest.scripts?.build).toContain("src/extensions/index.ts");
    expect(manifest.scripts?.prepack).toBe("pnpm build");
  });
});
