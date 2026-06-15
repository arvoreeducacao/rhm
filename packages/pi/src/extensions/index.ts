import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initSessionState } from "./session-state.js";
import { hubRuntime } from "./hub-runtime.js";
import { mcpWiring } from "./mcp-wiring.js";
import { repoTools } from "./repo-tools.js";
import { persona } from "./persona.js";
import { delivery } from "./delivery.js";
import { hooks } from "./hooks.js";
import { onboarding } from "./onboarding.js";
import { header } from "./header.js";

export default function hubPiPackage(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await initSessionState(ctx.cwd);
  });

  hubRuntime(pi);
  mcpWiring(pi);
  repoTools(pi);
  persona(pi);
  delivery(pi);
  hooks(pi);
  onboarding(pi);
  header(pi);
}
