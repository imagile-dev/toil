import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import { rehypeScrollTables, remarkSkillLinks } from './src/lib/skill-pages.mjs';
import { isRedirect } from './src/lib/redirects.mjs';

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
  // Astro 7 defaults to JSX whitespace rules, which drop the space between a line of text and the tag after it.
  // The pages were written for HTML's own rules, so keep the collapsing Astro 5 did.
  compressHTML: true,
  // An old address only forwards to its new home (src/lib/redirects.mjs), so it stays out of the sitemap.
  integrations: [sitemap({ filter: (page) => !isRedirect(new URL(page).pathname.replace(/^\/toil/, '')) })],
  // Astro 7 renders Markdown with Sätteri unless told otherwise; the docs pages depend on remark and rehype plugins, so they keep the unified processor.
  markdown: { processor: unified({ remarkPlugins: [remarkSkillLinks({ base: '/toil' })], rehypePlugins: [rehypeScrollTables()] }) },
  vite: { server: { fs: { allow: ['..'] } }, plugins: [uiPreviewIndex] },
});
