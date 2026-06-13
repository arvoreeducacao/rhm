import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadHubConfig,
  resolvePiConfig,
  type HubConfig,
  type ResolvedPiConfig,
} from "@arvoretech/hub-core";

interface SessionState {
  hubDir: string;
  config: HubConfig | null;
  pi: ResolvedPiConfig | null;
  hasGeneratedOrchestrator: boolean;
}

const state: SessionState = {
  hubDir: "",
  config: null,
  pi: null,
  hasGeneratedOrchestrator: false,
};

export async function initSessionState(hubDir: string): Promise<SessionState> {
  state.hubDir = hubDir;
  state.config = null;
  state.pi = null;

  try {
    state.config = await loadHubConfig(hubDir);
    state.pi = resolvePiConfig(state.config);
  } catch {
    state.config = null;
    state.pi = null;
  }

  state.hasGeneratedOrchestrator =
    existsSync(join(hubDir, "AGENTS.md")) ||
    existsSync(join(hubDir, ".kiro", "steering", "orchestrator.md")) ||
    existsSync(join(hubDir, ".cursor", "rules", "orchestrator.mdc"));

  return state;
}

export function getSessionState(): SessionState {
  return state;
}

export function getConfig(): HubConfig | null {
  return state.config;
}

export function getPiToggles(): ResolvedPiConfig | null {
  return state.pi;
}
