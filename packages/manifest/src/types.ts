/**
 * A workspace manifest declares *where* each skill and MCP server applies.
 *
 * It deliberately does not describe skills or MCP servers themselves — those
 * already have formats of their own (a folder with SKILL.md, an MCP server
 * entry). This file only points at them.
 */

/** A repository the rule applies to, optionally narrowed to a path glob. */
export type Target = string | { repo: string; path: string };

/** Where a rule applies: everywhere, one target, or several. */
export type Scope = "*" | Target | Target[];

export interface Manifest {
  $schema?: string;
  /** Repositories in the workspace, as `org/name`. */
  repos: string[];
  /** Skill name to the repositories it applies to. */
  skills?: Record<string, Scope>;
  /** MCP server name to the repositories it is wired into. */
  mcps?: Record<string, Scope>;
  /** Repository to its env file, when it is not `.env`. */
  env?: Record<string, string>;
  integrations?: {
    /** Branch pattern, e.g. `{task}-{slug}`. */
    branch?: string;
    /** Slack channel id notified on delivery. */
    slack?: string;
  };
}

/** One resolved attachment, with the path glob when the rule narrowed it. */
export interface Attachment {
  name: string;
  path?: string;
}

export interface Resolution {
  repo: string;
  /** Whether the repository is listed in the manifest. */
  declared: boolean;
  skills: Attachment[];
  mcps: Attachment[];
  envFile: string;
  integrations: NonNullable<Manifest["integrations"]>;
}

export interface Reconciliation {
  /** Repositories found on disk. */
  onDisk: string[];
  /** Repositories listed in the manifest. */
  declared: string[];
  /** Listed and present. */
  matched: string[];
  /** Listed but not cloned. */
  missing: string[];
  /** Present but not listed. */
  undeclared: string[];
}

export interface DiscoveredRepo {
  name: string;
  stack: Stack;
}

export type Stack =
  | "elixir"
  | "python"
  | "nextjs"
  | "nestjs"
  | "react-native"
  | "react"
  | "node"
  | "unknown";
