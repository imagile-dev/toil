import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Served from GitHub Pages as a project site, so every internal link goes
// through `url()` in src/lib/url.ts rather than starting with a bare `/`.
export default defineConfig({
  site: 'https://imagile-dev.github.io',
  base: '/toil',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
