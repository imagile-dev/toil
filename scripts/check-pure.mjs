// The No Executables gate (CLAUDE.md, principle 1). It checks what users would
// install, not the dev toolchain:
//   1. package.json declares no runtime dependencies and no install scripts
//   2. the bundle imports nothing but Node built-ins (per esbuild's metafile),
//      no native addon, and child_process only from src/core/keychain.ts, the
//      OS credential store, and src/core/git.ts, the git spawner (CLAUDE.md,
//      No Executables)
//   3. the packed tarball contains only the allowlisted files
// Run after `npm run build`.
//
// This is the security review. It finishes in under a second and has never
// once asked for the spreadsheet.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

const problems = [];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) {
    problems.push(`package.json has ${field}; everything must be bundled into dist/toil.js (move them to devDependencies).`);
  }
}
for (const script of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
  if (pkg.scripts?.[script]) problems.push(`package.json has a "${script}" script; installs must run nothing.`);
}

// esbuild's metafile lists the bundle's real imports; text in strings can't fool it.
const meta = JSON.parse(readFileSync('dist/metafile-esm.json', 'utf8'));
const output = meta.outputs[pkg.bin.toil];
if (!output) problems.push(`dist/metafile-esm.json has no entry for ${pkg.bin.toil}; run npm run build first.`);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const specifiers = new Set((output?.imports ?? []).filter((i) => i.external).map((i) => i.path));
for (const spec of specifiers) {
  if (!builtins.has(spec)) problems.push(`bundle imports "${spec}", which is not a Node built-in; it must be bundled or removed.`);
}
// Who imports child_process, per source file, as written (`original`) and as
// resolved. The credential store and the git spawner get the real module. A
// bundled dependency (commander) gets the no-spawn stub. Any other file of
// ours importing it at all is a mistake, stubbed or not.
const SPAWNERS = new Set(['src/core/keychain.ts', 'src/core/git.ts']);
const SHIM = 'src/shims/no-spawn.ts';
const isChildProcess = (path) => path === 'child_process' || path === 'node:child_process';
const spawners = [];
for (const [file, input] of Object.entries(meta.inputs)) {
  for (const i of input.imports.filter((i) => isChildProcess(i.original ?? i.path))) {
    if (SPAWNERS.has(file) && i.external) spawners.push(file);
    else if (file.startsWith('node_modules/') && i.path === SHIM) continue;
    else problems.push(`${file} imports child_process${i.external ? '' : ' (stubbed)'}; only ${[...SPAWNERS].join(' and ')} (the OS credential store and git) may spawn.`);
  }
}
for (const spec of specifiers) {
  if (isChildProcess(spec) && spawners.length === 0) problems.push('bundle imports child_process, but not from the credential store or git; the gate cannot tell who spawns.');
}
const bundle = readFileSync(pkg.bin.toil, 'utf8');
if (bundle.includes('process.dlopen')) problems.push('bundle loads a native addon (process.dlopen).');
for (const input of Object.keys(output?.inputs ?? {})) {
  if (input.endsWith('.node')) problems.push(`bundle includes native addon ${input}.`);
}

const [pack] = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' }));
const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'NOTICE', pkg.bin.toil]);
for (const file of pack.files.map((f) => f.path.replace(/\\/g, '/'))) {
  if (!allowed.has(file)) problems.push(`tarball contains ${file}; only ${[...allowed].join(', ')} may ship.`);
}

if (problems.length > 0) {
  console.error(`check:pure found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:pure ok: no runtime deps or install scripts; bundle imports only ${specifiers.size} Node built-in(s), child_process only from ${[...new Set(spawners)].join(', ') || 'nowhere'}; tarball is ${pack.files.length} files, ${(pack.unpackedSize / 1024).toFixed(0)} KB unpacked.`);
