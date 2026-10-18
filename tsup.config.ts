import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';
import { ENTRIES } from './scripts/entries.mjs';
import { noSpawn } from './scripts/no-spawn.mjs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// The commit this bundle is built from, for `toil version`'s `commit`: TOIL_BUILD_COMMIT
// when CI names it, otherwise git's HEAD, otherwise null (no git, or not a checkout).
// It sits on its own marked line because a bundle can't hold the hash of the commit
// that contains it: check:dist compares the committed bundle with a rebuild, so it
// sets that one line aside (scripts/check-dist.mjs, COMMIT_LINE).
const commit = ((): string | null => {
  const named = process.env.TOIL_BUILD_COMMIT?.trim().toLowerCase();
  if (named) return /^[0-9a-f]{40}$/.test(named) ? named : null;
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  const sha = head.status === 0 ? head.stdout.trim() : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
})();

// One self-contained ESM bundle of code, dist/toil-lib.js: every dependency is
// bundled in, so the published package has no runtime dependencies and nothing
// for npm to install or build. Loading it runs nothing; the two thin entries
// beside it (scripts/entries.mjs), written once it's built, decide what runs.
export default defineConfig({
  entry: { 'toil-lib': 'src/cli.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  // The types for `@imagile-dev/toil/api` (src/api.ts), beside its thin entry dist/api.js.
  dts: { entry: { api: 'src/api.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
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
  // dist/toil.js (the bin) and dist/api.js (`./api`), a line or two each.
  onSuccess: async () => {
    for (const [path, content] of Object.entries(ENTRIES)) writeFileSync(path, content, { mode: 0o755 });
  },
  banner: {
    // Bundled CommonJS dependencies still call require(); give them one.
    // The version is a banner constant rather than a `define`, on one line
    // marked for release-please, because dist/toil-lib.js is committed: the
    // release PR bumps package.json and this line together (extra-files in
    // release-please-config.json), so the bundle still matches its source and
    // check:dist passes on the release PR without anyone rebuilding it.
    js: `import { createRequire as __toilCreateRequire } from 'node:module';\nconst require = __toilCreateRequire(import.meta.url);\nconst __TOIL_VERSION__ = ${JSON.stringify(version)}; // x-release-please-version\nconst __TOIL_COMMIT__ = ${JSON.stringify(commit)}; // toil-build-commit`,
  },
});
