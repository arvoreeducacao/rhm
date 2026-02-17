import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { generateOgImage, sectionMap } from '../../lib/og-image';

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');

  const paths: { params: { slug: string }; props: Record<string, any> }[] = docs.map(
    (entry) => ({
      params: { slug: entry.slug },
      props: {
        title: entry.data.title,
        description: entry.data.description,
        section: sectionMap[entry.slug],
      },
    }),
  );

  paths.push({
    params: { slug: 'home' },
    props: {
      title: 'Your AI builds the feature. You review the PR.',
      description:
        'Repo Hub is the config file that teaches your AI how your company builds software.',
    },
  });

  paths.push({
    params: { slug: 'careers' },
    props: {
      title: 'Careers at Arvore',
      description: 'Join us in building the future of AI-assisted development.',
    },
  });

  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { title, description, section } = props as {
    title: string;
    description?: string;
    section?: string;
  };

  const png = await generateOgImage({ title, description, section });

  return new Response(Uint8Array.from(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
