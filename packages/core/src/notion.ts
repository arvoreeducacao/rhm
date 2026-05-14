const NOTION_API_VERSION = "2022-06-28";

function getNotionToken(): string | undefined {
  return process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
}

export function extractPageId(pageRef: string): string {
  const cleaned = pageRef.replace(/https?:\/\/(?:www\.)?notion\.(?:so|site)\//, "");
  const withoutSlug = cleaned.split("?")[0].split("#")[0];
  const segments = withoutSlug.split("/");
  const last = segments[segments.length - 1] || "";
  const dashParts = last.split("-");
  const candidate = dashParts[dashParts.length - 1];

  if (candidate && /^[a-f0-9]{32}$/i.test(candidate)) {
    return formatPageId(candidate);
  }

  const noDashes = pageRef.replace(/-/g, "");
  const hexMatch = noDashes.match(/([a-f0-9]{32})/i);
  if (hexMatch) return formatPageId(hexMatch[1]);

  return pageRef;
}

function formatPageId(raw: string): string {
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

interface NotionRichText {
  type: string;
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
  href?: string | null;
}

function richTextToMarkdown(richTexts: NotionRichText[]): string {
  return richTexts
    .map((rt) => {
      let text = rt.plain_text;
      if (!text) return "";
      if (rt.annotations?.code) text = `\`${text}\``;
      if (rt.annotations?.bold) text = `**${text}**`;
      if (rt.annotations?.italic) text = `*${text}*`;
      if (rt.annotations?.strikethrough) text = `~~${text}~~`;
      if (rt.href) text = `[${text}](${rt.href})`;
      return text;
    })
    .join("");
}

async function notionFetch(endpoint: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Notion API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

interface BlockResult {
  results: Array<Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
}

async function fetchAllBlocks(pageId: string, token: string): Promise<Array<Record<string, unknown>>> {
  const blocks: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;

  do {
    const qs = cursor ? `?start_cursor=${cursor}` : "";
    const data = (await notionFetch(`/blocks/${pageId}/children${qs}`, token)) as BlockResult;
    blocks.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}

function blockToMarkdown(block: Record<string, unknown>, indent = ""): string {
  const type = block.type as string;
  const data = block[type] as Record<string, unknown> | undefined;
  if (!data) return "";

  const rt = (data.rich_text as NotionRichText[]) || [];
  const text = richTextToMarkdown(rt);

  switch (type) {
    case "paragraph":
      return text ? `${indent}${text}` : "";
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `${indent}- ${text}`;
    case "numbered_list_item":
      return `${indent}1. ${text}`;
    case "to_do": {
      const checked = data.checked ? "x" : " ";
      return `${indent}- [${checked}] ${text}`;
    }
    case "toggle":
      return `${indent}<details><summary>${text}</summary>`;
    case "code": {
      const lang = (data.language as string) || "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "quote":
      return `> ${text}`;
    case "callout":
      return `> ${text}`;
    case "divider":
      return "---";
    case "table_row": {
      const cells = (data.cells as NotionRichText[][]) || [];
      return `| ${cells.map((c) => richTextToMarkdown(c)).join(" | ")} |`;
    }
    case "image": {
      const imgData = data as Record<string, Record<string, string>>;
      const url = imgData.file?.url || imgData.external?.url || "";
      const caption = (data.caption as NotionRichText[]) || [];
      const alt = richTextToMarkdown(caption) || "image";
      return url ? `![${alt}](${url})` : "";
    }
    case "bookmark": {
      const bUrl = data.url as string;
      return bUrl ? `[${bUrl}](${bUrl})` : "";
    }
    default:
      return text || "";
  }
}

async function blocksToMarkdown(blocks: Array<Record<string, unknown>>, token: string, indent = ""): Promise<string> {
  const lines: string[] = [];
  for (const block of blocks) {
    const type = block.type as string;

    if (type === "table") {
      if (block.has_children) {
        const children = await fetchAllBlocks(block.id as string, token);
        const rows = children.map((child) => blockToMarkdown(child, indent));
        if (rows.length > 0) {
          lines.push(rows[0]);
          const colCount = (rows[0].match(/\|/g)?.length || 2) - 1;
          lines.push(`|${" --- |".repeat(colCount)}`);
          lines.push(...rows.slice(1));
        }
      }
      lines.push("");
      continue;
    }

    const line = blockToMarkdown(block, indent);
    if (line !== undefined) lines.push(line);

    if (block.has_children && type !== "table") {
      const children = await fetchAllBlocks(block.id as string, token);
      const childMd = await blocksToMarkdown(children, token, indent + "  ");
      if (childMd) lines.push(childMd);
      if (type === "toggle") lines.push("</details>");
    } else if (type === "toggle") {
      lines.push("</details>");
    }
  }

  return lines.join("\n");
}

interface PageResponse {
  properties: Record<string, { title?: Array<{ plain_text: string }> }>;
}

export async function fetchNotionPageAsMarkdown(pageRef: string): Promise<{ title: string; content: string }> {
  const token = getNotionToken();
  if (!token) {
    throw new Error("NOTION_API_KEY or NOTION_TOKEN env var is required to fetch Notion pages");
  }

  const pageId = extractPageId(pageRef);
  const page = (await notionFetch(`/pages/${pageId}`, token)) as PageResponse;

  let title = "";
  for (const prop of Object.values(page.properties)) {
    if (prop.title?.length) {
      title = prop.title.map((t) => t.plain_text).join("");
      break;
    }
  }

  const blocks = await fetchAllBlocks(pageId, token);
  const content = await blocksToMarkdown(blocks, token);

  return { title: title || "Untitled", content };
}
