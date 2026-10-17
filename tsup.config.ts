import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

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
  clean: true,
  shims: false,
  // The purity gate reads real imports from here rather than scanning text.
  metafile: true,
  // Keep `node:` specifiers as written. tsup otherwise rewrites them to bare
  // externals in its first plugin, before the no-spawn stub below can see them.
  removeNodeProtocol: false,
  esbuildPlugins: [
    {
      // Commander imports child_process for external subcommands toil never
      // uses; resolve it to a stub that refuses, so the bundle can't spawn.
      // The two exceptions are the OS credential store (src/core/keychain.ts)
      // and git (src/core/git.ts), decided by the importing file's path, so
      // nothing else gets the real module by importing it. check:pure
      // verifies the same from the metafile.
      name: 'no-spawn',
      setup(build) {
        const spawners = new Set([resolve('src/core/keychain.ts'), resolve('src/core/git.ts')]);
        build.onResolve({ filter: /^(node:)?child_process$/ }, (args) =>
          spawners.has(resolve(args.importer)) ? { path: 'node:child_process', external: true } : { path: resolve('src/shims/no-spawn.ts') },
        );
      },
    },
  ],
  define: { __TOIL_VERSION__: JSON.stringify(version) },
  banner: {
    // Bundled CommonJS dependencies still call require(); give them one.
    js: "#!/usr/bin/env node\nimport { createRequire as __toilCreateRequire } from 'node:module';\nconst require = __toilCreateRequire(import.meta.url);",
  },
});
