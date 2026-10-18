// Sets up toil from a clone in one command, on Windows, macOS and Linux:
//
//   git clone https://github.com/imagile-dev/toil.git && cd toil && node scripts/setup.mjs
//
//   --skip-build   use the committed dist/toil.js (the last release) as it is:
//                  no npm install, no build
//   --no-alias     don't touch the shell profile
//
// It checks Node, builds what's on this checkout (npm ci --ignore-scripts, then
// npm run build), adds the `toil` alias with `toil setup alias`, and prints
// `toil version`. Running it again is safe: the build is repeatable and the
// alias is updated in place.
//
// Repo tooling only. It spawns npm and node, so it lives in scripts/, which is
// neither in package.json `files` nor in the bundle check:pure inspects.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN = [24, 14];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist', 'toil.js');
const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--skip-build' && a !== '--no-alias');
const skipBuild = args.includes('--skip-build');
const noAlias = args.includes('--no-alias');

function fail(message, fix) {
  console.error(`\nsetup failed: ${message}`);
  if (fix) console.error(`Fix: ${fix}`);
  process.exit(1);
}

if (unknown.length > 0) fail(`unknown option ${unknown.join(' ')}.`, 'Use --skip-build, --no-alias, both, or neither.');

// 1. Node.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  fail(`toil needs Node.js ${MIN.join('.')} or later, and this is ${process.versions.node}.`, `Install Node.js ${MIN.join('.')} or later from https://nodejs.org, then run node scripts/setup.mjs again.`);
}

// Runs a step with its output streamed. npm is npm.cmd on Windows, which only a shell runs;
// every argument here is fixed, so the shell sees nothing from outside.
function run(label, command, commandArgs, { shell = false } = {}) {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  const result = shell
    ? spawnSync([command, ...commandArgs].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) fail(`${label} didn't start (${result.error.message}).`, `Check that ${command} is on PATH.`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status}.`, 'Read the output above, fix what it names, and run node scripts/setup.mjs again.');
}

// Runs the bundle and returns its parsed envelope (stdout), or fails plainly.
function toil(toilArgs) {
  const result = spawnSync(process.execPath, [bundle, ...toilArgs], { cwd: root, encoding: 'utf8' });
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`node dist/toil.js ${toilArgs.join(' ')} printed no envelope.${result.stderr ? `\n${result.stderr.trim()}` : ''}`, 'Run node scripts/setup.mjs again without --skip-build to rebuild dist/toil.js.');
  }
}

// 2. Build.
const win = process.platform === 'win32';
if (skipBuild) {
  console.log('Skipping the build: using the committed dist/toil.js, the last released toil.');
} else {
  run('npm ci', 'npm', ['ci', '--ignore-scripts'], { shell: win });
  run('npm run build', 'npm', ['run', 'build'], { shell: win });
}
if (!existsSync(bundle)) fail('dist/toil.js is missing.', 'Run this from a clone of https://github.com/imagile-dev/toil, without --skip-build.');

// 3. Alias. `setup alias` picks the shell itself (SHELL, else PowerShell on
// Windows); only PowerShell needs its profile path, which it can't work out, so
// ask PowerShell for $PROFILE only when setup alias says that's what's missing.
function powershellProfile() {
  // PowerShell 7 puts its own folder on PSModulePath; otherwise it's Windows PowerShell.
  const pwsh = /[\\/]PowerShell[\\/]7/i.test(process.env.PSModulePath ?? '') ? 'pwsh' : 'powershell';
  const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE'], { encoding: 'utf8' });
  const path = result.stdout?.trim();
  if (result.status !== 0 || !path) fail(`couldn't ask ${pwsh} for $PROFILE.`, 'In the PowerShell you use, run: node dist/toil.js setup alias --profile $PROFILE');
  return path;
}

if (noAlias) {
  console.log('\nSkipping the alias (--no-alias).');
} else {
  console.log('\n> node dist/toil.js setup alias');
  let out = toil(['setup', 'alias']);
  if (!out.ok && /PowerShell/.test(out.error?.message ?? '')) {
    const profile = powershellProfile();
    console.log(`> node dist/toil.js setup alias --profile ${profile}`);
    out = toil(['setup', 'alias', '--profile', profile]);
  }
  if (!out.ok) fail(out.error?.message ?? 'setup alias failed.', out.error?.fix);
  console.log(JSON.stringify(out.data, null, 2));
}

// 4. Done.
console.log('\n> node dist/toil.js version');
const version = toil(['version']);
if (!version.ok) fail(version.error?.message ?? 'toil version failed.', version.error?.fix);
console.log(JSON.stringify(version.data, null, 2));
if (!skipBuild) console.log('\ndist/ now holds this checkout\'s build. Run git checkout -- dist/ before git pull, then run this again.');
console.log(noAlias ? '\nNext: run node dist/toil.js skill install --allow-write' : '\nNext: open a new terminal, then run toil skill install --allow-write');
