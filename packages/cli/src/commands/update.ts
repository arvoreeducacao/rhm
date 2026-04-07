import { Command } from "commander";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import ora from "ora";

const PACKAGE_NAME = "@arvoretech/hub";
const RELEASES_URL = "https://hub.arvore.com.br/api/releases.json";

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

interface ReleaseChange {
  type: "feat" | "fix" | "refactor" | "chore";
  title: string;
  description: string;
}

interface Release {
  version: string;
  date: string;
  title: string;
  slug: string;
  summary: string;
  changes: ReleaseChange[];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function getReleasesBetween(from: string, to: string): Promise<Release[]> {
  try {
    const res = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const releases = (await res.json()) as Release[];
    return releases
      .filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0)
      .sort((a, b) => compareVersions(a.version, b.version));
  } catch {
    return [];
  }
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
  } catch {}

  try {
    const out = execSync(`pnpm list -g --depth=0 ${PACKAGE_NAME}`, { stdio: "pipe", encoding: "utf-8" });
    if (out.includes(PACKAGE_NAME)) return "pnpm";
  } catch {}

  try {
    const out = execSync(`yarn global list --depth=0`, { stdio: "pipe", encoding: "utf-8" });
    if (out.includes(PACKAGE_NAME)) return "yarn";
  } catch {}

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

const typeColors: Record<string, (s: string) => string> = {
  feat: chalk.green,
  fix: chalk.yellow,
  refactor: chalk.magenta,
  chore: chalk.dim,
};

function formatChangeType(type: string): string {
  const color = typeColors[type] ?? chalk.dim;
  return color(type.toUpperCase().padEnd(8));
}

export const updateCommand = new Command("update")
  .description("Update hub CLI to the latest version")
  .option("--check", "Only check for updates without installing")
  .action(async (opts: { check?: boolean }) => {
    const currentVersion = getCurrentVersion();

    const checkSpinner = ora({ text: "Checking for updates...", color: "cyan" }).start();

    let latestVersion: string;
    try {
      latestVersion = await getLatestVersion();
    } catch (err) {
      checkSpinner.fail(`Failed to check for updates: ${(err as Error).message}`);
      return;
    }

    if (currentVersion === latestVersion) {
      checkSpinner.succeed(chalk.green(`Already on the latest version (${currentVersion})`));
      return;
    }

    checkSpinner.succeed(`Update available: ${chalk.dim(currentVersion)} → ${chalk.green(latestVersion)}`);

    const releases = await getReleasesBetween(currentVersion, latestVersion);

    if (releases.length > 0) {
      console.log();
      console.log(chalk.cyan("  Releases included:"));

      for (const release of releases) {
        const date = new Date(release.date + "T00:00:00").toLocaleDateString("pt-BR");
        console.log();
        console.log(`  ${chalk.green("●")} ${chalk.white.bold(`v${release.version}`)} ${chalk.dim(`— ${release.title}`)} ${chalk.dim(`(${date})`)}`);

        for (const change of release.changes) {
          console.log(`    ${formatChangeType(change.type)} ${chalk.dim(change.title)}`);
        }
      }

      console.log();
      console.log(chalk.dim(`  Full notes: https://hub.arvore.com.br/releases`));
    }

    const pm = detectPackageManager();

    if (opts.check) {
      console.log(chalk.dim(`\n  Run 'hub update' to install.\n`));
      return;
    }

    console.log();
    const installSpinner = ora({ text: `Updating with ${pm}...`, color: "cyan" }).start();

    try {
      execSync(buildInstallCommand(pm), { stdio: "pipe" });
      installSpinner.succeed(chalk.green(`Updated to ${latestVersion}`));
    } catch {
      installSpinner.fail("Update failed");
      console.log(chalk.dim(`  Try running manually: ${buildInstallCommand(pm)}\n`));
    }
  });
