// The No Executables gate for @imagile-dev/toil-ui, its own check:pure
// (CLAUDE.md, principle 1; #206, Packaging and release). Run after
// `npm run build`. It checks what users would install:
//   1. package.json: no install scripts, @imagile-dev/toil as the one
//      dependency, pinned exactly to this checkout's toil (scripts/package-rules.mjs)
//   2. the server bundle imports only Node built-ins and @imagile-dev/toil,
//      child_process only from the one install module the npm exception allows
//      (SPAWNERS, #344), and holds no native addon, per the bundler's own record
//      (dist/metafile-server.json, written by vite.server.config.ts)
//   3. the packed tarball holds only the allowlisted files, and all the required ones
// One page, initialled in every box, and nobody had to be asked to sign it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { REQUIRED, SPAWNERS, allowed, npmCli, packageProblems } from './package-rules.mjs';

const ui = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ui, 'package.json'), 'utf8'));
const root = JSON.parse(readFileSync(join(ui, '..', 'package.json'), 'utf8'));
const problems = packageProblems(pkg, root.version);

let meta;
try {
  meta = JSON.parse(readFileSync(join(ui, 'dist', 'metafile-server.json'), 'utf8'));
} catch {
  problems.push('dist/metafile-server.json is missing; run npm run build first.');
}
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
if (meta) {
  if (JSON.stringify(meta.outputs) !== JSON.stringify(['toil-ui.js'])) problems.push(`the server build emitted ${JSON.stringify(meta.outputs)}; it must be one file, toil-ui.js.`);
  const spawners = meta.spawners ?? [];
  const extra = spawners.filter((m) => !SPAWNERS.includes(m));
  if (extra.length) problems.push(`${extra.join(', ')} import${extra.length === 1 ? 's' : ''} child_process; only ${SPAWNERS.join(', ')} may, to run npm for Install (#344).`);
  for (const spec of meta.imports) {
    if ((spec === 'child_process' || spec === 'node:child_process') && !spawners.length) problems.push('the server imports child_process, but the bundle records no module that does; rebuild with npm run build.');
    else if (spec === 'child_process' || spec === 'node:child_process') continue;
    else if (!builtins.has(spec) && spec !== '@imagile-dev/toil/api') problems.push(`the server imports "${spec}", which is neither a Node built-in nor @imagile-dev/toil/api; bundle it or remove it.`);
  }
  for (const input of meta.inputs) if (input.endsWith('.node')) problems.push(`the server bundles native addon ${input}.`);
}
try {
  if (!readFileSync(join(ui, 'dist', 'server', 'toil-ui.js'), 'utf8').startsWith('#!/usr/bin/env node\n')) problems.push('dist/server/toil-ui.js has no #!/usr/bin/env node line, so the bin would not run.');
} catch {
  problems.push('dist/server/toil-ui.js is missing; run npm run build first.');
}

const out = execFileSync(process.execPath, [npmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ui, encoding: 'utf8' });
const [pack] = JSON.parse(out);
const files = pack.files.map((f) => f.path.replace(/\\/g, '/'));
for (const f of files) if (!allowed(f)) problems.push(`the tarball holds ${f}; only the server, the built app, package.json, README.md, LICENSE and NOTICE may ship.`);
for (const f of REQUIRED) if (!files.includes(f)) problems.push(`the tarball is missing ${f}${f.startsWith('dist/') ? '; run npm run build first' : ''}.`);

if (problems.length) {
  console.error(`check:package found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:package ok: no install scripts; @imagile-dev/toil ${root.version} is the one dependency; the server imports only ${meta.imports.length - 1} Node built-in(s) and @imagile-dev/toil/api, child_process from ${(meta.spawners ?? []).join(', ') || 'nowhere'} alone; the tarball is ${files.length} files, ${(pack.unpackedSize / 1024).toFixed(0)} KB unpacked.`);
