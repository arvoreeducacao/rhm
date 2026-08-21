import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateHubConfig, assertValidHubConfig } from "./validate.js";
import embeddedSchema from "./hub-schema.json";

describe("validateHubConfig", () => {
  it("accepts a minimal valid config", () => {
    const result = validateHubConfig({
      name: "my-hub",
      repos: [{ name: "api", path: "./api", url: "git@github.com:org/api.git" }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts the newer MCP fields (headers, auth, lifecycle, directTools)", () => {
    const result = validateHubConfig({
      name: "my-hub",
      repos: [{ name: "api", path: "./api", url: "git@github.com:org/api.git" }],
      mcps: [
        {
          name: "remote",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer ${env:TOKEN}" },
          auth: { type: "oauth", clientId: "abc" },
          lifecycle: "lazy",
          idleTimeout: 300,
          directTools: ["search"],
          excludeTools: ["dangerous"],
        },
      ],
      env: { example_extras: { scripts: ["REPORTS_API_TOKEN"] } },
    });

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a config missing required fields", () => {
    const result = validateHubConfig({ repos: [] });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("name"))).toBe(true);
  });

  it("points at unknown properties", () => {
    const result = validateHubConfig({
      name: "my-hub",
      repos: [{ name: "api", path: "./api", url: "x", typo_field: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("typo_field"))).toBe(true);
  });

  it("assertValidHubConfig throws with the issues in the message", () => {
    expect(() => assertValidHubConfig({ repos: [] })).toThrow(/Invalid hub config/);
  });
});

describe("embedded schema", () => {
  it("matches the canonical schemas/hub.schema.json", () => {
    const canonicalPath = fileURLToPath(new URL("../../../schemas/hub.schema.json", import.meta.url));
    const canonical = JSON.parse(readFileSync(canonicalPath, "utf-8"));

    expect(embeddedSchema).toEqual(canonical);
  });
});
