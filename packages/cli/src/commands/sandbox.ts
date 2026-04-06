import { Command } from "commander";
import { execSync, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";
import { generateDockerCompose } from "../core/docker-compose.js";

const execAsync = promisify(exec);

const SANDBOX_IMAGE = "ghcr.io/agent-infra/sandbox:latest";

function getSandboxConfig(config: Awaited<ReturnType<typeof loadHubConfig>>) {
  return config.services?.find((s) => s.type === "sandbox") ?? null;
}

async function ensureComposeFile(hubDir: string): Promise<string> {
  const composePath = join(hubDir, "docker-compose.yml");
  if (!existsSync(composePath)) {
    const config = await loadHubConfig(hubDir);
    const content = generateDockerCompose(config.services ?? [], hubDir);
    await writeFile(composePath, content, "utf-8");
  }
  return composePath;
}

function isDockerRunning(): boolean {
  try {
    execSync("docker info", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

async function isSandboxRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect --format='{{.State.Running}}' ${name} 2>/dev/null`);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export const sandboxCommand = new Command("sandbox")
  .description("Manage the AIO Sandbox environment")
  .argument("[action]", "up, down, status, open, logs", "status")
  .action(async (action: string) => {
    if (!isDockerRunning()) {
      console.log(chalk.red("\nDocker daemon is not running."));
      console.log(chalk.dim("Start Docker Desktop or the Docker daemon and try again.\n"));
      return;
    }

    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);
    const svc = getSandboxConfig(config);

    if (!svc) {
      console.log(chalk.red("\nNo sandbox service found in hub.yaml."));
      console.log(chalk.dim("Add a service with type: sandbox to your hub.yaml:\n"));
      console.log(chalk.dim("  services:"));
      console.log(chalk.dim("    - name: sandbox"));
      console.log(chalk.dim("      type: sandbox"));
      console.log(chalk.dim("      port: 8080\n"));
      return;
    }

    const port = svc.port ?? 8080;
    const name = svc.name;

    switch (action) {
      case "up":
      case "start": {
        const running = await isSandboxRunning(name);
        if (running) {
          console.log(chalk.yellow(`\nSandbox is already running.`));
          printUrls(port);
          return;
        }
        console.log(chalk.blue(`\nStarting sandbox...\n`));
        const composePath = await ensureComposeFile(hubDir);
        execSync(`docker compose -f ${composePath} up -d ${name}`, { stdio: "inherit", cwd: hubDir });
        console.log(chalk.green("\nSandbox started."));
        printUrls(port);
        break;
      }

      case "down":
      case "stop": {
        console.log(chalk.blue(`\nStopping sandbox...\n`));
        const composePath = await ensureComposeFile(hubDir);
        execSync(`docker compose -f ${composePath} stop ${name}`, { stdio: "inherit", cwd: hubDir });
        console.log(chalk.green("\nSandbox stopped.\n"));
        break;
      }

      case "logs": {
        const composePath = await ensureComposeFile(hubDir);
        execSync(`docker compose -f ${composePath} logs -f ${name}`, { stdio: "inherit", cwd: hubDir });
        break;
      }

      case "open": {
        const running = await isSandboxRunning(name);
        if (!running) {
          console.log(chalk.red("\nSandbox is not running. Start it first with: hub sandbox up\n"));
          return;
        }
        const url = `http://localhost:${port}/code-server/`;
        console.log(chalk.blue(`\nOpening VSCode Server at ${url}\n`));
        execSync(`open "${url}"`, { stdio: "inherit" });
        break;
      }

      case "status":
      default: {
        const running = await isSandboxRunning(name);
        if (running) {
          console.log(chalk.green(`\nSandbox is running.`));
          printUrls(port);
        } else {
          console.log(chalk.yellow(`\nSandbox is not running.`));
          console.log(chalk.dim(`  Start it with: hub sandbox up\n`));
        }
        break;
      }
    }
  });

function printUrls(port: number): void {
  console.log();
  console.log(chalk.dim(`  MCP:     `) + chalk.cyan(`http://localhost:${port}/mcp`));
  console.log(chalk.dim(`  VSCode:  `) + chalk.cyan(`http://localhost:${port}/code-server/`));
  console.log(chalk.dim(`  Browser: `) + chalk.cyan(`http://localhost:${port}/vnc/index.html?autoconnect=true`));
  console.log(chalk.dim(`  Docs:    `) + chalk.cyan(`http://localhost:${port}/v1/docs`));
  console.log();
}
