// The No Executables gate (CLAUDE.md, principle 1). It checks what users would
// install, not the dev toolchain:
//   1. package.json declares no runtime dependencies and no install scripts
//   2. the bundle imports nothing but Node built-ins (per esbuild's metafile),
//      no native addon, and child_process only from the reviewed spawners in
//      scripts/spawners.mjs (CLAUDE.md, No Executables)
//   3. the packed tarball contains only the allowlisted files
// Run after `npm run build`.
//
// This is the security review. It finishes in under a second and has never
// once asked for the spreadsheet.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { ENTRIES, LIB } from './entries.mjs';
import { SPAWNERS as ALLOWED } from './spawners.mjs';

const problems = [];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) {
    problems.push(`package.json has ${field}; everything must be bundled into dist/toil-lib.js (move them to devDependencies).`);
  }
}
for (const script of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
  if (pkg.scripts?.[script]) problems.push(`package.json has a "${script}" script; installs must run nothing.`);
}

// esbuild's metafile lists the bundle's real imports; text in strings can't fool it.
const meta = JSON.parse(readFileSync('dist/metafile-esm.json', 'utf8'));
// The one bundle of code; the bin and `./api` are thin entries beside it, checked below.
const output = meta.outputs[LIB];
if (!output) problems.push(`dist/metafile-esm.json has no entry for ${LIB}; run npm run build first.`);
if (Object.keys(meta.outputs).some((out) => out.endsWith('.js') && out !== LIB)) problems.push(`the build emitted more than one bundle (${Object.keys(meta.outputs).join(', ')}); toil is one bundle of code (${LIB}).`);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const specifiers = new Set((output?.imports ?? []).filter((i) => i.external).map((i) => i.path));
for (const spec of specifiers) {
  if (!builtins.has(spec)) problems.push(`bundle imports "${spec}", which is not a Node built-in; it must be bundled or removed.`);
}
// Who imports child_process, per source file, as written (`original`) and as
// resolved. The credential store and the git spawner get the real module. A
// bundled dependency (commander) gets the no-spawn stub. Any other file of
// ours importing it at all is a mistake, stubbed or not.
const SPAWNERS = new Set(ALLOWED);
const SHIM = 'src/shims/no-spawn.ts';
const isChildProcess = (path) => path === 'child_process' || path === 'node:child_process';
const spawners = [];
for (const [file, input] of Object.entries(meta.inputs)) {
  for (const i of input.imports.filter((i) => isChildProcess(i.original ?? i.path))) {
    if (SPAWNERS.has(file) && i.external) spawners.push(file);
    else if (file.startsWith('node_modules/') && i.path === SHIM) continue;
    else problems.push(`${file} imports child_process${i.external ? '' : ' (stubbed)'}; only the reviewed spawners (scripts/spawners.mjs: ${[...SPAWNERS].join(', ')}) may spawn.`);
  }
}
for (const spec of specifiers) {
  if (isChildProcess(spec) && spawners.length === 0) problems.push('bundle imports child_process, but not from a reviewed spawner; the gate cannot tell who spawns.');
}
// The bounded worker's script (src/areas/util/kit/bounded-task.ts) ships inside the
// bundle as a string, so esbuild's metafile for dist/toil.js can't see its imports.
// scripts/gen-worker.mjs writes its own metafile; it gets the same rules, with no
// spawner allowed at all: built-ins only, no child_process, no native addon.
let workerMeta;
try {
  workerMeta = JSON.parse(readFileSync('dist/metafile-worker.json', 'utf8'));
} catch {
  problems.push('dist/metafile-worker.json is missing; run npm run build (scripts/gen-worker.mjs writes it).');
}
const workerSpecifiers = new Set();
if (workerMeta) {
  for (const out of Object.values(workerMeta.outputs)) for (const i of out.imports.filter((i) => i.external)) workerSpecifiers.add(i.path);
  for (const spec of workerSpecifiers) if (!builtins.has(spec)) problems.push(`the worker script imports "${spec}", which is not a Node built-in; it must be bundled or removed.`);
  for (const [file, input] of Object.entries(workerMeta.inputs)) {
    if (file.endsWith('.node')) problems.push(`the worker script includes native addon ${file}.`);
    for (const i of input.imports.filter((i) => isChildProcess(i.original ?? i.path))) {
      if (file.startsWith('node_modules/') && i.path === SHIM) continue;
      problems.push(`${file} imports child_process${i.external ? '' : ' (stubbed)'} into the worker script; the bounded worker may not spawn.`);
    }
  }
}
// The thin entries (scripts/entries.mjs) must be exactly what the build writes: an
// import of the bundle and nothing else, so no code ships outside the files checked above.
for (const [file, content] of Object.entries(ENTRIES)) {
  let actual;
  try {
    actual = readFileSync(file, 'utf8');
  } catch {
    actual = undefined;
  }
  if (actual !== content) problems.push(`${file} isn't the thin entry scripts/entries.mjs defines; run npm run build.`);
}
if (pkg.bin.toil !== 'dist/toil.js') problems.push(`package.json's bin must be dist/toil.js, the thin entry, not ${pkg.bin.toil}.`);
// `@imagile-dev/toil/api` is a thin entry re-exporting the bundle, and its types are declarations only.
const api = pkg.exports?.['./api'];
if (api?.default !== './dist/api.js') problems.push(`package.json exports "./api" must be ./dist/api.js, the thin entry, not ${JSON.stringify(api?.default)}.`);
if (api?.types !== './dist/api.d.ts') problems.push(`package.json exports "./api" must give its types as ./dist/api.d.ts, not ${JSON.stringify(api?.types)}.`);
try {
  if (/^\s*(import|export)\s[^;]*\bfrom\s|\bimport\(|\brequire\(/m.test(readFileSync('dist/api.d.ts', 'utf8'))) problems.push('dist/api.d.ts imports another module; its types must stand alone, since the package has no dependencies to supply them.');
} catch {
  problems.push('dist/api.d.ts is missing; run npm run build.');
}
const bundle = readFileSync(LIB, 'utf8');
if (bundle.includes('process.dlopen')) problems.push('bundle loads a native addon (process.dlopen).');
for (const input of Object.keys(output?.inputs ?? {})) {
  if (input.endsWith('.node')) problems.push(`bundle includes native addon ${input}.`);
}

const [pack] = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' }));
// The bundle, its two thin entries, and the API's declarations.
const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'NOTICE', LIB, ...Object.keys(ENTRIES), 'dist/api.d.ts']);
for (const file of pack.files.map((f) => f.path.replace(/\\/g, '/'))) {
  if (!allowed.has(file)) problems.push(`tarball contains ${file}; only ${[...allowed].join(', ')} may ship.`);
}

if (problems.length > 0) {
  console.error(`check:pure found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:pure ok: no runtime deps or install scripts; bundle imports only ${specifiers.size} Node built-in(s), child_process only from ${[...new Set(spawners)].join(', ') || 'nowhere'}; the worker script imports only ${workerSpecifiers.size} Node built-in(s) and never child_process; tarball is ${pack.files.length} files, ${(pack.unpackedSize / 1024).toFixed(0)} KB unpacked.`);
