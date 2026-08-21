import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HubConfig, PersonaData } from "./types.js";
import type { KiroMode } from "./cache.js";
import type { SteeringInput } from "./claude-code-plan.js";
import type { EditorPlan } from "./plan-types.js";
import type { KiroSteeringInput } from "./kiro-plan.js";
import { planClaudeCodeFiles } from "./claude-code-plan.js";
import { planCursorFiles } from "./cursor-plan.js";
import { planOpenCodeFiles } from "./opencode-plan.js";
import { planKiroFiles } from "./kiro-plan.js";
import { planCodexFiles } from "./codex-plan.js";
import { planPiFiles } from "./pi-plan.js";
import { loadPersona } from "./prompt-builders.js";

export const EDITOR_NAMES = ["claude-code", "cursor", "kiro", "opencode", "codex", "pi"] as const;
export type EditorName = (typeof EDITOR_NAMES)[number];

export function isEditorName(name: string): name is EditorName {
  return (EDITOR_NAMES as readonly string[]).includes(name);
}

export interface EditorInputs {
  steering: SteeringInput[];
  persona: PersonaData | null;
  kiroSteering?: KiroSteeringInput[];
  kiroMode?: KiroMode;
  existingMcpJson?: string | null;
  existingSettings?: Record<string, unknown> | null;
  /** Set when the editor cannot be planned as it stands — the host decides what to tell the user. */
  blocked?: string;
}

async function fileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function readSteeringInputs(hubDir: string): Promise<SteeringInput[]> {
  const steeringDir = resolve(hubDir, "steering");
  let names: string[];
  try {
    names = await readdir(steeringDir);
  } catch {
    return [];
  }

  const steering: SteeringInput[] = [];
  for (const name of names.filter((n) => n.endsWith(".md"))) {
    steering.push({ name, content: await readFile(join(steeringDir, name), "utf-8") });
  }
  return steering;
}

export async function gatherEditorInputs(
  hubDir: string,
  editor: EditorName,
  options: { kiroMode?: KiroMode } = {},
): Promise<EditorInputs> {
  const steering = await readSteeringInputs(hubDir);
  const persona = await loadPersona(hubDir).catch(() => null);
  const inputs: EditorInputs = { steering, persona };

  if (editor === "kiro") {
    inputs.kiroMode = options.kiroMode ?? "editor";
    inputs.existingMcpJson = await fileOrNull(join(hubDir, ".kiro", "settings", "mcp.json"));
    inputs.kiroSteering = [];
    for (const one of steering) {
      inputs.kiroSteering.push({ ...one, existingContent: await fileOrNull(join(hubDir, ".kiro", "steering", one.name)) });
    }
  }

  if (editor === "pi") {
    const raw = await fileOrNull(join(hubDir, ".pi", "settings.json"));
    if (raw === null) {
      inputs.existingSettings = null;
    } else {
      try {
        inputs.existingSettings = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        inputs.blocked = "the existing .pi/settings.json is not valid JSON";
      }
    }
  }

  return inputs;
}

export function planForEditor(config: HubConfig, editor: EditorName, inputs: EditorInputs): EditorPlan {
  const { steering, persona } = inputs;

  if (editor === "claude-code") return planClaudeCodeFiles(config, { steering, persona });
  if (editor === "cursor") return planCursorFiles(config, { steering, persona });
  if (editor === "opencode") return planOpenCodeFiles(config, { steering, persona });
  if (editor === "codex") return planCodexFiles(config);
  if (editor === "pi") return planPiFiles(config, { steering, existingSettings: inputs.existingSettings ?? null });
  return planKiroFiles(config, {
    steering: inputs.kiroSteering ?? [],
    persona,
    mode: inputs.kiroMode ?? "editor",
    existingMcpJson: inputs.existingMcpJson ?? null,
  });
}

export async function planEditor(
  hubDir: string,
  config: HubConfig,
  editor: EditorName,
  options: { kiroMode?: KiroMode } = {},
): Promise<EditorPlan & { blocked?: string }> {
  const inputs = await gatherEditorInputs(hubDir, editor, options);
  if (inputs.blocked) return { files: [], warnings: [], blocked: inputs.blocked };
  return planForEditor(config, editor, inputs);
}
