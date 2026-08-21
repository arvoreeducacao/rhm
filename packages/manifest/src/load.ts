import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "./types.js";

export const MANIFEST_FILE = "hive.json";

/** Reads the manifest at the root of a workspace. */
export function load(root: string): Manifest {
  const file = join(root, MANIFEST_FILE);
  if (!existsSync(file)) {
    throw new Error(`no ${MANIFEST_FILE} in ${root}`);
  }

  const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  if (!Array.isArray(manifest.repos)) {
    throw new Error(`${file}: "repos" must be an array`);
  }
  return manifest;
}
