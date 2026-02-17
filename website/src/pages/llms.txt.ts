import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE_URL = 'https://repo-hub.dev';

const sections = [
  {
    title: 'Getting Started',
    slugs: ['getting-started', 'configuration', 'cli'],
  },
  {
    title: 'Configuration',
    slugs: ['repos', 'tools', 'environment', 'services', 'integrations', 'workflow'],
  },
  {
    title: 'Core Concepts',
    slugs: ['agents', 'skills', 'mcps', 'worktrees'],
  },
  {
    title: 'About',
    slugs: ['philosophy', 'our-story', 'best-practices', 'product-engineer'],
  },
  {
    title: 'Project',
    slugs: ['roadmap'],
  },
];

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const docMap = new Map(docs.map(d => [d.slug, d]));

  let output = `# Repo Hub

> Give your AI coding assistant the full picture.

Repo Hub lets your AI see across all your repositories as one workspace. Configure agents, skills, MCPs, and workflows in a single hub.yaml file.

## Docs

`;

  for (const section of sections) {
    output += `### ${section.title}\n\n`;
    for (const slug of section.slugs) {
      const doc = docMap.get(slug);
      if (doc) {
        const desc = doc.data.description ? `: ${doc.data.description}` : '';
        output += `- [${doc.data.title}](${SITE_URL}/docs/${slug})${desc}\n`;
      }
    }
    output += '\n';
  }

  output += `## Full Documentation\n\n`;
  output += `For the complete documentation in a single file, see [llms-full.txt](${SITE_URL}/llms-full.txt)\n`;

  return new Response(output.trim(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
