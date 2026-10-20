// The isolated home Toil UI runs on real data in, shared by dev-real.mjs (by
// hand) and verify.mjs (`npm run verify:ui`). In <home> it sets up, once:
//   - ~/.toil/config.json with one connection, `github`, to https://api.github.com,
//     writes off. It holds no token.
//   - for GitHub (prepareRealHome), the dossier for a repository (named after
//     it; `sandbox` for imagile-dev/toil-sandbox), and `toil-self` for
//     imagile-dev/toil unless asked not to;
//   - or, for an Azure DevOps Services board (prepareAdoHome), the dossier
//     `ado-board` on the ado-cloud connection toil makes from
//     TOIL_ADO_CLOUD_BASE_URL and TOIL_ADO_CLOUD_PAT, for one project. Nothing
//     about the organization is written to the config file, and writes stay off.
// Dossiers are made through toil's own dossiers commands. The environment it
// hands back points HOME there and carries the GitHub token from `gh auth
// token` (or TOIL_GITHUB_TOKEN, if already set), or the two ADO variables, for
// toil-ui's process only: never written to a file or printed.
// The agent CLI keeps its own sign-in: CODEX_HOME is pointed at the real
// ~/.codex unless already set, since Codex on Windows finds its home from the
// OS rather than USERPROFILE. Repo tooling only: nothing here ships. The
// visitor's badge is issued fresh each morning and collected at the door.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..');
export const toilUi = join(root, 'ui', 'dist', 'server', 'toil-ui.js');
export const toilCli = join(root, 'node_modules', '@imagile-dev', 'toil', 'dist', 'toil.js');

/** A problem setting up the home, with the fix to print under it. */
export class RealHomeError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

/** The GitHub token for this run: TOIL_GITHUB_TOKEN, else `gh auth token`. `problem` says why there is none. */
export function githubToken(env = process.env) {
  if (env.TOIL_GITHUB_TOKEN) return { token: env.TOIL_GITHUB_TOKEN, from: 'TOIL_GITHUB_TOKEN' };
  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (gh.error || gh.status !== 0 || !gh.stdout.trim()) return { problem: gh.error ? `the GitHub CLI isn't installed (${gh.error.message})` : `the GitHub CLI isn't signed in (${(gh.stderr || 'gh auth token printed nothing').trim()})` };
  return { token: gh.stdout.trim(), from: 'gh auth token' };
}

/** Why an ADO run can't start, or null: it needs the organization URL, a token and a project. */
export function adoProblem(env = process.env, project = env.TOIL_ADO_CLOUD_PROJECT) {
  if (!env.TOIL_ADO_CLOUD_BASE_URL || !env.TOIL_ADO_CLOUD_PAT) return "TOIL_ADO_CLOUD_BASE_URL and TOIL_ADO_CLOUD_PAT aren't both set (the organization URL and an organization-scoped token with Work Items (Read))";
  if (!project) return 'no project is named (pass --project "<project>", or set TOIL_ADO_CLOUD_PROJECT)';
  return null;
}

/**
 * toil-ui's environment: HOME in the scratch home, the GitHub token (or, with
 * `ado`, the ado-cloud connection's two variables), Codex's own sign-in, and
 * no other toil or CI variable.
 */
export function realHomeEnv(home, token, base = process.env, { ado = false } = {}) {
  const env = {
    ...base,
    HOME: home,
    USERPROFILE: home,
    ...(token ? { TOIL_GITHUB_TOKEN: token } : {}),
    CODEX_HOME: base.CODEX_HOME ?? join(homedir(), '.codex'),
  };
  // GITHUB_TOKEN and GITHUB_API_URL would be the github connection's CI fallbacks; this run uses the one above.
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_API_URL;
  // SYSTEM_ACCESSTOKEN is ado's CI fallback; this run is not a pipeline.
  delete env.SYSTEM_ACCESSTOKEN;
  // The ado-cloud connection is these two and nothing else: no writes, no project, from the shell.
  const keep = new Set(['TOIL_GITHUB_TOKEN', ...(ado ? ['TOIL_ADO_CLOUD_BASE_URL', 'TOIL_ADO_CLOUD_PAT'] : [])]);
  for (const key of Object.keys(env)) if (key.startsWith('TOIL_') && !keep.has(key) && !key.startsWith('TOIL_UI_')) delete env[key];
  return env;
}

