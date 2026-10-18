import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';
import { noSpawn } from './scripts/no-spawn.mjs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// One self-contained ESM file: every dependency is bundled in, so the published
// package has no runtime dependencies and nothing for npm to install or build.
export default defineConfig({
  entry: { toil: 'src/cli.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  // Everything but the worker's metafile, which scripts/gen-worker.mjs writes before tsup runs.
  clean: ['**/*', '!metafile-worker.json'],
  shims: false,
  // The purity gate reads real imports from here rather than scanning text.
  metafile: true,
  // Keep `node:` specifiers as written. tsup otherwise rewrites them to bare
  // externals in its first plugin, before the no-spawn stub below can see them.
  removeNodeProtocol: false,
  esbuildPlugins: [
    // child_process resolves to a stub that refuses, except in the reviewed spawners (scripts/no-spawn.mjs).
    noSpawn,
    {
      // tedious (SQL Server) imports the Azure SDK for Entra sign-in and
      // Always Encrypted key vaults, which toil never uses; a stub keeps that
      // SDK, and the processes its credential flows can start, out of the bundle.
      name: 'no-azure',
      setup(build) {
        build.onResolve({ filter: /^@azure\/(identity|keyvault-keys)$/ }, () => ({ path: resolve('src/shims/no-azure.ts') }));
      },
    },
  ],
  banner: {
    // Bundled CommonJS dependencies still call require(); give them one.
    // The version is a banner constant rather than a `define`, on one line
    // marked for release-please, because dist/toil.js is committed: the
    // release PR bumps package.json and this line together (extra-files in
    // release-please-config.json), so the bundle still matches its source and
    // check:dist passes on the release PR without anyone rebuilding it.
    js: `#!/usr/bin/env node\nimport { createRequire as __toilCreateRequire } from 'node:module';\nconst require = __toilCreateRequire(import.meta.url);\nconst __TOIL_VERSION__ = ${JSON.stringify(version)}; // x-release-please-version`,
  },
});
