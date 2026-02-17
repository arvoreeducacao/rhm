import { Command } from "commander";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const PACKAGE_NAME = "@arvoretech/hub";

function getCurrentVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

async function getLatestVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
  const data = (await res.json()) as { version: string };
  return data.version;
}

function detectPackageManager(): "pnpm" | "npm" | "yarn" {
  try {
    execSync("pnpm --version", { stdio: "pipe" });
    return "pnpm";
  } catch {
    try {
      execSync("yarn --version", { stdio: "pipe" });
      return "yarn";
    } catch {
      return "npm";
    }
  }
}

export const updateCommand = new Command("update")
  .description("Update hub CLI to the latest version")
  .option("--check", "Only check for updates without installing")
  .action(async (opts: { check?: boolean }) => {
    const currentVersion = getCurrentVersion();
    console.log(chalk.blue(`\n  Current version: ${currentVersion}`));

    let latestVersion: string;
    try {
      latestVersion = await getLatestVersion();
    } catch (err) {
      console.log(chalk.red(`  Failed to check for updates: ${(err as Error).message}\n`));
      return;
    }

    console.log(chalk.blue(`  Latest version:  ${latestVersion}`));

    if (currentVersion === latestVersion) {
      console.log(chalk.green("\n  You're already on the latest version.\n"));
      return;
    }

    console.log(chalk.yellow(`\n  Update available: ${currentVersion} → ${latestVersion}`));

    if (opts.check) {
      const pm = detectPackageManager();
      console.log(chalk.dim(`\n  Run 'hub update' or '${pm} install -g ${PACKAGE_NAME}@latest' to update.\n`));
      return;
    }

    const pm = detectPackageManager();
    const installCmd =
      pm === "pnpm"
        ? `pnpm install -g ${PACKAGE_NAME}@latest`
        : pm === "yarn"
          ? `yarn global add ${PACKAGE_NAME}@latest`
          : `npm install -g ${PACKAGE_NAME}@latest`;

    console.log(chalk.cyan(`\n  Updating with ${pm}...\n`));
    console.log(chalk.dim(`  $ ${installCmd}\n`));

    try {
      execSync(installCmd, { stdio: "inherit" });
      console.log(chalk.green(`\n  Updated to ${latestVersion} successfully.\n`));
    } catch {
      console.log(chalk.red(`\n  Update failed. Try running manually:`));
      console.log(chalk.dim(`  $ ${installCmd}\n`));
    }
  });
