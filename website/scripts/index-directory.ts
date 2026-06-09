import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

type ItemType = "skill" | "agent" | "hook" | "command";
type SourceType = "skills" | "agents" | "hooks" | "commands";

interface CuratedEntry {
  repo: string;
  type: SourceType;
  verified: boolean;
  description: string;
}

interface DirectorySources {
  registry: string;
  curated: CuratedEntry[];
}

interface DirectoryItem {
  name: string;
  description: string;
  type: ItemType;
  source: string;
  repo: string;
  installCmd: string;
  verified: boolean;
  fromRegistry: boolean;
  stars?: number;
  sourceUrl?: string;
  contentPreview?: string;
}

const GITHUB_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github.v3+json",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    fm[key] = val;
  }
  return fm;
}

const PREVIEW_MAX_CHARS = 800;

function extractPreview(content: string | null): string | undefined {
  if (!content) return undefined;
  let text = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (text.length > PREVIEW_MAX_CHARS) {
    text = text.slice(0, PREVIEW_MAX_CHARS) + "\n...";
  }
  return text || undefined;
}

function ghBlobUrl(repo: string, path: string): string {
  return `https://github.com/${repo}/blob/main/${path}`;
}

async function getRepoStars(repo: string): Promise<number | undefined> {
  const data = await fetchJSON<{ stargazers_count: number }>(
    `https://api.github.com/repos/${repo}`
  );
  return data?.stargazers_count;
}

async function indexSkillsFromRepo(
  entry: CuratedEntry,
  items: DirectoryItem[]
): Promise<void> {
  const { repo } = entry;
  const stars = await getRepoStars(repo);

  const skillsContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${repo}/contents/skills`
  );

  if (skillsContents && Array.isArray(skillsContents)) {
    const dirs = skillsContents.filter((i) => i.type === "dir");
    for (const dir of dirs) {
      const filePath = `skills/${dir.name}/SKILL.md`;
      const content = await fetchText(
        `https://raw.githubusercontent.com/${repo}/main/${filePath}`
      );
      if (!content) continue;
      const fm = extractFrontmatter(content);
      items.push({
        name: fm.name || dir.name,
        description: fm.description || entry.description,
        type: "skill",
        source: "curated",
        repo,
        installCmd: `hub skills add ${repo}/${dir.name}`,
        verified: entry.verified,
        fromRegistry: false,
        stars,
        sourceUrl: ghBlobUrl(repo, filePath),
        contentPreview: extractPreview(content),
      });
    }
    if (dirs.length > 0) return;
  }

  const rootContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${repo}/contents`
  );

  if (rootContents && Array.isArray(rootContents)) {
    const dirs = rootContents.filter(
      (i) => i.type === "dir" && !i.name.startsWith(".")
    );
    for (const dir of dirs) {
      const filePath = `${dir.name}/SKILL.md`;
      const content = await fetchText(
        `https://raw.githubusercontent.com/${repo}/main/${filePath}`
      );
      if (!content) continue;
      const fm = extractFrontmatter(content);
      items.push({
        name: fm.name || dir.name,
        description: fm.description || entry.description,
        type: "skill",
        source: "curated",
        repo,
        installCmd: `hub skills add ${repo}/${dir.name}`,
        verified: entry.verified,
        fromRegistry: false,
        stars,
        sourceUrl: ghBlobUrl(repo, filePath),
        contentPreview: extractPreview(content),
      });
    }
  }

  const rootSkill = await fetchText(
    `https://raw.githubusercontent.com/${repo}/main/SKILL.md`
  );
  if (rootSkill) {
    const fm = extractFrontmatter(rootSkill);
    const name = fm.name || repo.split("/").pop()!;
    items.push({
      name,
      description: fm.description || entry.description,
      type: "skill",
      source: "curated",
      repo,
      installCmd: `hub skills add ${repo}`,
      verified: entry.verified,
      fromRegistry: false,
      stars,
      sourceUrl: ghBlobUrl(repo, "SKILL.md"),
      contentPreview: extractPreview(rootSkill),
    });
  }
}

