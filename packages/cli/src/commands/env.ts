import { Command } from "commander";
import { existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadHubConfig, type SecretRef, type BuildDatabaseUrl } from "../core/hub-config.js";

const authenticatedProfiles = new Set<string>();

function awsAuthenticated(profile: string): boolean {
  if (authenticatedProfiles.has(profile)) return true;
  try {
    execSync(`AWS_PROFILE=${profile} aws sts get-caller-identity`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    authenticatedProfiles.add(profile);
    return true;
  } catch {
    return false;
  }
}

function fetchSecret(secretName: string, profile: string): Record<string, string> | null {
  try {
    const raw = execSync(
      `AWS_PROFILE=${profile} aws secretsmanager get-secret-value --secret-id "${secretName}" --query SecretString --output text`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveSecret(
  secretConfig: string | SecretRef,
  defaultProfile: string
): { secretName: string; profile: string } {
  if (typeof secretConfig === "string") {
    return { secretName: secretConfig, profile: defaultProfile };
  }
  return {
    secretName: secretConfig.secret,
    profile: secretConfig.profile || defaultProfile,
  };
}

function buildDatabaseUrlFromSecret(
  secretData: Record<string, string>,
  buildConfig: BuildDatabaseUrl
): string | null {
  const vars = buildConfig.vars || {};
  const user = secretData[vars.user || "DB_USERNAME"];
  const password = secretData[vars.password || "DB_PASSWORD"];
  const host = secretData[vars.host || "DB_HOSTNAME"];
  const port = secretData[vars.port || "DB_PORT"] || "3306";
  const database = secretData[vars.database || "DB_NAME"];

  if (!user || !host || !database) return null;

  if (buildConfig.template) {
    return buildConfig.template
      .replace("{user}", user)
      .replace("{password}", password || "")
      .replace("{host}", host)
      .replace("{port}", port)
      .replace("{database}", database);
  }

  return `mysql://${user}:${password || ""}@${host}:${port}/${database}`;
}

export const envCommand = new Command("env")
  .description("Generate environment files from hub.yaml profiles")
  .argument("[profile]", "Environment profile (local, staging, prod)", "local")
  .action(async (profile: string) => {
    const hubDir = process.cwd();
    const config = await loadHubConfig(hubDir);

    const profiles = config.env?.profiles;
    if (!profiles) {
      console.log(chalk.yellow("\nNo env.profiles defined in hub.yaml\n"));
      return;
    }

    const profileConfig = profiles[profile];
    if (!profileConfig) {
      const available = Object.keys(profiles).join(", ");
      console.log(chalk.red(`\nUnknown profile: ${profile}. Available: ${available}\n`));
      return;
    }

    console.log(chalk.blue(`\n━━━ Generating environment files (${profile}) ━━━\n`));

    const defaultAwsProfile = profileConfig.aws_profile || "";
    const secrets = profileConfig.secrets || {};
    const buildDbConfigs = profileConfig.build_database_url || {};

    if (profile !== "local" && defaultAwsProfile) {
      console.log(chalk.cyan(`  Default AWS profile: ${defaultAwsProfile}`));
      if (!awsAuthenticated(defaultAwsProfile)) {
        console.log(chalk.red(`  AWS profile ${defaultAwsProfile} not authenticated`));
        console.log(chalk.cyan(`  Run: aws sso login --profile ${defaultAwsProfile}`));
        return;
      }
      console.log(chalk.green(`  AWS authenticated`));
    }

    for (const repo of config.repos) {
      if (!repo.env_file) continue;

      const repoDir = join(hubDir, repo.path);
      if (!existsSync(repoDir)) {
        console.log(chalk.dim(`  ${repo.name}: repo not cloned, skipping`));
        continue;
      }

      console.log(chalk.yellow(`▸ ${repo.name}`));

      const envVars: Record<string, string> = {};

      if (profile !== "local" && secrets[repo.name]) {
        const { secretName, profile: secretProfile } = resolveSecret(
          secrets[repo.name],
          defaultAwsProfile
        );

        if (!secretProfile) {
          console.log(chalk.red(`  No AWS profile available for secret: ${secretName}`));
        } else {
          if (!awsAuthenticated(secretProfile)) {
            console.log(chalk.red(`  AWS profile ${secretProfile} not authenticated`));
            console.log(chalk.cyan(`  Run: aws sso login --profile ${secretProfile}`));
            continue;
          }

          console.log(chalk.cyan(`  Fetching: ${secretName} (profile: ${secretProfile})`));
          const secretData = fetchSecret(secretName, secretProfile);
          if (secretData) {
            Object.assign(envVars, secretData);
            console.log(chalk.green(`  Loaded ${Object.keys(secretData).length} vars from AWS`));
          } else {
            console.log(chalk.red(`  Failed to fetch secret: ${secretName}`));
          }
        }
      }

      if (profile !== "local" && buildDbConfigs[repo.name]) {
        const buildConfig = buildDbConfigs[repo.name];
        const dbProfile = buildConfig.profile || defaultAwsProfile;

        if (!dbProfile) {
          console.log(chalk.red(`  No AWS profile available for build_database_url`));
        } else {
          if (!awsAuthenticated(dbProfile)) {
            console.log(chalk.red(`  AWS profile ${dbProfile} not authenticated`));
            console.log(chalk.cyan(`  Run: aws sso login --profile ${dbProfile}`));
          } else {
            console.log(chalk.cyan(`  Building DATABASE_URL from ${buildConfig.from_secret} (profile: ${dbProfile})`));
            const dbSecretData = fetchSecret(buildConfig.from_secret, dbProfile);
            if (dbSecretData) {
              const dbUrl = buildDatabaseUrlFromSecret(dbSecretData, buildConfig);
              if (dbUrl) {
                envVars["DATABASE_URL"] = dbUrl;
                envVars["IDENTITY_DATABASE_URL"] = dbUrl;
                console.log(chalk.green(`  Built DATABASE_URL from ${buildConfig.from_secret}`));
              } else {
                console.log(chalk.red(`  Could not build DATABASE_URL - missing required fields`));
              }
            } else {
              console.log(chalk.red(`  Failed to fetch secret: ${buildConfig.from_secret}`));
            }
          }
        }
      }

      const overrides = config.env?.overrides?.[profile]?.[repo.name];
      if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
          envVars[key] = value;
        }
        console.log(chalk.cyan(`  Applied ${Object.keys(overrides).length} overrides`));
      }

      const envPath = join(repoDir, repo.env_file);

      const existingVars: Record<string, string> = {};
      try {
        const existing = await readFile(envPath, "utf-8");
        for (const line of existing.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            existingVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
          }
        }
      } catch {
        // file doesn't exist yet
      }

      const merged = { ...existingVars, ...envVars };
      const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
      await writeFile(envPath, lines.join("\n") + "\n", "utf-8");

      console.log(chalk.green(`  Created ${repo.env_file} (${lines.length} vars)`));
    }

    console.log();

    if (profile === "local") {
      console.log(chalk.cyan("Using local Docker services only"));
      console.log(chalk.cyan("Run: npx @arvoretech/hub services up"));
    } else if (profile === "prod") {
      console.log(chalk.red("WARNING: Using PRODUCTION database!"));
      console.log(chalk.red("Be careful with write operations!"));
    } else {
      console.log(chalk.cyan(`Using ${profile} environment`));
    }
    console.log();
  });
