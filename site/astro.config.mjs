import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { rehypeScrollTables, remarkSkillLinks } from './src/lib/skill-pages.mjs';

// Served from GitHub Pages as a project site, so every internal link goes
// through `url()` in src/lib/url.ts rather than starting with a bare `/`.
// The docs render skills/toil/*.md, outside this package, so the dev server
// may read the repository root too.
//
// The Toil UI preview is static files in public/ui/app/ (scripts/ui-preview.mjs),
// which the showcase at /ui/ frames (#374). GitHub Pages serves a folder's
// index.html; the dev server doesn't, so this does the same for /ui/app/ in dev.
const uiPreviewIndex = {
  name: 'ui-preview-index',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? '').split('?');
      if (path.endsWith('/ui/app/')) req.url = `${path}index.html${query ? `?${query}` : ''}`;
      next();
    });
  },
};

export default defineConfig({
  site: 'https://imagile-dev.github.io',
  base: '/toil',
  trailingSlash: 'always',
  // /ui-preview/ only forwards to /ui/ (#374), so it stays out of the sitemap.
  integrations: [sitemap({ filter: (page) => !page.endsWith('/ui-preview/') })],
  markdown: { remarkPlugins: [remarkSkillLinks({ base: '/toil' })], rehypePlugins: [rehypeScrollTables()] },
  vite: { server: { fs: { allow: ['..'] } }, plugins: [uiPreviewIndex] },
});