async function indexAgentsFromRepo(
  entry: CuratedEntry,
  items: DirectoryItem[]
): Promise<void> {
  const { repo } = entry;
  const stars = await getRepoStars(repo);

  const agentsContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${repo}/contents/agents`
  );

  if (agentsContents && Array.isArray(agentsContents)) {
    const mdFiles = agentsContents.filter(
      (i) => i.type === "file" && i.name.endsWith(".md")
    );
    for (const file of mdFiles) {
      const filePath = `agents/${file.name}`;
      const content = await fetchText(
        `https://raw.githubusercontent.com/${repo}/main/${filePath}`
      );
      if (!content) continue;
      const fm = extractFrontmatter(content);
      items.push({
        name: fm.name || file.name.replace(/\.md$/, ""),
        description: fm.description || entry.description,
        type: "agent",
        source: "curated",
        repo,
        installCmd: `hub agents add ${repo}`,
        verified: entry.verified,
        fromRegistry: false,
        stars,
        sourceUrl: ghBlobUrl(repo, filePath),
        contentPreview: extractPreview(content),
      });
    }
    if (mdFiles.length > 0) return;
  }

  const categoriesDirs = ["categories"];
  for (const catDir of categoriesDirs) {
    const catContents = await fetchJSON<{ name: string; type: string }[]>(
      `https://api.github.com/repos/${repo}/contents/${catDir}`
    );
    if (!catContents || !Array.isArray(catContents)) continue;

    const subDirs = catContents.filter((i) => i.type === "dir");
    for (const sub of subDirs) {
      const subContents = await fetchJSON<{ name: string; type: string }[]>(
        `https://api.github.com/repos/${repo}/contents/${catDir}/${sub.name}`
      );
      if (!subContents || !Array.isArray(subContents)) continue;

      const mdFiles = subContents.filter(
        (i) => i.type === "file" && i.name.endsWith(".md")
      );
      for (const file of mdFiles) {
        const filePath = `${catDir}/${sub.name}/${file.name}`;
        const content = await fetchText(
          `https://raw.githubusercontent.com/${repo}/main/${filePath}`
        );
        if (!content) continue;
        const fm = extractFrontmatter(content);
        items.push({
          name: fm.name || file.name.replace(/\.md$/, ""),
          description: fm.description || entry.description,
          type: "agent",
          source: "curated",
          repo,
          installCmd: `hub agents add ${repo}`,
          verified: entry.verified,
          fromRegistry: false,
          stars,
          sourceUrl: ghBlobUrl(repo, filePath),
          contentPreview: extractPreview(content),
        });
      }
    }
    if (items.length > 0) return;
  }

  const rootContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${repo}/contents`
  );

  if (rootContents && Array.isArray(rootContents)) {
    const mdFiles = rootContents.filter(
      (i) =>
        i.type === "file" &&
        i.name.endsWith(".md") &&
        i.name !== "README.md" &&
        i.name !== "CHANGELOG.md" &&
        !i.name.startsWith(".")
    );
    for (const file of mdFiles) {
      const content = await fetchText(
        `https://raw.githubusercontent.com/${repo}/main/${file.name}`
      );
      if (!content) continue;
      const fm = extractFrontmatter(content);
      items.push({
        name: fm.name || file.name.replace(/\.md$/, ""),
        description: fm.description || entry.description,
        type: "agent",
        source: "curated",
        repo,
        installCmd: `hub agents add ${repo}`,
        verified: entry.verified,
        fromRegistry: false,
        stars,
        sourceUrl: ghBlobUrl(repo, file.name),
        contentPreview: extractPreview(content),
      });
    }
  }
}

const IGNORED_FILES = new Set([
  "README.md", "CHANGELOG.md", "LICENSE", "LICENSE.md",
  ".gitkeep", ".gitignore", ".DS_Store",
]);

const INFRA_EXTENSIONS = new Set([".json", ".cmd", ".bat", ".ps1", ".lock"]);

function cleanFileName(name: string): string {
  return name.replace(/\.(md|sh|bash|zsh|py|ts|js)$/, "");
}

function extractShellDescription(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#!")) continue;
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
    break;
  }
  return undefined;
}

function isInfraFile(name: string): boolean {
  const ext = name.includes(".") ? "." + name.split(".").pop()! : "";
  return INFRA_EXTENSIONS.has(ext.toLowerCase());
}

