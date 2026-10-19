import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The toil-ui bin: ui/server/main.ts bundled for Node into one file,
// dist/server/toil-ui.js, with the preview's fixtures inside it for --sample.
// Everything is bundled except Node's built-ins and @imagile-dev/toil, the one
// runtime dependency. The `imports` plugin records what the bundle imports, as
// the bundler resolved it, into dist/metafile-server.json, which
// scripts/check-package.mjs reads (never a text scan of the output). The
// bundle declares its own imports, and the inspector checks the declaration
// against the bundler's receipt.

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as { version: string };
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const isExternal = (id: string) => builtins.has(id) || id === '@imagile-dev/toil' || id.startsWith('@imagile-dev/toil/');

function imports(): Plugin {
  const modules = new Set<string>();
  return {
    name: 'toil-ui-server-imports',
    moduleParsed(info) {
      modules.add(info.id);
    },
    generateBundle(_options, bundle) {
      const external = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') for (const id of [...chunk.imports, ...chunk.dynamicImports]) if (!bundle[id]) external.add(id);
      }
      mkdirSync(join(here, 'dist'), { recursive: true });
      writeFileSync(
        join(here, 'dist', 'metafile-server.json'),
        `${JSON.stringify({ outputs: Object.keys(bundle), imports: [...external].sort(), inputs: [...modules].map((m) => relative(join(here, '..'), m).replace(/\\/g, '/')).sort() }, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  define: { __TOIL_UI_VERSION__: JSON.stringify(pkg.version) },
  plugins: [imports()],
  ssr: { noExternal: true, external: ['@imagile-dev/toil'] },
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: {
      external: isExternal,
      output: { entryFileNames: 'toil-ui.js', banner: '#!/usr/bin/env node' },
    },
  },
});