/** The dossier name a repository gets: `sandbox` for the sandbox, else its name made safe. */
export const dossierFor = (name) => (name === 'toil-sandbox' ? 'sandbox' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

const say = (line) => process.stdout.write(`${line}\n`);

/** toil's config in the home: one read-only GitHub connection, written once. */
function writeConfig(home, log) {
  if (!existsSync(toilCli)) throw new RealHomeError(`toil isn't installed at ${toilCli}.`, 'Run npm ci --ignore-scripts at the root of the clone.');
  const config = join(home, '.toil', 'config.json');
  if (existsSync(config)) return;
  mkdirSync(join(home, '.toil'), { recursive: true });
  const content = { version: 2, connections: { github: { area: 'github', baseUrl: 'https://api.github.com', writes: false } }, defaults: { github: { connection: 'github' } } };
  writeFileSync(config, `${JSON.stringify(content, null, 2)}\n`);
  log(`Wrote ${config}: one GitHub connection, writes off, no token.`);
}

/** One toil command in the home, through the toil Toil UI runs on, as its envelope. */
function toilIn(home, env) {
  return (...argv) => {
    const res = spawnSync(process.execPath, [toilCli, ...argv], { env, encoding: 'utf8', cwd: home });
    try {
      return JSON.parse(res.stdout);
    } catch {
      throw new RealHomeError(`toil ${argv.join(' ')} printed no envelope: ${res.stderr.trim() || res.stdout.trim()}`, 'Run it by hand with HOME set to the scratch home to see why.');
    }
  };
}

/** A dossier made or updated with toil's own commands (`link` takes `linkArgs`), then checked. */
function ensureDossier(toil, name, description, linkArgs) {
  if (!toil('dossiers', 'show', name).ok) {
    const init = toil('dossiers', 'init', name, '--description', description);
    if (!init.ok) throw new RealHomeError(`toil dossiers init ${name}: ${init.error.message}`, init.error.fix ?? 'See toil dossiers init --help.');
  }
  const link = toil('dossiers', 'link', name, ...linkArgs, '--replace');
  if (!link.ok) throw new RealHomeError(`toil dossiers link ${name}: ${link.error.message}`, link.error.fix ?? 'See toil dossiers link --help.');
  const check = toil('dossiers', 'check', name);
  if (!check.ok || !check.data.ok) throw new RealHomeError(`toil dossiers check ${name} found problems: ${JSON.stringify(check.data?.problems ?? check.error)}`, 'Fix the dossier in the scratch home, or delete it and run this again.');
}

/**
 * Writes toil's config and a GitHub repository's dossiers into the home.
 * Resolves with the repository's dossier name. Throws a RealHomeError when a
 * step fails.
 */
export function prepareRealHome({ home, repo, self = true, env, log = say }) {
  const [owner, name] = repo.split('/');
  if (!owner || !name || repo.split('/').length !== 2) throw new RealHomeError(`--repo ${repo} isn't owner/name.`, 'Pass it as --repo imagile-dev/toil-sandbox.');
  writeConfig(home, log);
  const toil = toilIn(home, env);
  const dossier = (dossierName, description, repoOwner, repoName) => {
    ensureDossier(toil, dossierName, description, ['github', '--connection', 'github', '--set', `owner=${repoOwner}`, '--set', `repo=${repoName}`]);
    log(`Dossier ${dossierName}: ${repoOwner}/${repoName} on GitHub, checked.`);
  };
  const main = dossierFor(name);
  dossier(main, `${owner}/${name} on GitHub`, owner, name);
  if (self && repo !== 'imagile-dev/toil') dossier('toil-self', 'Toil itself: imagile-dev/toil on GitHub', 'imagile-dev', 'toil');
  return main;
}

/**
 * The board's dossier, `ado-board`, on the ado-cloud connection the env makes,
 * for one project, after `toil connections test` proves the token. Resolves
 * with the dossier name.
 */
export function prepareAdoHome({ home, project, env, log = say }) {
  writeConfig(home, log);
  const toil = toilIn(home, env);
  const test = toil('connections', 'test', 'ado-cloud');
  if (!test.ok || !test.data.authenticated) throw new RealHomeError(`toil couldn't reach the ado-cloud connection: ${test.error?.message ?? 'the token was refused'}`, test.error?.fix ?? 'Check TOIL_ADO_CLOUD_BASE_URL and TOIL_ADO_CLOUD_PAT.');
  ensureDossier(toil, 'ado-board', 'An Azure DevOps Services board, read-only', ['ado-cloud', '--connection', 'ado-cloud', '--set', `project=${project}`]);
  log('Dossier ado-board: the project on Azure DevOps Services, checked.');
  return 'ado-board';
}

/** Whether the Codex SDK resolves from ui/, without loading it. */
export function codexSdkInstalled() {
  const sdk = spawnSync(process.execPath, ['-e', "import('@openai/codex-sdk').then(()=>process.exit(0),()=>process.exit(1))"], { cwd: join(root, 'ui') });
  return sdk.status === 0;
}

export const CODEX_SDK_INSTALL = 'npm install --no-save --ignore-scripts @openai/codex-sdk@0.160.0';
