import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getSessionState } from "./session-state.js";

function center(text: string, width: number): string {
  if (!text) return text;
  // eslint-disable-next-line no-control-regex
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, Math.floor((width - visible) / 2));
  return " ".repeat(pad) + text;
}

function getHubLogo(theme: Theme): string[] {
  const c = (t: string) => theme.fg("accent", t);

  return [
    "",
    c("██╗  ██╗██╗   ██╗██████╗ "),
    c("██║  ██║██║   ██║██╔══██╗"),
    c("███████║██║   ██║██████╔╝"),
    c("██╔══██║██║   ██║██╔══██╗"),
    c("██║  ██║╚██████╔╝██████╔╝"),
    c("╚═╝  ╚═╝ ╚═════╝ ╚═════╝ "),
    "",
  ];
}

export function header(pi: ExtensionAPI) {
  let projectName = "arvore-hub";
  let modelId = "";

  pi.on("session_start", async (_event, ctx) => {
    const { config, pi: toggles } = getSessionState();
    if (!toggles?.headerBanner) return;
    if (config) projectName = config.name;

    modelId = ctx.model?.id || "";

    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const logo = getHubLogo(theme);
        const parts = [modelId, projectName].filter(Boolean);
        const subtitle = theme.fg("muted", parts.join(" · "));
        return [...logo.map(l => center(l, width)), center(subtitle, width), ""];
      },
      invalidate() {},
    }));
  });

  pi.on("model_select", async (event, ctx) => {
    const { pi: toggles } = getSessionState();
    if (!toggles?.headerBanner) return;
    modelId = event.model.id;
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const logo = getHubLogo(theme);
        const parts = [modelId, projectName].filter(Boolean);
        const subtitle = theme.fg("muted", parts.join(" · "));
        return [...logo.map(l => center(l, width)), center(subtitle, width), ""];
      },
      invalidate() {},
    }));
  });
}
