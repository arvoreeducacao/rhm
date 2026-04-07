import { Command } from "commander";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

function bumpVersion(current: string, type: "patch" | "minor" | "major"): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function findRepoRoot(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = join(__dirname, "..");
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function buildReleaseMdx(version: string, title: string, description: string, date: string): string {
  return `---
title: "v${version} — ${title}"
version: "${version}"
date: "${date}"
description: "${description}"
---

TODO: Write release notes here.
`;
}

function buildReleaseEntry(version: string, title: string, description: string, date: string): string {
  const slug = version.replace(/\./g, "-");
  return `  {
    version: "${version}",
    date: "${date}",
    title: "${title}",
    slug: "${slug}",
    summary: "${description}",
    changes: [],
  },`;
}

function updateReleasesTs(releasesPath: string, entry: string): void {
  const content = readFileSync(releasesPath, "utf-8");
  const marker = "export const releases: Release[] = [";
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error("Could not find releases array in releases.ts");
  const insertAt = idx + marker.length;
  const updated = content.slice(0, insertAt) + "\n" + entry + content.slice(insertAt);
  writeFileSync(releasesPath, updated);
}

function updatePackageJsonVersion(pkgPath: string, newVersion: string): void {
  const content = JSON.parse(readFileSync(pkgPath, "utf-8"));
  content.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(content, null, 2) + "\n");
}

export const updateCommand = new Command("update")
  .description("Update hub CLI to the latest version, or release a new version")
  .option("--check", "Only check for updates without installing")
  .option("--release <type>", "Create a new release (patch, minor, major)")
  .option("--title <title>", "Release title")
  .option("--description <desc>", "Release description")
  .action(async (opts: { check?: boolean; release?: string; title?: string; description?: string }) => {
    if (opts.release) {
      await handleRelease(opts);
      return;
    }

    await handleUpdate(opts);
  });

async function handleUpdate(opts: { check?: boolean }) {
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
}

async function handleRelease(opts: { release?: string; title?: string; description?: string }) {
  const type = opts.release as "patch" | "minor" | "major";
  if (!["patch", "minor", "major"].includes(type)) {
    console.log(chalk.red(`\n  Invalid release type: ${type}. Use patch, minor, or major.\n`));
    return;
  }

  const repoRoot = findRepoRoot();
  const cliPkgPath = join(repoRoot, "packages", "cli", "package.json");

  if (!existsSync(cliPkgPath)) {
    console.log(chalk.red(`\n  Could not find ${cliPkgPath}. Are you in the rhm repo?\n`));
    return;
  }

  const currentPkg = JSON.parse(readFileSync(cliPkgPath, "utf-8"));
  const currentVersion = currentPkg.version;
  const newVersion = bumpVersion(currentVersion, type);
  const title = opts.title ?? `v${newVersion}`;
  const description = opts.description ?? "";
  const date = new Date().toISOString().split("T")[0];
  const slug = newVersion.replace(/\./g, "-");
  const branchName = `release/${newVersion}`;

  console.log(chalk.blue(`\n  Current version: ${currentVersion}`));
  console.log(chalk.blue(`  New version:     ${newVersion}`));
  console.log(chalk.blue(`  Release type:    ${type}`));
  console.log(chalk.blue(`  Branch:          ${branchName}\n`));

  console.log(chalk.cyan("  Bumping version..."));
  updatePackageJsonVersion(cliPkgPath, newVersion);

  const releaseMdxPath = join(repoRoot, "website", "src", "content", "releases", `${slug}.mdx`);
  console.log(chalk.cyan("  Creating release MDX..."));
  writeFileSync(releaseMdxPath, buildReleaseMdx(newVersion, title, description, date));

  const releasesTsPath = join(repoRoot, "website", "src", "data", "releases.ts");
  console.log(chalk.cyan("  Updating releases.ts..."));
  const entry = buildReleaseEntry(newVersion, title, description, date);
  updateReleasesTs(releasesTsPath, entry);

  console.log(chalk.cyan("  Creating branch and committing..."));
  try {
    execSync(`git checkout -b ${branchName}`, { cwd: repoRoot, stdio: "pipe" });
    execSync("git add -A", { cwd: repoRoot, stdio: "pipe" });
    execSync(`git commit -m "release: v${newVersion}"`, { cwd: repoRoot, stdio: "pipe" });
    execSync(`git push origin ${branchName}`, { cwd: repoRoot, stdio: "pipe" });

    console.log(chalk.cyan("  Opening PR..."));
    const prUrl = execSync(
      `gh pr create --title "release: v${newVersion} — ${title}" --body "Release v${newVersion}\n\n${description}" --base main --head ${branchName}`,
      { cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    console.log(chalk.green(`\n  Release v${newVersion} ready.`));
    console.log(chalk.green(`  PR: ${prUrl}\n`));
  } catch (err) {
    console.log(chalk.red(`\n  Git/PR step failed: ${(err as Error).message}`));
    console.log(chalk.dim("  Files were updated. You can commit and push manually.\n"));
  }
}
