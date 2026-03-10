import { streamText, convertToModelMessages } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { getCollection } from 'astro:content';

export const prerender = false;

const gateway = createGateway({
  apiKey: import.meta.env.AI_GATEWAY_API_KEY,
});

let cachedDocsContent: string | null = null;

async function getDocsContent(): Promise<string> {
  if (cachedDocsContent) return cachedDocsContent;

  const docs = await getCollection('docs');

  const parts: string[] = docs
    .filter((doc) => doc.body)
    .map((doc) => {
      const content = doc.body!.replace(/^---[\s\S]*?---\s*/, '').trim();
      return `# ${doc.data.title}\n\n${content}`;
    });

  cachedDocsContent = parts.join('\n\n---\n\n');
  return cachedDocsContent;
}

const SYSTEM_PROMPT = `You are the Repo Hub documentation assistant. Answer ONLY based on the docs below. If you don't know, say so. Reply in the user's language.

Rules:
- Be extremely concise. Give the shortest useful answer.
- No introductions, no filler, no "sure!", no summaries at the end.
- Go straight to the answer.
- Use fenced code blocks (\`\`\`yaml, \`\`\`bash, \`\`\`json, etc.) for commands, configs, and snippets.
- Use inline \`code\` for file names, flags, and field names.
- Prefer showing code/config over explaining it in prose.

Documentation:
`;

export async function POST({ request }: { request: Request }) {
  const { messages } = await request.json();
  const docsContent = await getDocsContent();

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: gateway('openai/gpt-5-nano'),
    system: SYSTEM_PROMPT + docsContent,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
