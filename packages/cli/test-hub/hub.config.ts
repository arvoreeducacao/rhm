import { defineConfig, repo, mcp } from "@arvoretech/hub/config";

export default defineConfig({
  name: "test-hub",

  repos: [
  ],

  integrations: {
    github: { pr_branch_pattern: "{task_id}-{slug}" },
    slack: { channels: { prs: "#eng-prs" } },
  },

  workflow: {
    task_folder: "./tasks/{task_id}/",
    pipeline: [
          {
                "step": "refinement",
                "agent": "refinement",
                "output": "refinement.md"
          },
          {
                "step": "coding",
                "agents": [
                      "coding-backend",
                      "coding-frontend"
                ],
                "parallel": true
          },
          {
                "step": "review",
                "agent": "code-reviewer",
                "output": "code-review.md"
          },
          {
                "step": "deliver",
                "actions": [
                      "create-pr",
                      "notify-slack"
                ]
          }
    ],
  },
});
