import { afterEach, describe, expect, it } from "vitest";
import type { MCPConfig } from "@arvoretech/hub-core";
import { buildEntry, buildOAuthBlock } from "./mcp-wiring.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("buildOAuthBlock", () => {
  it("resolves env refs in clientId and clientSecret", () => {
    process.env.BACKOFFICE_MCP_CLIENT_SECRET = "super-secret";
    const oauth = buildOAuthBlock({
      type: "oauth",
      clientId: "backoffice-mcp-claude",
      clientSecret: "${env:BACKOFFICE_MCP_CLIENT_SECRET}",
      scope: "openid profile email",
    });
    expect(oauth).toEqual({
      clientId: "backoffice-mcp-claude",
      clientSecret: "super-secret",
      scope: "openid profile email",
    });
  });

  it("supports plain ${VAR} refs too", () => {
    process.env.MY_SECRET = "abc";
    const oauth = buildOAuthBlock({
      type: "oauth",
      clientSecret: "${MY_SECRET}",
    });
    expect(oauth).toEqual({ clientSecret: "abc" });
  });

  it("passes through optional fields", () => {
    const oauth = buildOAuthBlock({
      type: "oauth",
      clientId: "id",
      grantType: "client_credentials",
      redirectUri: "http://localhost:19876/callback",
      clientName: "Pi",
      clientUri: "https://example.com",
    });
    expect(oauth).toEqual({
      clientId: "id",
      grantType: "client_credentials",
      redirectUri: "http://localhost:19876/callback",
      clientName: "Pi",
      clientUri: "https://example.com",
    });
  });

  it("returns undefined when no fields are set", () => {
    expect(buildOAuthBlock({ type: "oauth" })).toBeUndefined();
  });
});

describe("buildEntry", () => {
  it("emits auth string and a resolved oauth block for object auth", () => {
    process.env.BACKOFFICE_MCP_CLIENT_SECRET = "super-secret";
    const mcp: MCPConfig = {
      name: "backoffice",
      url: "https://backoffice-mcp.arvore.com.br/mcp",
      auth: {
        type: "oauth",
        clientId: "backoffice-mcp-claude",
        clientSecret: "${env:BACKOFFICE_MCP_CLIENT_SECRET}",
        scope: "openid profile email",
      },
    };
    expect(buildEntry(mcp)).toEqual({
      url: "https://backoffice-mcp.arvore.com.br/mcp",
      auth: "oauth",
      oauth: {
        clientId: "backoffice-mcp-claude",
        clientSecret: "super-secret",
        scope: "openid profile email",
      },
    });
  });

  it("keeps string auth untouched with no oauth block", () => {
    const mcp: MCPConfig = {
      name: "linear",
      url: "https://mcp.linear.app/mcp",
      auth: "oauth",
    };
    const entry = buildEntry(mcp);
    expect(entry.auth).toBe("oauth");
    expect(entry.oauth).toBeUndefined();
  });
});
