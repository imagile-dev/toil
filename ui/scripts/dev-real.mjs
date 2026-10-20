// Starts the Toil UI built from this clone against a real GitHub repository, in a
// home folder of its own, so your own ~/.toil and ~/.toil-ui are never read or
// written:
//
//   npm run build -w ui
//   node ui/scripts/dev-real.mjs                         # imagile-dev/toil-sandbox, plus toil-self
//   node ui/scripts/dev-real.mjs --repo you/your-repo --no-self --port 4390
//
// The home is <clone>/.scratch/home (or --home), set up by real-home.mjs: toil's
// config with one read-only GitHub connection and no token, and the dossiers.
// Then it starts toil-ui on loopback with HOME pointed there and the token from
// `gh auth token` (or TOIL_GITHUB_TOKEN, if already set) in toil-ui's environment
// only. `npm run verify:ui` runs the same home through the layout check and,
// with --ask, one Codex question (scripts/verify.mjs). Repo tooling only: nothing
// here ships. A sandbox inside a sandbox, filed in triplicate under scratch.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CODEX_SDK_INSTALL, RealHomeError, codexSdkInstalled, githubToken, prepareRealHome, realHomeEnv, root, toilUi } from './real-home.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? Boolean(args.splice(at, 1)) : false;
};
const take = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`, 'See the comment at the top of ui/scripts/dev-real.mjs.');
  return args.splice(at, 2)[1];
};

function fail(message, fix) {
  process.stderr.write(`dev-real: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}

const repo = take('--repo', 'imagile-dev/toil-sandbox');
const home = resolve(take('--home', join(root, '.scratch', 'home')));
const port = take('--port', '0');
const self = !flag('--no-self');
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --repo <owner/name>, --home <dir>, --port <n> and --no-self.');
if (!existsSync(toilUi)) fail(`${toilUi} isn't built.`, 'Run npm run build -w ui first.');

// The token: in this process's memory and toil-ui's environment, nowhere else.
const gh = githubToken();
if (!gh.token) fail(`couldn't get a GitHub token: ${gh.problem}.`, 'Sign in with gh auth login, or set TOIL_GITHUB_TOKEN for this shell.');
const env = realHomeEnv(home, gh.token);

try {
  prepareRealHome({ home, repo, self, env });
} catch (e) {
  if (e instanceof RealHomeError) fail(e.message, e.fix);
  throw e;
}
if (!codexSdkInstalled()) process.stdout.write(`Codex for Ask: @openai/codex-sdk isn't installed in this clone. To try it: ${CODEX_SDK_INSTALL}\n`);

process.stdout.write(`Home for this run: ${home}\n\n`);
const child = spawn(process.execPath, [toilUi, '--port', port], { env, stdio: 'inherit' });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
