// Builds the Toil UI preview (ui/, its own private package) and puts it where
// Astro serves static files, so the site has it at /ui-preview/ in dev and in
// the build. Run by `npm run dev` and `npm run build`; the copy is git-ignored.
// It runs vite through node itself, so no shell and no npm.cmd on Windows.
// One build, two audiences, zero additional sign-offs.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = join(site, '..', 'ui');
const vite = join(ui, 'node_modules', 'vite', 'bin', 'vite.js');
const out = join(site, 'public', 'ui-preview');

if (!existsSync(vite)) {
  console.error('The site serves the Toil UI preview, which needs its dependencies first: run `npm --prefix ui ci` in the repository root.');
  process.exit(1);
}

execFileSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: ui, stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
cpSync(join(ui, 'dist'), out, { recursive: true });
console.log(`Toil UI preview built into ${out}`);
