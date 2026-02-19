import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://hub.arvore.com.br',
  integrations: [mdx(), tailwind()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark-dimmed',
      },
    },
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
