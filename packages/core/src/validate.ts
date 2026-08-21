import { Ajv, type ValidateFunction } from "ajv";
import hubSchema from "./hub-schema.json" with { type: "json" };
import type { HubConfig } from "./types.js";

export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ConfigIssue[];
}

let compiled: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
    compiled = ajv.compile(hubSchema);
  }
  return compiled;
}

export function validateHubConfig(raw: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(raw) as boolean;

  if (valid) return { valid: true, issues: [] };

  const issues: ConfigIssue[] = (validate.errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message:
      error.keyword === "additionalProperties"
        ? `unknown property "${(error.params as { additionalProperty?: string }).additionalProperty}"`
        : error.message ?? "invalid value",
  }));

  return { valid: false, issues };
}

export function assertValidHubConfig(raw: unknown): HubConfig {
  const result = validateHubConfig(raw);
  if (!result.valid) {
    const detail = result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
    throw new Error(`Invalid hub config:\n${detail}`);
  }
  return raw as HubConfig;
}
