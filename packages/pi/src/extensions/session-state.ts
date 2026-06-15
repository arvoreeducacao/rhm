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
}

const state: SessionState = {
  hubDir: "",
  config: null,
  pi: null,
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
