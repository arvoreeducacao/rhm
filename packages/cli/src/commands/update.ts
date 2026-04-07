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

function detectPackageManager(): "pnpm" | "yarn" | "npm" {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("npm")) return "npm";

  try {
    const binPath = execSync("which hub", { stdio: "pipe", encoding: "utf-8" }).trim();
    if (binPath.includes("/pnpm/")) return "pnpm";
    if (binPath.includes("/yarn/")) return "yarn";
  } catch { /* binary not found */ }

  try {
    const out = execSync(`pnpm list -g --depth=0 ${PACKAGE_NAME}`, { stdio: "pipe", encoding: "utf-8" });
    if (out.includes(PACKAGE_NAME)) return "pnpm";
  } catch { /* pnpm not available */ }

  try {
    const out = execSync(`yarn global list --depth=0`, { stdio: "pipe", encoding: "utf-8" });
    if (out.includes(PACKAGE_NAME)) return "yarn";
  } catch { /* yarn not available */ }

  return "npm";
}

function buildInstallCommand(pm: "pnpm" | "yarn" | "npm"): string {
  switch (pm) {
    case "pnpm":
      return `pnpm add -g ${PACKAGE_NAME}@latest`;
    case "yarn":
      return `yarn global add ${PACKAGE_NAME}@latest`;
    case "npm":
      return `npm install -g ${PACKAGE_NAME}@latest`;
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

    const pm = detectPackageManager();

    if (opts.check) {
      console.log(chalk.dim(`\n  Run 'hub update' or '${buildInstallCommand(pm)}' to update.\n`));
      return;
    }

    const installCmd = buildInstallCommand(pm);

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
