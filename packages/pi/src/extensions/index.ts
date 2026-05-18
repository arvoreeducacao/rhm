import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hubRuntime } from "./hub-runtime.js";
import { mcpWiring } from "./mcp-wiring.js";
import { repoTools } from "./repo-tools.js";
import { persona } from "./persona.js";
import { workflowEngine } from "./workflow-engine.js";
import { delivery } from "./delivery.js";
import { hooks } from "./hooks.js";
import { onboarding } from "./onboarding.js";
import { header } from "./header.js";

export default function hubPiPackage(pi: ExtensionAPI) {
  hubRuntime(pi);
  mcpWiring(pi);
  repoTools(pi);
  persona(pi);
  workflowEngine(pi);
  delivery(pi);
  hooks(pi);
  onboarding(pi);
  header(pi);
}
