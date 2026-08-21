import type { PlannedFile } from "./claude-code-plan.js";

export interface EditorPlan {
  files: PlannedFile[];
  warnings: string[];
}
