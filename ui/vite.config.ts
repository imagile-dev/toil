import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
import { META_CSP } from './server/csp.ts';

// The UI is static files any server can host under any path: the site serves
// the preview at /toil/ui-preview/, and the local server serves the app at its
// own base path (a setting, #206). Relative asset URLs and hash routes keep both
// working without telling the build where it will live.
// It reads the OWI types and the sprint fixture from the repository root, one
// copy for the CLI and the UI, so the dev server may read above ui/.
//
// Two builds from one page: the default is the site preview (dist/preview/, on
// the fixture execute() and the scripted Agent, src/main.tsx); `--mode app` is
// what the toil-ui package serves (dist/app/, on the local server's API,
// src/local.tsx). The server itself is vite.server.config.ts.

/** Points index.html at the local app's entry, and drops the preview's wording. */
function localApp(): Plugin {
  return {
    name: 'toil-ui-local-entry',
    // 'pre', so the entry is swapped before Vite reads index.html for the scripts to bundle.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html
        .replace('/src/main.tsx', '/src/local.tsx')
        .replace('<title>Toil UI preview</title>', '<title>Toil UI</title>')
        .replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="Toil UI, running on this machine: work across Jira, Azure DevOps and GitHub, read through toil." />'),
    },
  };
}

/**
 * The server's Content-Security-Policy as a <meta> tag in the built page, so the
 * site preview, which a static host serves, holds to it too. Build only: Vite's
 * dev server injects inline script for hot reload.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'toil-ui-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${META_CSP}" />`),
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), contentSecurityPolicy(), ...(mode === 'app' ? [localApp()] : [])],
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: mode === 'app' ? 'dist/app' : 'dist/preview',
    emptyOutDir: true,
    // Fonts stay files, never data: URLs, so the Content-Security-Policy can say `font-src 'self'`.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
}));
