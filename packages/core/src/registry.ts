import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_REGISTRY_REPO = process.env.HUB_REGISTRY || "arvoreeducacao/rhm";
const DEFAULT_BRANCH = "main";

interface GitHubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

export async function downloadDirFromGitHub(
  repo: string,
  remotePath: string,
  destDir: string,
  branch = DEFAULT_BRANCH
): Promise<void> {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}?ref=${branch}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Not found: ${remotePath} in ${repo}`);
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const items = (await res.json()) as GitHubContentEntry[];

  await mkdir(destDir, { recursive: true });

  for (const item of items) {
    if (item.type === "file" && item.download_url) {
      const fileRes = await fetch(item.download_url);
      if (!fileRes.ok) continue;
      const content = await fileRes.text();
      await writeFile(join(destDir, item.name), content, "utf-8");
    } else if (item.type === "dir") {
      await downloadDirFromGitHub(repo, item.path, join(destDir, item.name), branch);
    }
  }
}

export async function listRegistryDir(
  repo: string,
  remotePath: string,
  branch = DEFAULT_BRANCH
): Promise<GitHubContentEntry[]> {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}?ref=${branch}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!res.ok) return [];
  return (await res.json()) as GitHubContentEntry[];
}

export async function listRegistrySkills(repo: string): Promise<{ name: string; description: string }[]> {
  const items = await listRegistryDir(repo, "skills");
  const skills: { name: string; description: string }[] = [];

  for (const item of items) {
    if (item.type !== "dir") continue;

    const skillUrl = `https://raw.githubusercontent.com/${repo}/${DEFAULT_BRANCH}/skills/${item.name}/SKILL.md`;
    try {
      const res = await fetch(skillUrl);
      if (!res.ok) continue;
      const content = await res.text();
      const descMatch = content.match(/^description:\s*(.+)$/m);
      skills.push({
        name: item.name,
        description: descMatch?.[1]?.replace(/^["']|["']$/g, "") || "",
      });
    } catch {
      continue;
    }
  }

  return skills;
}
