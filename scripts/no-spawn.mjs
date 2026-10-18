// The esbuild plugin that keeps spawning out of what ships (CLAUDE.md, No
// Executables). Commander imports child_process for external subcommands toil
// never uses; this resolves it to a stub that refuses, so the bundle can't
// spawn. The exceptions are the reviewed list in scripts/spawners.mjs (the OS
// credential store, git, and Windows authentication's SSPI helper), decided by
// the importing file's path, so nothing else gets the real module by importing
// it. Used by tsup.config.ts for dist/toil.js and by scripts/gen-worker.mjs for
// the bounded worker's script; check:pure verifies both from their metafiles.
// One gatekeeper for two doors, so neither can be talked round separately.
import { resolve } from 'node:path';
import { SPAWNERS } from './spawners.mjs';

export const noSpawn = {
  name: 'no-spawn',
  setup(build) {
    const spawners = new Set(SPAWNERS.map((file) => resolve(file)));
    build.onResolve({ filter: /^(node:)?child_process$/ }, (args) =>
      spawners.has(resolve(args.importer)) ? { path: 'node:child_process', external: true } : { path: resolve('src/shims/no-spawn.ts') },
    );
  },
};
