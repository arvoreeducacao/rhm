import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';

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

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, '').trim();
}

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const docMap = new Map(docs.map(d => [d.slug, d]));

  const docsDir = path.join(process.cwd(), 'src', 'content', 'docs');

  let output = `# Repo Hub — Complete Documentation

> Give your AI coding assistant the full picture.

Repo Hub lets your AI see across all your repositories as one workspace. Configure agents, skills, MCPs, and workflows in a single hub.yaml file.

---

`;

  const orderedSlugs: string[] = [];
  for (const section of sections) {
    orderedSlugs.push(...section.slugs);
  }

  for (const slug of orderedSlugs) {
    const doc = docMap.get(slug);
    if (!doc) continue;

    const filePath = path.join(docsDir, `${slug}.mdx`);
    let rawContent = '';
    try {
      rawContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const content = stripFrontmatter(rawContent);
    output += `# ${doc.data.title}\n\n`;
    if (doc.data.description) {
      output += `> ${doc.data.description}\n\n`;
    }
    output += `${content}\n\n---\n\n`;
  }

  return new Response(output.trim(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
