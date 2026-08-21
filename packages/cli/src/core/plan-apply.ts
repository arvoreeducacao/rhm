import chalk from "chalk";
import { applyPlan, type PlannedFile } from "@arvoretech/hub-core";

export { writeManagedFile, readSteeringInputs } from "@arvoretech/hub-core";

export async function applyPlannedFiles(hubDir: string, files: PlannedFile[]): Promise<void> {
  for (const path of await applyPlan(hubDir, files)) {
    console.log(chalk.green(`  Generated ${path}`));
  }
}
