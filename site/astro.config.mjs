import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { rehypeScrollTables, remarkSkillLinks } from './src/lib/skill-pages.mjs';

// Served from GitHub Pages as a project site, so every internal link goes
// through `url()` in src/lib/url.ts rather than starting with a bare `/`.
// The docs render skills/toil/*.md, outside this package, so the dev server
// may read the repository root too.
//
// The Toil UI preview is static files in public/ui-preview/ (scripts/ui-preview.mjs).
// GitHub Pages serves a folder's index.html; the dev server doesn't, so this
// does the same for /ui-preview/ in dev.
const uiPreviewIndex = {
  name: 'ui-preview-index',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? '').split('?');
      if (path.endsWith('/ui-preview/')) req.url = `${path}index.html${query ? `?${query}` : ''}`;
      next();
    });
  },
};

export default defineConfig({
  site: 'https://imagile-dev.github.io',
  base: '/toil',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: { remarkPlugins: [remarkSkillLinks({ base: '/toil' })], rehypePlugins: [rehypeScrollTables()] },
  vite: { server: { fs: { allow: ['..'] } }, plugins: [uiPreviewIndex] },
});