async function indexGenericFromRepo(
  entry: CuratedEntry,
  items: DirectoryItem[],
  dirName: string,
  itemType: ItemType
): Promise<void> {
  const { repo } = entry;
  const stars = await getRepoStars(repo);

  const dirContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${repo}/contents/${dirName}`
  );

  if (!dirContents || !Array.isArray(dirContents)) return;

  const files = dirContents.filter(
    (i) =>
      i.type === "file" &&
      !IGNORED_FILES.has(i.name) &&
      !i.name.startsWith(".") &&
      !isInfraFile(i.name)
  );

  for (const file of files) {
    const filePath = `${dirName}/${file.name}`;
    const content = await fetchText(
      `https://raw.githubusercontent.com/${repo}/main/${filePath}`
    );
    const fm = content ? extractFrontmatter(content) : {};
    const description =
      fm.description ||
      (content ? extractShellDescription(content) : undefined) ||
      entry.description;

    items.push({
      name: fm.name || cleanFileName(file.name),
      description,
      type: itemType,
      source: "curated",
      repo,
      installCmd: `hub ${dirName} add ${repo}`,
      verified: entry.verified,
      fromRegistry: false,
      stars,
      sourceUrl: ghBlobUrl(repo, filePath),
      contentPreview: extractPreview(content),
    });
  }
}

async function indexRegistry(
  registryRepo: string,
  items: DirectoryItem[]
): Promise<void> {
  const stars = await getRepoStars(registryRepo);

  const skillsContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${registryRepo}/contents/skills`
  );

  if (skillsContents && Array.isArray(skillsContents)) {
    const dirs = skillsContents.filter((i) => i.type === "dir");
    for (const dir of dirs) {
      const filePath = `skills/${dir.name}/SKILL.md`;
      const content = await fetchText(
        `https://raw.githubusercontent.com/${registryRepo}/main/${filePath}`
      );
      const fm = content ? extractFrontmatter(content) : {};
      items.push({
        name: fm.name || dir.name,
        description: fm.description || "",
        type: "skill",
        source: "registry",
        repo: registryRepo,
        installCmd: `hub skills add ${dir.name}`,
        verified: true,
        fromRegistry: true,
        stars,
        sourceUrl: ghBlobUrl(registryRepo, filePath),
        contentPreview: extractPreview(content),
      });
    }
  }

  const agentsContents = await fetchJSON<{ name: string; type: string }[]>(
    `https://api.github.com/repos/${registryRepo}/contents/agents`
  );

  if (agentsContents && Array.isArray(agentsContents)) {
    const mdFiles = agentsContents.filter(
      (i) => i.type === "file" && i.name.endsWith(".md")
    );
    for (const file of mdFiles) {
      const filePath = `agents/${file.name}`;
      const content = await fetchText(
        `https://raw.githubusercontent.com/${registryRepo}/main/${filePath}`
      );
      const fm = content ? extractFrontmatter(content) : {};
      items.push({
        name: fm.name || file.name.replace(/\.md$/, ""),
        description: fm.description || "",
        type: "agent",
        source: "registry",
        repo: registryRepo,
        installCmd: `hub agents add ${file.name.replace(/\.md$/, "")}`,
        verified: true,
        fromRegistry: true,
        stars,
        sourceUrl: ghBlobUrl(registryRepo, filePath),
        contentPreview: extractPreview(content),
      });
    }
  }
}

async function main() {
  console.log("Indexing directory...\n");

  const sourcesPath = join(ROOT, "directory-sources.json");
  if (!existsSync(sourcesPath)) {
    console.error("directory-sources.json not found");
    process.exit(1);
  }

  const sources: DirectorySources = JSON.parse(
    readFileSync(sourcesPath, "utf-8")
  );

  const items: DirectoryItem[] = [];

  console.log(`Indexing registry: ${sources.registry}`);
  await indexRegistry(sources.registry, items);
  console.log(`  Found ${items.length} items from registry\n`);

  for (const entry of sources.curated) {
    console.log(`Indexing: ${entry.repo} (${entry.type})`);
    const before = items.length;
    switch (entry.type) {
      case "skills":
        await indexSkillsFromRepo(entry, items);
        break;
      case "agents":
        await indexAgentsFromRepo(entry, items);
        break;
      case "hooks":
        await indexGenericFromRepo(entry, items, "hooks", "hook");
        break;
      case "commands":
        await indexGenericFromRepo(entry, items, "commands", "command");
        break;
    }
    console.log(`  Found ${items.length - before} items\n`);
  }

  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const key = `${item.type}:${item.name}:${item.repo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dataDir = join(ROOT, "src", "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const outPath = join(dataDir, "directory.json");

  if (deduped.length === 0 && existsSync(outPath)) {
    console.log("\nNo items indexed (possible rate limit). Keeping existing directory.json.");
    return;
  }

  writeFileSync(outPath, JSON.stringify(deduped, null, 2), "utf-8");

  console.log(`\nDone! ${deduped.length} items written to src/data/directory.json`);
}

main().catch((err) => {
  console.error("Indexing failed:", err);
  process.exit(1);
});
