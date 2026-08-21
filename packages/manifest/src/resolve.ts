import type { Attachment, Manifest, Resolution, Scope, Target } from "./types.js";

const targetsOf = (scope: Scope): Target[] =>
  scope === "*" ? [] : Array.isArray(scope) ? scope : [scope];

const hits = (target: Target, repo: string): boolean =>
  typeof target === "string" ? target === repo : target.repo === repo;

/** Whether a scope applies to a repository. */
export function applies(scope: Scope, repo: string): boolean {
  return scope === "*" || targetsOf(scope).some((t) => hits(t, repo));
}

/** The path glob a scope narrows a repository to, when it does. */
export function pathFor(scope: Scope, repo: string): string | undefined {
  for (const target of targetsOf(scope)) {
    if (typeof target !== "string" && target.repo === repo) return target.path;
  }
  return undefined;
}

const attachmentsIn = (map: Record<string, Scope> | undefined, repo: string): Attachment[] =>
  Object.entries(map ?? {})
    .filter(([, scope]) => applies(scope, repo))
    .map(([name, scope]) => {
      const path = pathFor(scope, repo);
      return path ? { name, path } : { name };
    });

/** Repository name from an `org/name` entry. */
export const repoName = (entry: string): string => entry.split("/").pop() ?? entry;

/** What a repository carries: its skills, MCP servers and env file. */
export function resolve(manifest: Manifest, repo: string): Resolution {
  return {
    repo,
    declared: manifest.repos.map(repoName).includes(repo),
    skills: attachmentsIn(manifest.skills, repo),
    mcps: attachmentsIn(manifest.mcps, repo),
    envFile: manifest.env?.[repo] ?? ".env",
    integrations: manifest.integrations ?? {},
  };
}
