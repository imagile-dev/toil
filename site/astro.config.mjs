import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { remarkSkillLinks } from './src/lib/skill-pages.mjs';

// Served from GitHub Pages as a project site, so every internal link goes
// through `url()` in src/lib/url.ts rather than starting with a bare `/`.
// The docs render skills/toil/*.md, outside this package, so the dev server
// may read the repository root too.
export default defineConfig({
  site: 'https://imagile-dev.github.io',
  base: '/toil',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: { remarkPlugins: [remarkSkillLinks({ base: '/toil' })] },
  vite: { server: { fs: { allow: ['..'] } } },
});
