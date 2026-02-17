import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import chalk from "chalk";

const SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/arvoreeducacao/rhm/main/schemas/hub.schema.json\n";

const DEFAULT_HUB_CONFIG = {
  name: "",
  description: "",
  repos: [],
  services: [],
  mcps: [],
  integrations: {
    github: {
      pr_branch_pattern: "{linear_id}-{slug}",
    },
    slack: {
      channels: {
        prs: "#eng-prs",
      },
    },
  },
  workflow: {
    task_folder: "./tasks/{task_id}/",
    pipeline: [
      { step: "refinement", agent: "refinement", output: "refinement.md" },
      {
        step: "coding",
        agents: ["coding-backend", "coding-frontend"],
        parallel: true,
      },
      { step: "review", agent: "code-reviewer", output: "code-review.md" },
      {
        step: "qa",
        agents: ["qa-backend", "qa-frontend"],
        parallel: true,
        tools: ["playwright"],
      },
      {
        step: "deliver",
        actions: ["create-pr", "notify-slack"],
      },
    ],
  },
};

export const initCommand = new Command("init")
  .description("Initialize a new Repo Hub workspace")
  .argument("[name]", "Hub name", "my-hub")
  .action(async (name: string) => {
    const hubDir = join(process.cwd(), name);

    console.log(chalk.blue(`\nInitializing Repo Hub: ${name}\n`));

    await mkdir(hubDir, { recursive: true });
    await mkdir(join(hubDir, "tasks"), { recursive: true });

    const config = { ...DEFAULT_HUB_CONFIG, name };
    await writeFile(
      join(hubDir, "hub.yaml"),
      SCHEMA_COMMENT + stringify(config),
      "utf-8",
    );

    const gitignore = [
      "node_modules/",
      ".DS_Store",
      "",
      "# Repositories (managed by hub)",
      "# Add repos here as you add them with: hub add-repo",
      "",
      "# Docker volumes",
      "*_data/",
      "",
      "# Environment files",
      "*.env",
      "*.env.local",
      "!.env.example",
      "",
      "# Task documents",
      "tasks/",
      "",
    ].join("\n");
    await writeFile(join(hubDir, ".gitignore"), gitignore, "utf-8");

    const readme = [
      `# ${name}`,
      "",
      `Powered by [Repo Hub](https://github.com/arvoreeducacao/rhm).`,
      "",
      "## Getting Started",
      "",
      "```bash",
      "# Add repositories",
      "npx @arvoretech/hub add-repo git@github.com:org/api.git",
      "npx @arvoretech/hub add-repo git@github.com:org/frontend.git",
      "",
      "# Setup workspace",
      "npx @arvoretech/hub setup",
      "",
      "# Generate editor configs",
      "npx @arvoretech/hub generate --editor cursor",
      "```",
      "",
    ].join("\n");
    await writeFile(join(hubDir, "README.md"), readme, "utf-8");

    console.log(chalk.green("  Created hub.yaml"));
    console.log(chalk.green("  Created .gitignore"));
    console.log(chalk.green("  Created README.md"));
    console.log();
    console.log(chalk.cyan("Next steps:"));
    console.log(`  cd ${name}`);
    console.log("  npx @arvoretech/hub add-repo <git-url>");
    console.log("  npx @arvoretech/hub setup");
    console.log("  npx @arvoretech/hub generate --editor cursor");
    console.log();
  });
