import chalk from "chalk";
import { checkOutdated, loadHubConfig, saveGenerateState } from "@arvoretech/hub-core";

export async function checkAndAutoRegenerate(hubDir: string): Promise<void> {
  try {
    const result = await checkOutdated(hubDir);

    if (!result.outdated) return;

    if (!result.editor) {
      console.log(
        chalk.yellow(
          "\n  Configs are outdated. Run 'hub generate' to regenerate.\n"
        )
      );
      return;
    }

    console.log(chalk.yellow("\n  Detected outdated configs, auto-regenerating..."));

    const { generators } = await import("../commands/generate.js");
    const generator = generators[result.editor];
    if (!generator) {
      console.log(chalk.red(`  Unknown editor '${result.editor}' in cache. Run 'hub generate' manually.`));
      return;
    }

    const config = await loadHubConfig(hubDir);
    await generator.generate(config, hubDir);
    await saveGenerateState(hubDir, result.editor);

    console.log(chalk.green("  Auto-regeneration complete!\n"));
  } catch (err) {
    console.log(chalk.yellow(`  Auto-regeneration failed: ${(err as Error).message}`));
    console.log(chalk.dim("  Run 'hub generate' manually to fix.\n"));
  }
}
