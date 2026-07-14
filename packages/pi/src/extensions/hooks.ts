import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type HookEntry } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

type PiEvent = "tool_call" | "tool_result" | "agent_end" | "turn_end";

const HUB_TO_PI_EVENT: Record<string, PiEvent> = {
  pre_tool_use: "tool_call",
  post_tool_use: "tool_result",
  after_file_edit: "tool_result",
  stop: "agent_end",
};

function interpolateVars(command: string, vars: Record<string, string>): string {
  let result = command;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\$${key}`, "g"), value);
  }
  return result;
}

export function hooks(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    const { config, pi: toggles } = getSessionState();
    if (!config || !toggles) return;
    if (!toggles.hooks) return;
    if (!config.hooks) return;

    for (const [event, entries] of Object.entries(config.hooks)) {
      const piEvent = HUB_TO_PI_EVENT[event];
      if (!piEvent) continue;

      registerHookHandlers(pi, piEvent, event, entries);
    }
  });
}

function registerHookHandlers(
  pi: ExtensionAPI,
  piEvent: PiEvent,
  _hubEvent: string,
  entries: HookEntry[]
) {
  pi.on(piEvent as "tool_call", async (event: Record<string, unknown>) => {
    const vars: Record<string, string> = {
      TOOL_NAME: (event?.toolName as string) || (event?.name as string) || "",
      FILE_PATH: (event?.filePath as string) || (event?.path as string) || "",
      REPO_NAME: "",
      STEP_NAME: "",
      TASK_ID: "",
    };

    for (const entry of entries) {
      if (entry.matcher) {
        const toolName = vars.TOOL_NAME;
        if (toolName && !toolName.match(new RegExp(entry.matcher))) {
          continue;
        }
      }

      if (entry.type === "command" && entry.command) {
        const cmd = interpolateVars(entry.command, vars);
        try {
          execSync(cmd, {
            encoding: "utf-8",
            timeout: entry.timeout_ms || 10_000,
            stdio: "pipe",
          });
        } catch {
          // hook failures are non-fatal
        }
      }
    }
  });
}
