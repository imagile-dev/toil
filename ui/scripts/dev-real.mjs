// Starts the Toil UI built from this clone against a real GitHub repository, in a
// home folder of its own, so your own ~/.toil and ~/.toil-ui are never read or
// written:
//
//   npm run build -w ui
//   node ui/scripts/dev-real.mjs                         # imagile-dev/toil-sandbox, plus toil-self
//   node ui/scripts/dev-real.mjs --repo you/your-repo --no-self --port 4390
//   node ui/scripts/dev-real.mjs --source ado --project "<project>"   # an Azure DevOps Services board
//
// It sets up, once, in <clone>/.scratch/home (or --home):
//   - ~/.toil/config.json with one connection, `github`, to https://api.github.com,
//     writes off. It holds no token.
//   - the dossier for --repo (named after the repository), and `toil-self` for
//     imagile-dev/toil unless --no-self, through toil's own dossiers commands.
// Then it starts toil-ui on loopback with HOME pointed there and the token from
// `gh auth token` (or TOIL_GITHUB_TOKEN, if already set) in toil-ui's environment
// only. The token is never written to a file or printed. The agent CLI keeps its
// own sign-in: CODEX_HOME is pointed at your real ~/.codex unless already set.
//
// With --source ado it reads an Azure DevOps Services board instead (one the
// seed in ui/scripts/ado-seed/ filled, or any other): the dossier `ado-board`
// on the ado-cloud connection toil makes from TOIL_ADO_CLOUD_BASE_URL and
// TOIL_ADO_CLOUD_PAT, which go into toil-ui's environment and nowhere else.
// Nothing about the organization is written to the config file, and writes stay
// off. --project, else TOIL_ADO_CLOUD_PROJECT, names the project; the dossier
// file in the scratch home holds it.
// Repo tooling only: nothing here ships. A sandbox inside a sandbox, filed in
// triplicate under scratch.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
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

const source = take('--source', 'github');
const project = take('--project', process.env.TOIL_ADO_CLOUD_PROJECT);
const repo = take('--repo', 'imagile-dev/toil-sandbox');
const home = resolve(take('--home', join(root, '.scratch', 'home')));
const port = take('--port', '0');
const self = !flag('--no-self');
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --source github|ado, --repo <owner/name>, --project <name>, --home <dir>, --port <n> and --no-self.');
if (!['github', 'ado'].includes(source)) fail(`--source ${source} isn't github or ado.`, 'Pass --source github (the default) or --source ado.');
const ado = source === 'ado';
if (ado && (!process.env.TOIL_ADO_CLOUD_BASE_URL || !process.env.TOIL_ADO_CLOUD_PAT)) fail('--source ado needs TOIL_ADO_CLOUD_BASE_URL and TOIL_ADO_CLOUD_PAT in this shell.', 'Set them to the organization URL and an organization-scoped token with Work Items (Read).');
if (ado && !project) fail('--source ado needs a project.', 'Pass --project "<project>", or set TOIL_ADO_CLOUD_PROJECT.');
const [owner, name] = repo.split('/');
if (!owner || !name || repo.split('/').length !== 2) fail(`--repo ${repo} isn't owner/name.`, 'Pass it as --repo imagile-dev/toil-sandbox.');

const toilUi = join(root, 'ui', 'dist', 'server', 'toil-ui.js');
if (!existsSync(toilUi)) fail(`${toilUi} isn't built.`, 'Run npm run build -w ui first.');
const toilCli = join(root, 'node_modules', '@imagile-dev', 'toil', 'dist', 'toil.js');
if (!existsSync(toilCli)) fail(`toil isn't installed at ${toilCli}.`, 'Run npm ci --ignore-scripts at the root of the clone.');

// The token: in this process's memory and toil-ui's environment, nowhere else.
let token = process.env.TOIL_GITHUB_TOKEN;
if (!token && !ado) {
  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (gh.error || gh.status !== 0) fail(`couldn't get a token from the GitHub CLI: ${gh.error?.message ?? gh.stderr.trim()}`, 'Sign in with gh auth login, or set TOIL_GITHUB_TOKEN for this shell.');
  token = gh.stdout.trim();
}

const realHome = homedir();
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  ...(token ? { TOIL_GITHUB_TOKEN: token } : {}),
  CODEX_HOME: process.env.CODEX_HOME ?? join(realHome, '.codex'),
};
// GITHUB_TOKEN and GITHUB_API_URL would be the github connection's CI fallbacks; this run uses the one above.
delete env.GITHUB_TOKEN;
delete env.GITHUB_API_URL;
// The ado-cloud connection is these two and nothing else: no writes, no project, from the shell.
const keep = new Set(['TOIL_GITHUB_TOKEN', ...(ado ? ['TOIL_ADO_CLOUD_BASE_URL', 'TOIL_ADO_CLOUD_PAT'] : [])]);
for (const key of Object.keys(env)) if (key.startsWith('TOIL_') && !keep.has(key) && !key.startsWith('TOIL_UI_')) delete env[key];
// SYSTEM_ACCESSTOKEN is ado's CI fallback; this run is not a pipeline.
delete env.SYSTEM_ACCESSTOKEN;

