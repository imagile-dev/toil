// Builds the Toil UI preview (ui/, the root's npm workspace) and puts it where
// Astro serves static files, so the site has it at /ui/app/ in dev and in the
// build, where the showcase at /ui/ frames it (#374). Run by `npm run dev` and `npm run build`; the copy is git-ignored.
// It runs vite through node itself, so no shell and no npm.cmd on Windows.
// One build, two audiences, zero additional sign-offs.

import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = join(site, '..', 'ui');
const out = join(site, 'public', 'ui', 'app');

// ui/ is a workspace, so its vite may be hoisted to the root's node_modules or kept in its own.
let vite;
try {
  vite = join(dirname(createRequire(join(ui, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
} catch {
  console.error('The site serves the Toil UI preview, which needs its dependencies first: run `npm ci --ignore-scripts` in the repository root.');
  process.exit(1);
}

// The default mode is the preview build (dist/preview/); `--mode app` is the local app's (ui/vite.config.ts).
execFileSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: ui, stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
cpSync(join(ui, 'dist', 'preview'), out, { recursive: true });
console.log(`Toil UI preview built into ${out}`);
