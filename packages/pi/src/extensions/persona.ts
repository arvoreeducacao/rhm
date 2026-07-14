import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPersona, buildPersonaSection } from "@arvoretech/hub-core";
import { getSessionState } from "./session-state.js";

export function persona(pi: ExtensionAPI) {
  let personaContent: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    personaContent = null;
    const { pi: toggles } = getSessionState();
    if (!toggles?.persona) return;

    const data = await loadPersona(ctx.cwd);
    if (data) {
      personaContent = buildPersonaSection(data);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!personaContent) return;

    return {
      systemPrompt: event.systemPrompt + "\n" + personaContent,
    };
  });
}
