import { Command } from "commander";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig } from "../core/hub-config.js";
import { generateDockerCompose } from "../core/docker-compose.js";

async function ensureCompose(hubDir: string): Promise<string> {
  const composePath = join(hubDir, "docker-compose.yml");

  if (!existsSync(composePath)) {
    const config = await loadHubConfig(hubDir);
    if (!config.services?.length) {
      console.log(chalk.yellow("No services defined in hub.yaml"));
      process.exit(1);
    }
    const content = generateDockerCompose(config.services, hubDir);
    await writeFile(composePath, content, "utf-8");
    console.log(chalk.green("Generated docker-compose.yml"));
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

export const servicesCommand = new Command("services")
  .description("Manage Docker development services")
  .argument("[action]", "up, down, restart, ps, logs, clean", "up")
  .argument("[service...]", "Specific services (for logs)")
  .action(async (action: string, serviceNames: string[]) => {
    if (!isDockerRunning()) {
      console.log(chalk.red("\nDocker daemon is not running."));
      console.log(chalk.dim("Start Docker Desktop or the Docker daemon and try again.\n"));
      return;
    }

    const hubDir = process.cwd();
    const composePath = await ensureCompose(hubDir);
    const compose = `docker compose -f ${composePath}`;

    try {
      switch (action) {
        case "up":
        case "start": {
          console.log(chalk.blue("\nStarting services\n"));
          execSync(`${compose} up -d`, { stdio: "inherit", cwd: hubDir });

          const config = await loadHubConfig(hubDir);
          console.log(chalk.green("\nServices running:"));
          for (const svc of config.services || []) {
            const port = svc.port || svc.ports?.[0];
            if (port) console.log(chalk.cyan(`  ${svc.name}: localhost:${port}`));
          }
          console.log();
          break;
        }
        case "down":
        case "stop":
          console.log(chalk.blue("\nStopping services\n"));
          execSync(`${compose} down`, { stdio: "inherit", cwd: hubDir });
          console.log(chalk.green("\nServices stopped\n"));
          break;

        case "restart":
          execSync(`${compose} restart`, { stdio: "inherit", cwd: hubDir });
          console.log(chalk.green("\nServices restarted\n"));
          break;

        case "ps":
        case "status":
          execSync(`${compose} ps`, { stdio: "inherit", cwd: hubDir });
          break;

        case "logs":
          if (serviceNames.length) {
            execSync(`${compose} logs -f ${serviceNames.join(" ")}`, { stdio: "inherit", cwd: hubDir });
          } else {
            execSync(`${compose} logs -f`, { stdio: "inherit", cwd: hubDir });
          }
          break;

        case "clean":
          console.log(chalk.blue("\nCleaning services (removing volumes)\n"));
          execSync(`${compose} down -v`, { stdio: "inherit", cwd: hubDir });
          console.log(chalk.green("\nServices and volumes removed\n"));
          break;

        default:
          console.log(chalk.red(`Unknown action: ${action}`));
          console.log("Usage: hub services [up|down|restart|ps|logs|clean]");
          process.exit(1);
      }
    } catch {
      console.log(chalk.red("\nFailed to execute docker compose command."));
      console.log(chalk.dim("Check if Docker is running and the docker-compose.yml is valid.\n"));
    }
  });
