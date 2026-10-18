import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The UI is static files any server can host under any path: the site serves
// the preview at /toil/ui-preview/, and the local app will serve it at its own
// base path (a setting, #206). Relative asset URLs and hash routes keep both
// working without telling the build where it will live.
// It reads the OWI types and the sprint fixture from the repository root, one
// copy for the CLI and the UI, so the dev server may read above ui/.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
