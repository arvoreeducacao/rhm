import type { Manifest, Reconciliation } from "./types.js";
import { repoName } from "./resolve.js";

/** Compares what the manifest lists against what is actually on disk. */
export function reconcile(manifest: Manifest, onDisk: string[]): Reconciliation {
  const declared = manifest.repos.map(repoName);
  const present = new Set(onDisk);
  const listed = new Set(declared);

  return {
    onDisk,
    declared,
    matched: declared.filter((r) => present.has(r)),
    missing: declared.filter((r) => !present.has(r)),
    undeclared: onDisk.filter((r) => !listed.has(r)),
  };
}
