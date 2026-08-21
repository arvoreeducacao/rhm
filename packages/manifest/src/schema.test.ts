import { describe, it, expect } from "vitest";
import { schema, schemaWith } from "./schema.js";

describe("schema", () => {
  it("requires repos and rejects unknown top-level keys", () => {
    expect(schema.required).toEqual(["repos"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("carries an absolute $id, so a host can serve it", () => {
    expect(schema.$id).toMatch(/^https:\/\//);
  });
});

describe("schemaWith", () => {
  it("constrains skill names to the ones available", () => {
    const built = schemaWith({ skills: ["delivery", "qa"] });
    expect(built.properties.skills).toMatchObject({
      propertyNames: { enum: ["delivery", "qa"] },
    });
  });

  it("leaves a map open when nothing is available", () => {
    const built = schemaWith({ skills: [] });
    expect(built.properties.skills).not.toHaveProperty("propertyNames");
  });

  it("does not mutate the exported schema", () => {
    schemaWith({ skills: ["delivery"], mcps: ["context7"] });
    expect(schema.properties.skills).not.toHaveProperty("propertyNames");
  });
});
