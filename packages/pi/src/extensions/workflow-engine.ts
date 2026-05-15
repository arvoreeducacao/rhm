import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadHubConfig, type HubConfig, type WorkflowStep } from "@arvoretech/hub-core";

const PIPELINE_ENTRY_TYPE = "hub:pipeline";

interface StepState {
  name: string;
  status: "pending" | "active" | "completed" | "skipped" | "failed";
  startedAt?: number;
  completedAt?: number;
}

interface PipelineState {
  taskId: string;
  taskDescription: string;
  currentStep: number;
  steps: StepState[];
  startedAt: number;
}

function createPipelineState(taskId: string, description: string, steps: WorkflowStep[]): PipelineState {
  return {
    taskId,
    taskDescription: description,
    currentStep: 0,
    steps: steps.map((s) => ({ name: s.step, status: "pending" })),
    startedAt: Date.now(),
  };
}

function generateTaskId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `task-${date}-${rand}`;
}

export function workflowEngine(pi: ExtensionAPI) {
  let state: PipelineState | null = null;
  let config: HubConfig | null = null;
  let hubDir: string = "";
  let currentCtx: ExtensionContext | undefined;

  function getSteps(): WorkflowStep[] {
    return config?.workflow?.pipeline || [];
  }

  function savePipelineState() {
    if (state) {
      pi.appendEntry(PIPELINE_ENTRY_TYPE, state);
    }
  }

  function advanceStep() {
    if (!state) return;
    if (state.currentStep < state.steps.length) {
      state.steps[state.currentStep].status = "completed";
      state.steps[state.currentStep].completedAt = Date.now();
    }
    state.currentStep++;
    if (state.currentStep < state.steps.length) {
      state.steps[state.currentStep].status = "active";
      state.steps[state.currentStep].startedAt = Date.now();
    }
    savePipelineState();
    updateWidget();
  }

  function updateWidget() {
    if (!state || !currentCtx) return;

    const lines = [`━━━ ${state.taskId}: ${state.taskDescription} ━━━`];
    for (const step of state.steps) {
      const icon = step.status === "completed" ? "✓"
        : step.status === "active" ? "▶"
        : step.status === "skipped" ? "⊘"
        : step.status === "failed" ? "✗"
        : "○";
      lines.push(`  ${icon} ${step.name}`);
    }
    currentCtx.ui.setWidget("hub-pipeline", lines);
  }

  function startPipeline(taskId: string, description: string) {
    const steps = getSteps();
    state = createPipelineState(taskId, description, steps);
    if (state.steps.length > 0) {
      state.steps[0].status = "active";
      state.steps[0].startedAt = Date.now();
    }
    savePipelineState();
    updateWidget();
  }

  pi.on("session_start", async (_event, ctx) => {
    hubDir = ctx.cwd;
    currentCtx = ctx;

    try {
      config = await loadHubConfig(hubDir);
    } catch {
      return;
    }

    const entries = ctx.sessionManager.getEntries();
    const pipelineEntries = entries.filter((e: { type: string }) => e.type === PIPELINE_ENTRY_TYPE);
    if (pipelineEntries.length > 0) {
      state = pipelineEntries[pipelineEntries.length - 1].data as PipelineState;
      updateWidget();
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!state || !config) return;

    const currentStepIdx = state.currentStep;
    if (currentStepIdx >= state.steps.length) return;

    const steps = getSteps();
    const currentStep = steps[currentStepIdx];
    if (!currentStep) return;

    const agentName = currentStep.agent || (currentStep.agents?.[0] as string);
    if (!agentName) return;

    const agentFile = join(resolve(hubDir, "agents"), `${agentName}.md`);
    let agentContext = "";
    if (existsSync(agentFile)) {
      try {
        agentContext = await readFile(agentFile, "utf-8");
      } catch {
        // skip
      }
    }

    const pipelineContext = `
## Current Pipeline State

Task: ${state.taskId} — ${state.taskDescription}
Current step: ${state.steps[currentStepIdx].name} (${currentStepIdx + 1}/${state.steps.length})
`;

    const extra = [pipelineContext];
    if (agentContext) extra.push(agentContext);

    return {
      systemPrompt: event.systemPrompt + "\n" + extra.join("\n"),
    };
  });

  pi.on("turn_end", async () => {
    updateWidget();
  });

  pi.registerCommand("feature", {
    description: "Start a new feature pipeline: /feature <description>",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      if (!config) {
        ctx.ui.notify("No hub config found", "warning");
        return;
      }
      const description = args.trim();
      if (!description) {
        ctx.ui.notify("Usage: /feature <description>", "warning");
        return;
      }
      const taskId = generateTaskId();
      startPipeline(taskId, description);
      ctx.ui.notify(`Pipeline started: ${taskId}`, "info");
    },
  });

  pi.registerCommand("bugfix", {
    description: "Start a bugfix pipeline: /bugfix <description>",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      if (!config) {
        ctx.ui.notify("No hub config found", "warning");
        return;
      }
      const description = args.trim();
      if (!description) {
        ctx.ui.notify("Usage: /bugfix <description>", "warning");
        return;
      }
      const taskId = generateTaskId();
      startPipeline(taskId, description);
      ctx.ui.notify(`Bugfix pipeline started: ${taskId}`, "info");
    },
  });

  pi.registerCommand("next", {
    description: "Advance to the next pipeline step",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "warning");
        return;
      }
      if (state.currentStep >= state.steps.length - 1) {
        ctx.ui.notify("Pipeline already at last step", "warning");
        return;
      }
      advanceStep();
      ctx.ui.notify(`Advanced to: ${state.steps[state.currentStep].name}`, "info");
    },
  });

  pi.registerCommand("back", {
    description: "Return to the previous pipeline step",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "warning");
        return;
      }
      if (state.currentStep <= 0) {
        ctx.ui.notify("Already at first step", "warning");
        return;
      }
      state.steps[state.currentStep].status = "pending";
      state.currentStep--;
      state.steps[state.currentStep].status = "active";
      savePipelineState();
      updateWidget();
      ctx.ui.notify(`Returned to: ${state.steps[state.currentStep].name}`, "info");
    },
  });

  pi.registerCommand("skip", {
    description: "Skip the current pipeline step",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "warning");
        return;
      }
      if (state.currentStep >= state.steps.length) {
        ctx.ui.notify("Pipeline already complete", "warning");
        return;
      }
      state.steps[state.currentStep].status = "skipped";
      state.steps[state.currentStep].completedAt = Date.now();
      state.currentStep++;
      if (state.currentStep < state.steps.length) {
        state.steps[state.currentStep].status = "active";
        state.steps[state.currentStep].startedAt = Date.now();
      }
      savePipelineState();
      updateWidget();
      const stepName = state.currentStep < state.steps.length
        ? state.steps[state.currentStep].name
        : "complete";
      ctx.ui.notify(`Skipped. Now at: ${stepName}`, "info");
    },
  });

  pi.registerCommand("status", {
    description: "Show current pipeline status",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "info");
        return;
      }
      updateWidget();
      const current = state.currentStep < state.steps.length
        ? state.steps[state.currentStep].name
        : "complete";
      ctx.ui.notify(`Pipeline: ${state.taskId} | Step: ${current} (${state.currentStep + 1}/${state.steps.length})`, "info");
    },
  });

  pi.registerCommand("abort", {
    description: "Abort the current pipeline",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "warning");
        return;
      }
      state = null;
      ctx.ui.setWidget("hub-pipeline", undefined);
      ctx.ui.notify("Pipeline aborted", "info");
    },
  });

  pi.registerCommand("retry", {
    description: "Retry the current pipeline step",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      if (!state) {
        ctx.ui.notify("No active pipeline", "warning");
        return;
      }
      if (state.currentStep >= state.steps.length) {
        ctx.ui.notify("Pipeline already complete", "warning");
        return;
      }
      state.steps[state.currentStep].status = "active";
      state.steps[state.currentStep].startedAt = Date.now();
      savePipelineState();
      updateWidget();
      ctx.ui.notify(`Retrying: ${state.steps[state.currentStep].name}`, "info");
    },
  });
}
