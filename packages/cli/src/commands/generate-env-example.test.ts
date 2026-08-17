import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubConfig } from "../core/hub-config.js";
import { generateEnvExample } from "./env-example.js";

describe("generateEnvExample", () => {
  let hubDir: string;

  beforeEach(async () => {
    hubDir = await mkdtemp(join(tmpdir(), "hub-env-example-"));
  });

  afterEach(async () => {
    await rm(hubDir, { recursive: true, force: true });
  });

  const readExample = () => readFile(join(hubDir, ".env.example"), "utf-8");

  const baseConfig = (overrides: Partial<HubConfig>): HubConfig => ({
    name: "test-hub",
    repos: [],
    ...overrides,
  });

  it("emits example_extras as named groups", async () => {
    const config = baseConfig({
      env: {
        example_extras: {
          scripts: ["REPORTS_API_TOKEN"],
          e2e: ["SMOKE_TEST_USER", "SMOKE_TEST_PASSWORD"],
        },
      },
    });

    await generateEnvExample(config, hubDir);

    expect(await readExample()).toBe(
      [
        "# scripts",
        "REPORTS_API_TOKEN=",
        "",
        "# e2e",
        "SMOKE_TEST_PASSWORD=",
        "SMOKE_TEST_USER=",
        "",
      ].join("\n")
    );
  });

  it("appends extras after MCP groups and dedupes vars already emitted", async () => {
    const config = baseConfig({
      mcps: [
        {
          name: "analytics",
          package: "@example/analytics-mcp",
          env: { ANALYTICS_API_KEY: "${env:ANALYTICS_API_KEY}" },
        },
      ],
      env: {
        example_extras: {
          scripts: ["ANALYTICS_API_KEY", "REPORTS_API_TOKEN"],
        },
      },
    });

    await generateEnvExample(config, hubDir);

    expect(await readExample()).toBe(
      [
        "# analytics",
        "ANALYTICS_API_KEY=",
        "",
        "# scripts",
        "REPORTS_API_TOKEN=",
        "",
      ].join("\n")
    );
  });

  it("writes nothing when there are no vars at all", async () => {
    await generateEnvExample(baseConfig({}), hubDir);

    await expect(readExample()).rejects.toThrow();
  });
});
