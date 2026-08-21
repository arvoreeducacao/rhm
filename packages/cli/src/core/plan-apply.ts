import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import chalk from "chalk";
import type { PlannedFile, SteeringInput } from "@arvoretech/hub-core";

const HUB_MARKER_START = "# >>> hub-managed (do not edit this section)";
const HUB_MARKER_END = "# <<< hub-managed";

export async function writeManagedFile(filePath: string, managedLines: string[]): Promise<void> {
  const managedBlock = [HUB_MARKER_START, ...managedLines, HUB_MARKER_END].join("\n");

  if (existsSync(filePath)) {
    const existing = await readFile(filePath, "utf-8");
    const startIdx = existing.indexOf(HUB_MARKER_START);
    const endIdx = existing.indexOf(HUB_MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + HUB_MARKER_END.length);
      await writeFile(filePath, before + managedBlock + after, "utf-8");
      return;
    }

    await writeFile(filePath, managedBlock + "\n\n" + existing, "utf-8");
    return;
  }

  await writeFile(filePath, managedBlock + "\n", "utf-8");
}

export async function readSteeringInputs(hubDir: string): Promise<SteeringInput[]> {
  const steeringDir = resolve(hubDir, "steering");
  let files: string[];
  try {
    files = await readdir(steeringDir);
  } catch {
    return [];
  }

  const steering: SteeringInput[] = [];
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    steering.push({ name: file, content: await readFile(join(steeringDir, file), "utf-8") });
  }
  return steering;
}

export async function applyPlannedFiles(hubDir: string, files: PlannedFile[]): Promise<void> {
  for (const file of files) {
    const target = join(hubDir, file.path);
    if (file.kind === "managed-block") {
      await writeManagedFile(target, file.content.split("\n"));
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf-8");
    }
    console.log(chalk.green(`  Generated ${file.path}`));
  }
}
