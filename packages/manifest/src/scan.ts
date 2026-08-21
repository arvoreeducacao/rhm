import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredRepo, Stack } from "./types.js";

const readJson = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/**
 * Reads the stack from what the repository already declares about itself, so
 * nobody has to write it down twice.
 */
export function stackOf(dir: string): Stack {
  if (existsSync(join(dir, "mix.exs"))) return "elixir";
  if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "requirements.txt"))) {
    return "python";
  }

  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) return "unknown";

  const manifest = readJson(pkg);
  const deps = {
    ...((manifest.dependencies as Record<string, string>) ?? {}),
    ...((manifest.devDependencies as Record<string, string>) ?? {}),
  };

  if (deps.next) return "nextjs";
  if (deps["@nestjs/core"]) return "nestjs";
  if (deps["react-native"] || deps.expo) return "react-native";
  if (deps.react) return "react";
  return "node";
}

/** Every git repository directly inside `root`. */
export function scan(root: string): DiscoveredRepo[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, ".git")))
    .map((entry) => ({ name: entry.name, stack: stackOf(join(root, entry.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
