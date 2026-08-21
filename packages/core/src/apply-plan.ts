import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { PlannedFile } from "./claude-code-plan.js";

export const HUB_MANAGED_START = "# >>> hub-managed (do not edit this section)";
export const HUB_MANAGED_END = "# <<< hub-managed";

export function managedBlockOf(text: string | null | undefined): string | null {
  const source = String(text ?? "");
  const from = source.indexOf(HUB_MANAGED_START);
  const to = source.indexOf(HUB_MANAGED_END);
  if (from === -1 || to === -1 || to < from) return null;
  return source.slice(from + HUB_MANAGED_START.length, to).replace(/^\n/, "").replace(/\n$/, "");
}

export function mergeManagedBlock(existing: string | null | undefined, managedLines: string[]): string {
  const block = [HUB_MANAGED_START, ...managedLines, HUB_MANAGED_END].join("\n");
  if (existing === null || existing === undefined) return block + "\n";

  const from = existing.indexOf(HUB_MANAGED_START);
  const to = existing.indexOf(HUB_MANAGED_END);
  if (from !== -1 && to !== -1 && to >= from) {
    return existing.slice(0, from) + block + existing.slice(to + HUB_MANAGED_END.length);
  }
  return block + "\n\n" + existing;
}

export async function writeManagedFile(filePath: string, managedLines: string[]): Promise<void> {
  const existing = existsSync(filePath) ? await readFile(filePath, "utf-8") : null;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, mergeManagedBlock(existing, managedLines), "utf-8");
}

/**
 * Every planned path is written under the root it was planned for. A plan built by
 * this package only ever names relative paths, but applyPlan is public API: a host
 * can hand it anything, and a path that climbs out of the workspace must not write.
 */
export function targetOf(rootDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`refusing to write an absolute path from a plan: ${filePath}`);
  }
  const root = resolve(rootDir);
  const target = resolve(root, filePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing to write outside the workspace: ${filePath}`);
  }
  return target;
}

export async function applyPlan(rootDir: string, files: PlannedFile[]): Promise<string[]> {
  const written: string[] = [];
  for (const file of files) {
    const target = targetOf(rootDir, file.path);
    if (file.kind === "managed-block") {
      await writeManagedFile(target, file.content.split("\n"));
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf-8");
    }
    written.push(file.path);
  }
  return written;
}

export type FileVerdict = "same" | "changed" | "new";

export function verdictOf(file: PlannedFile, onDisk: string | null | undefined): FileVerdict {
  if (onDisk === null || onDisk === undefined) return "new";
  if (file.kind === "managed-block") {
    const block = managedBlockOf(onDisk);
    return block !== null && block === file.content ? "same" : "changed";
  }
  return onDisk === file.content ? "same" : "changed";
}

export async function diffPlan(rootDir: string, files: PlannedFile[]): Promise<{ file: PlannedFile; verdict: FileVerdict }[]> {
  const out: { file: PlannedFile; verdict: FileVerdict }[] = [];
  for (const file of files) {
    const target = targetOf(rootDir, file.path);
    const onDisk = existsSync(target) ? await readFile(target, "utf-8") : null;
    out.push({ file, verdict: verdictOf(file, onDisk) });
  }
  return out;
}
