// Starts the Toil UI built from this clone against your own home: your
// ~/.toil config, connections, credential store entries and dossiers, as they
// are. dev-real.mjs is the one to use for a clean, throwaway home; this one is
// for looking around your own work on the code you're about to ship.
//
//   node ui/scripts/dev-mine.mjs                 # builds toil and Toil UI, then starts it
//   node ui/scripts/dev-mine.mjs --no-build      # starts the last build
//   node ui/scripts/dev-mine.mjs --port 4390
//
// Nothing here writes to ~/.toil: it reads what's there through toil's own
// commands, the same as the published toil-ui would. The environment is the
// shell's, so TOIL_* variables (an env-only `ado` connection, say) apply as they
// would to toil typed by hand. Claude Code's access token is passed to toil-ui's
// process for Ask when it's still fresh, never refreshed or written (real-home.mjs).
//
// Toil UI and the toil it calls both run on toil built from this checkout into
// .scratch/toil (buildToil, local-toil-hook.mjs), never on the published toil
// ui/package.json pins. Repo tooling only: nothing here ships. Visitors are
// asked to sign in at reception, which in this case is their own desk.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { RealHomeError, buildToil, claudeSignIn, root, toilUi, toilUiNodeArgs } from './real-home.mjs';
import { npmCli } from './package-rules.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? Boolean(args.splice(at, 1)) : false;
};
const take = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`, 'See the comment at the top of ui/scripts/dev-mine.mjs.');
  return args.splice(at, 2)[1];
};

function fail(message, fix) {
  process.stderr.write(`dev-mine: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}

const build = !flag('--no-build');
const port = take('--port', '0');
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --no-build and --port <n>.');

let toil;
try {
  toil = buildToil({ build });
} catch (e) {
  if (e instanceof RealHomeError) fail(e.message, e.fix);
  throw e;
}
if (build || !existsSync(toilUi)) {
  const res = spawnSync(process.execPath, [npmCli(), 'run', 'build', '-w', 'ui'], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) fail('npm run build -w ui failed.', 'Fix the build error above, then run this again.');
}

const env = { ...process.env };
const claude = claudeSignIn();
if (claude.token) env.CLAUDE_CODE_OAUTH_TOKEN = claude.token;
else if (claude.problem) process.stdout.write(`Claude for Ask: ${claude.problem}. Run claude once in a terminal so it refreshes its own sign-in, then start this again.\n`);

process.stdout.write(`Toil UI runs on ${toil.describe}, against your own ~/.toil.\n\n`);
const child = spawn(process.execPath, [...toilUiNodeArgs, toilUi, '--port', port], { env, stdio: 'inherit' });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