// toil's config: one read-only GitHub connection, written once.
const config = join(home, '.toil', 'config.json');
if (!existsSync(config)) {
  mkdirSync(join(home, '.toil'), { recursive: true });
  const content = { version: 2, connections: { github: { area: 'github', baseUrl: 'https://api.github.com', writes: false } }, defaults: { github: { connection: 'github' } } };
  writeFileSync(config, `${JSON.stringify(content, null, 2)}\n`);
  process.stdout.write(`Wrote ${config}: one GitHub connection, writes off, no token.\n`);
}

/** One toil command in the isolated home, through the toil Toil UI runs on. */
function toil(...argv) {
  const res = spawnSync(process.execPath, [toilCli, ...argv], { env, encoding: 'utf8', cwd: home });
  let envelope;
  try {
    envelope = JSON.parse(res.stdout);
  } catch {
    fail(`toil ${argv.join(' ')} printed no envelope: ${res.stderr.trim() || res.stdout.trim()}`, 'Run it by hand with HOME set to the scratch home to see why.');
  }
  return envelope;
}

/** A dossier for one repository, made or updated with toil's own commands. */
function dossier(dossierName, description, repoOwner, repoName) {
  if (!toil('dossiers', 'show', dossierName).ok) {
    const init = toil('dossiers', 'init', dossierName, '--description', description);
    if (!init.ok) fail(`toil dossiers init ${dossierName}: ${init.error.message}`, init.error.fix ?? 'See toil dossiers init --help.');
  }
  const link = toil('dossiers', 'link', dossierName, 'github', '--connection', 'github', '--set', `owner=${repoOwner}`, '--set', `repo=${repoName}`, '--replace');
  if (!link.ok) fail(`toil dossiers link ${dossierName}: ${link.error.message}`, link.error.fix ?? 'See toil dossiers link --help.');
  const check = toil('dossiers', 'check', dossierName);
  if (!check.ok || !check.data.ok) fail(`toil dossiers check ${dossierName} found problems: ${JSON.stringify(check.data?.problems ?? check.error)}`, 'Fix the dossier in the scratch home, or delete it and run this again.');
  process.stdout.write(`Dossier ${dossierName}: ${repoOwner}/${repoName} on GitHub, checked.\n`);
}

/** The board's dossier, on the ado-cloud connection the env makes, for one project. */
function adoDossier() {
  const test = toil('connections', 'test', 'ado-cloud');
  if (!test.ok || !test.data.authenticated) fail(`toil couldn't reach the ado-cloud connection: ${test.error?.message ?? 'the token was refused'}`, test.error?.fix ?? 'Check TOIL_ADO_CLOUD_BASE_URL and TOIL_ADO_CLOUD_PAT.');
  if (!toil('dossiers', 'show', 'ado-board').ok) {
    const init = toil('dossiers', 'init', 'ado-board', '--description', 'An Azure DevOps Services board, read-only');
    if (!init.ok) fail(`toil dossiers init ado-board: ${init.error.message}`, init.error.fix ?? 'See toil dossiers init --help.');
  }
  const link = toil('dossiers', 'link', 'ado-board', 'ado-cloud', '--connection', 'ado-cloud', '--set', `project=${project}`, '--replace');
  if (!link.ok) fail(`toil dossiers link ado-board: ${link.error.message}`, link.error.fix ?? 'See toil dossiers link --help.');
  const check = toil('dossiers', 'check', 'ado-board');
  if (!check.ok || !check.data.ok) fail(`toil dossiers check ado-board found problems: ${JSON.stringify(check.data?.problems ?? check.error)}`, 'Fix the dossier in the scratch home, or delete it and run this again.');
  process.stdout.write('Dossier ado-board: the project on Azure DevOps Services, checked.\n');
}

if (ado) adoDossier();
else {
  const dossierName = name === 'toil-sandbox' ? 'sandbox' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  dossier(dossierName, `${owner}/${name} on GitHub`, owner, name);
  if (self && repo !== 'imagile-dev/toil') dossier('toil-self', 'Toil itself: imagile-dev/toil on GitHub', 'imagile-dev', 'toil');
}

const sdk = spawnSync(process.execPath, ['-e', "import('@openai/codex-sdk').then(()=>process.exit(0),()=>process.exit(1))"], { cwd: join(root, 'ui') });
if (sdk.status !== 0) process.stdout.write('Codex for Ask: @openai/codex-sdk isn\'t installed in this clone. To try it: npm install --no-save --ignore-scripts @openai/codex-sdk@0.160.0\n');

process.stdout.write(`Home for this run: ${home}\n\n`);
const child = spawn(process.execPath, [toilUi, '--port', port], { env, stdio: 'inherit' });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
