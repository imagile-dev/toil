import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig, Settings, Source } from '../src/core/config.js';
import { forwardSlashes } from '../src/core/files.js';
import { commands, areas } from '../src/registry.js';
import { apply, finish, initialState, reduce, render, top, type MenuState } from '../src/welcome/menu.js';
import type { WelcomeData } from '../src/welcome/screens.js';
import type { Run, StepResult } from '../src/welcome/view.js';
import { aliasFor, discovered, writesBindings, DISCOVERY, findingSection, groupFindings, handOffPrompt, nameFromFolder, onHost, whyApplies, writesTargets } from '../src/welcome/views/dossiers.js';
import { JIRA, routes as jiraRoutes } from './fixtures/jira.fixture.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { dossierDisk, type DossierDisk } from './harness/dossiers.js';

/**
 * The Dossiers menu module (#56), driven as data through the menu's reducer,
 * with every command it asks for run for real against a temp home and
 * workspace: the create wizard over two clones, the writes confirmation,
 * review and fix, edit through the save screen, export, import with the
 * connections it names, the folder screen, delete and the hand-off.
 */

type K = string | { name: string };
const keyOf = (k: K) => (typeof k === 'string' ? (k.length === 1 ? { sequence: k, name: k === ' ' ? 'space' : k } : { name: k }) : k);
const press = (state: MenuState, d: WelcomeData, ...keys: K[]) => keys.reduce((s, k) => reduce(s, keyOf(k), d), state);
const type = (state: MenuState, d: WelcomeData, text: string) => press(state, d, ...[...text]);
const clear = (state: MenuState, d: WelcomeData, n = 40) => press(state, d, ...Array<K>(n).fill('backspace'));
const where = (s: MenuState) => top(s).view;
const steps = (s: MenuState) => s.pending?.steps.map((x) => x.args);
const settled: MenuState = { ...initialState, session: { health: { jira: { ok: true, live: true }, sonar: { ok: true, live: true } } } };
const plain = { colorDepth: 1, unicode: true } as const;
const screen = (s: MenuState, d: WelcomeData) => render(s, plain, d).join('\n');

function configOf(extra: Record<string, Settings & { area: string }> = {}): ResolvedConfig {
  const connections: Record<string, Settings & { area: string }> = {
    jira: { area: 'jira', baseUrl: JIRA, apiToken: 'test-token', writes: true },
    sonar: { area: 'sonar', baseUrl: 'https://sonar.imagile.dev', token: 't' },
    ...extra,
  };
  const sources: Record<string, Source> = {};
  for (const [name, conn] of Object.entries(connections)) for (const key of Object.keys(conn)) sources[`${name}.${key}`] = key === 'apiToken' || key === 'token' ? 'env' : 'global';
  return { connections, defaults: { jira: { connection: 'jira' }, sonar: { connection: 'sonar' } }, sources, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
}

function data(config: ResolvedConfig, folder: WelcomeData['folder'] = { cwd: '/work' }): WelcomeData {
  return {
    version: '0.0.0-test',
    node: '24.14.0',
    platform: 'linux x64',
    configPath: '/home/test/.toil/config.json',
    configExists: true,
    config,
    areas: areas.map((a) => ({ name: a.name, description: a.description, signsIn: a.secrets.length > 0, live: false, configurable: Object.keys(a.connection.shape).length > 0, context: Object.keys(a.context), checksDossier: commands.some((c) => c.path[0] === a.name && c.path[1] === 'check-dossier') })),
    mcpAreas: ['dossiers', 'jira', 'repos', 'sonar'],
    launch: { command: 'toil', args: [] },
    folder,
  };
}

const disks: DossierDisk[] = [];
afterEach(() => {
  for (const d of disks.splice(0)) d.cleanup();
});
function disk(files: Record<string, unknown> = {}): DossierDisk {
  const d = dossierDisk(files);
  disks.push(d);
  return d;
}

/** A clone under the workspace, whose origin carries a token the dossier must never see. */
function clone(d: DossierDisk, name: string): string {
  d.write(`work/${name}/.git/HEAD`, 'ref: refs/heads/main\n');
  d.write(`work/${name}/.git/refs/heads/main`, `${'a'.repeat(40)}\n`);
  d.write(`work/${name}/.git/config`, `[remote "origin"]\n\turl = https://ci:t0ken@git.imagile.dev/pay/${name}.git\n`);
  return join(d.workspace, name);
}

const dossierAreas = areas.map((a) => ({ name: a.name, context: Object.keys(a.context) }));

/** What the loop does with a pending run: each step as the real CLI would, then `finish`. */
async function perform(state: MenuState, d: DossierDisk, config: ResolvedConfig, workspace?: string): Promise<MenuState> {
  const run: Run = state.pending!;
  const results: StepResult[] = [];
  for (const step of run.steps) {
    const { context } = testContext({ routes: jiraRoutes });
    const r = await runCli(step.args, { commands, context: { ...context, config, dossiers: d.catalog(config, { areas: dossierAreas, ...(workspace ? { workspace } : {}) }) } });
    expect(r.envelope, r.stdout + r.stderr).toBeDefined();
    results.push({ args: step.args, envelope: r.envelope! });
    if (!r.envelope!.ok && !run.keepGoing) break;
  }
  return finish(state, results);
}

const file = (d: DossierDisk, name: string) => JSON.parse(readFileSync(join(d.home, '.toil', 'dossiers', `${name}.json`), 'utf8')) as Record<string, unknown>;

describe('the Dossiers module', () => {
  it('sits on home after Agent skills', () => {
    const c = configOf();
    expect(where(press(settled, data(c), '6'))).toBe('dossiers');
  });

  it('creates a multi-repo dossier through the six steps, every one a real command, and asks before binding to a connection with writes on', async () => {
    const d = disk();
    const api = clone(d, 'payments-api');
    const ledger = clone(d, 'ledger-svc');
    const c = configOf();
    const w = data(c);

    // Step 1: the name, prefilled from the folder.
    let s = press(settled, w, '6', '3');
    expect(where(s)).toBe('dossier-new');
    expect(screen(s, w)).toMatch(/Step 1 of 6: name[\s\S]*Dossier name: work/);
    s = press(type(clear(s, w), w, 'payments'), w, 'return');
    expect(steps(s)).toEqual([['dossiers', 'init', 'payments'], ['dossiers', 'show', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');

    // Step 2: repos scan, then tick both.
    expect(where(s)).toBe('dossier-scan');
    s = press(s, w, 'return');
    expect(steps(s)).toEqual([['repos', 'scan']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-repos');
    s = press(s, w, ' ', 'down', ' ', 'return');
    expect(steps(s)).toEqual([['dossiers', 'add-repo', 'payments', forwardSlashes(ledger)], ['dossiers', 'add-repo', 'payments', forwardSlashes(api)], ['dossiers', 'show', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');

    // Step 3: areas you have connections for; jira's only connection has writes on.
    expect(where(s)).toBe('dossier-new-areas');
    expect(screen(s, w)).toContain('Step 3 of 6: areas');
    s = press(s, w, 'return');
    expect(top(s)).toMatchObject({ view: 'dossier-connection', params: { area: 'jira' } });
    s = press(s, w, 'return');
    expect(where(s)).toBe('dossier-confirm');
    expect(s.pending).toBeUndefined();
    expect(screen(s, w)).toMatch(/jira has writes on[\s\S]*\$ toil dossiers link payments jira --connection jira/);
    const wrong = press(type(s, w, 'jir'), w, 'return');
    expect(top(wrong).error).toContain("isn't");
    expect(wrong.pending).toBeUndefined();
    s = press(type(s, w, 'jira'), w, 'return');
    expect(steps(s)).toEqual([['dossiers', 'link', 'payments', 'jira', '--connection', 'jira'], ['dossiers', 'show', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');

    // Step 4: discovery through the dossier's own binding, as checkboxes.
    expect(where(s)).toBe('dossier-discover-start');
    s = press(s, w, 'return');
    expect(steps(s)).toEqual([['jira', 'issue', 'fields', '--discover', '--custom-only', '--dossier', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-discover');
    expect(screen(s, w)).toContain('Story Points');
    s = press(s, w, ' ', 'return');
    expect(steps(s)).toEqual([['dossiers', 'field', 'payments', 'jira', 'storyPoints', 'customfield_10016'], ['dossiers', 'show', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-new-areas');

    // Step 5: an environment, its area, its connection, then a value.
    s = press(s, w, 'up', 'return');
    expect(where(s)).toBe('dossier-new-envs');
    s = press(type(press(s, w, 'return'), w, 'prod'), w, 'return');
    expect(where(s)).toBe('dossier-area-pick');
    // Areas with a connection come first: sonar, now jira is linked elsewhere only for no env.
    const pickSonar = (state: MenuState) => {
      let at = state;
      for (let i = 0; i < 60; i++) {
        const label = screen(at, w).split('\n').find((l) => l.includes('▸'));
        if (label?.includes(' sonar ')) return at;
        at = press(at, w, 'down');
      }
      throw new Error('no sonar row');
    };
    s = press(pickSonar(s), w, 'return');
    expect(top(s)).toMatchObject({ view: 'dossier-connection', params: { area: 'sonar', env: 'prod', first: '1' } });
    s = press(s, w, 'return');
    // Read only, so no confirmation; the first environment becomes the default.
    expect(steps(s)).toEqual([['dossiers', 'env', 'payments', 'prod', 'sonar', '--connection', 'sonar', '--default'], ['dossiers', 'show', 'payments']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(top(s)).toMatchObject({ view: 'dossier-set', params: { env: 'prod', area: 'sonar' } });
    s = press(type(s, w, 'project=pay-api'), w, 'return');
    expect(steps(s)?.[0]).toEqual(['dossiers', 'env', 'payments', 'prod', 'sonar', '--set', 'project=pay-api']);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-new-envs');

    // Step 6: show and check, then the dossier's own screen.
    s = press(s, w, 'down', 'return');
    expect(steps(s)).toEqual([['dossiers', 'show', 'payments'], ['dossiers', 'check', 'payments']]);
    s = await perform(s, d, c);
    expect(screen(s, w)).toContain('payments checks out');
    s = press(s, w, 'return');
    expect(s.stack.map((f) => f.view)).toEqual(['home', 'dossiers', 'dossier']);
    expect(screen(s, w)).toMatch(/Repos \(2\)[\s\S]*ledger-svc[\s\S]*payments-api/);

    const saved = file(d, 'payments');
    expect(saved).toMatchObject({ name: 'payments', env: 'prod', jira: { connection: 'jira', fields: { storyPoints: 'customfield_10016' } }, environments: { prod: { sonar: { connection: 'sonar', project: 'pay-api' } } } });
    expect(JSON.stringify(saved)).not.toContain('t0ken');
  });

  it('reviews a dossier, groups what it finds, and fixes a missing connection in place', async () => {
    const d = disk({ 'home/.toil/dossiers/team.json': { name: 'team', repos: [], sonar: { connection: 'old-sonar' }, wiki: { space: 'X' } } });
    const c = configOf();
    const w = data(c);
    let s = press(settled, w, '6', '2');
    s = press(await perform(s, d, c), w, 'return', 'return');
    expect(steps(s)).toEqual([['dossiers', 'show', 'team']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier');
    s = press(s, w, 'return');
    expect(steps(s)).toEqual([['dossiers', 'check', 'team']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-review');
    const text = screen(s, w);
    expect(text).toMatch(/Connections[\s\S]*DOSSIER_UNKNOWN_CONNECTION[\s\S]*Unknown sections[\s\S]*DOSSIER_UNKNOWN_SECTION/);
    expect(text).toContain('Remove the wiki section');
    expect(text).toMatch(/Relink sonar[\s\S]*Add a sonar connection[\s\S]*Check sonar on the service/);
    // Add a connection suggests the name the dossier expects, then checks again and comes back here.
    const add = press(s, w, 'down', 'return');
    expect(JSON.parse(top(add).params.thenRun!)).toEqual([['dossiers', 'check', 'team'], ['dossiers', 'show', 'team']]);
    expect(top(add)).toMatchObject({ view: 'add-name', params: { area: 'sonar', suggest: 'old-sonar' } });
    expect(screen(add, w)).toContain('Connection name: old-sonar');
    expect(press(add, w, 'return').pending?.steps.map((x) => x.args)).toEqual([['connections', 'add', 'old-sonar', '--area', 'sonar'], ['connections', 'test', 'old-sonar']]);
    // Relink: pick yours, and the fix runs with show and check after it.
    s = press(s, w, 'return', 'return');
    expect(steps(s)).toEqual([['dossiers', 'link', 'team', 'sonar', '--connection', 'sonar', '--replace'], ['dossiers', 'show', 'team'], ['dossiers', 'check', 'team']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-review');
    expect(screen(s, w)).not.toContain('DOSSIER_UNKNOWN_CONNECTION');
    expect(file(d, 'team').sonar).toEqual({ connection: 'sonar' });
    // By host, with the default port typed out, still finds jira's writes and asks for its name.
    const byHost = apply(s, { go: 'dossier-host', params: { ref: 'team', area: 'jira', flow: 'edit', then: JSON.stringify({ go: 'dossier', root: 'dossier' }) } });
    const host = press(type(byHost, w, 'jira.imagile.dev:443'), w, 'return');
    expect(top(host)).toMatchObject({ view: 'dossier-confirm', params: { connection: 'jira' } });
    expect(host.pending).toBeUndefined();
  });

  it('fixes a stale section and a stored credential from Review, with real commands', async () => {
    const d = disk({ 'home/.toil/dossiers/team.json': { name: 'team', repos: [{ name: 'api', remotes: ['https://git.imagile.dev/pay/api.git', 'https://ci:t0ken@git.imagile.dev/pay/api-mirror.git'] }], wiki: { space: 'X' } } });
    const c = configOf();
    const w = data(c);
    let s = press(settled, w, '6', '2');
    s = press(await perform(s, d, c), w, 'return', 'return');
    s = press(await perform(s, d, c), w, 'return', 'return');
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-review');
    expect(screen(s, w).indexOf('Remove the wiki section')).toBeLessThan(screen(s, w).indexOf('Remove the credential from api'));
    expect(screen(s, w)).not.toContain('by hand');
    // The credential: re-add the repo as it is, then show and check.
    const clean = press(s, w, '2');
    expect(steps(clean)).toEqual([['dossiers', 'add-repo', 'team', 'https://git.imagile.dev/pay/api.git', '--name', 'api'], ['dossiers', 'show', 'team'], ['dossiers', 'check', 'team']]);
    s = press(await perform(clean, d, c), w, 'return');
    expect(readFileSync(join(d.home, '.toil', 'dossiers', 'team.json'), 'utf8')).not.toContain('t0ken');
    expect(file(d, 'team').repos).toEqual([{ name: 'api', remotes: ['https://git.imagile.dev/pay/api.git', 'https://git.imagile.dev/pay/api-mirror.git'] }]);
    expect(screen(s, w)).not.toContain('Remove the credential');
    // The section: type its name, then unlink.
    s = press(s, w, '1');
    expect(where(s)).toBe('dossier-unlink');
    expect(top(press(type(s, w, 'wik'), w, 'return')).error).toContain("isn't");
    s = press(type(s, w, 'wiki'), w, 'return');
    expect(steps(s)).toEqual([['dossiers', 'unlink', 'team', '--area', 'wiki'], ['dossiers', 'show', 'team'], ['dossiers', 'check', 'team']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-review');
    expect(screen(s, w)).toContain('No errors');
    expect(file(d, 'team')).not.toHaveProperty('wiki');
  });

  it('edits a section through a save screen that shows the commands before anything runs', async () => {
    const d = disk({ 'home/.toil/dossiers/team.json': { name: 'team', repos: [], jira: { project: 'OLD' } } });
    const c = configOf();
    const w = data(c);
    let s = press(settled, w, '6', '2');
    s = press(await perform(s, d, c), w, 'return', 'return');
    s = press(await perform(s, d, c), w, 'return', '2');
    expect(where(s)).toBe('dossier-edit');
    s = press(s, w, '2');
    expect(top(s)).toMatchObject({ view: 'dossier-area', params: { area: 'jira' } });
    s = press(type(press(s, w, '2'), w, 'project=PAY'), w, 'return');
    expect(where(s)).toBe('dossier-save');
    expect(s.pending).toBeUndefined();
    expect(screen(s, w)).toMatch(/jira now[\s\S]*project\s+OLD[\s\S]*\$ toil dossiers link team jira --set project=PAY --replace/);
    s = press(s, w, 'return');
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-area');
    expect(screen(s, w)).toMatch(/project\s+PAY/);
    expect(file(d, 'team').jira).toEqual({ project: 'PAY' });
  });

  it('exports to a file, imports it back with the connections it names to set up, and confirms an import whose binding has writes on', async () => {
    const d = disk({
      'home/.toil/dossiers/team.json': { name: 'team', repos: [], sonar: { connection: 'sonar' } },
      'work/.toil/dossiers/shared.json': { name: 'shared', repos: [], confluence: { host: 'wiki.imagile.dev' }, jira: { host: 'jira.imagile.dev' } },
    });
    const c = configOf();
    const w = data(c);
    let s = press(settled, w, '6', '2');
    s = press(await perform(s, d, c), w, 'return', 'return');
    s = press(await perform(s, d, c), w, 'return', '3', '1', 'return');
    expect(steps(s)).toEqual([['dossiers', 'export', 'team', '--file', 'team.json']]);
    s = await perform(s, d, c);
    expect(JSON.parse(readFileSync(join(d.workspace, 'team.json'), 'utf8')).sonar).toEqual({ host: 'sonar.imagile.dev' });
    // Again, onto the file now there: asks to replace.
    s = press(press(s, w, 'return'), w, '3', '1', 'return');
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossier-export-replace');
    expect(steps(press(s, w, 'return'))?.[0]).toEqual(['dossiers', 'export', 'team', '--file', 'team.json', '--replace']);

    // Import: checked first; jira's binding lands on a connection with writes on, so the name is typed.
    let i = press(settled, w, '6', '4');
    expect(top(press(type(i, w, 'shared'), w, 'return')).error).toContain('.json');
    i = press(type(i, w, '.toil/dossiers/shared.json'), w, 'return');
    expect(steps(i)).toEqual([['dossiers', 'check', '.toil/dossiers/shared.json']]);
    i = press(await perform(i, d, c), w, 'return');
    expect(where(i)).toBe('dossier-import-check');
    expect(screen(i, w)).toContain('Its bindings select jira, with writes on');
    i = press(i, w, 'return');
    expect(where(i)).toBe('dossier-import-confirm');
    i = press(type(i, w, 'shared'), w, 'return');
    expect(steps(i)).toEqual([['dossiers', 'import', '.toil/dossiers/shared.json']]);
    i = press(await perform(i, d, c), w, 'return');
    expect(where(i)).toBe('dossier-import-done');
    expect(screen(i, w)).toMatch(/1 connection to set up[\s\S]*wiki\.imagile\.dev/);
    expect(top(press(i, w, 'return'))).toMatchObject({ view: 'add-name', params: { area: 'confluence' } });
    expect(existsSync(join(d.home, '.toil', 'dossiers', 'shared.json'))).toBe(true);
  });

  it('shows what this folder resolves to and why, and offers to create or join when nothing does', async () => {
    const d = disk();
    const api = clone(d, 'payments-api');
    d.write('home/.toil/dossiers/payments.json', { name: 'payments', repos: [{ name: 'payments-api', remotes: ['https://git.imagile.dev/pay/payments-api.git'] }] });
    const c = configOf();
    const w = data(c, { cwd: forwardSlashes(api), repo: { root: forwardSlashes(api), branch: 'main' } });
    let s = press(settled, w, '6', '1');
    expect(steps(s)).toEqual([['dossiers', 'context']]);
    s = await perform(s, d, c, api);
    expect(screen(s, w)).toContain('This folder resolves to payments');
    s = press(s, w, 'return');
    expect(screen(s, w)).toMatch(/This folder resolves to payments[\s\S]*remote[\s\S]*is its repo\s+payments-api/);
    expect(steps(press(s, w, 'return'))).toEqual([['dossiers', 'show', 'payments']]);

    const other = disk();
    const lone = clone(other, 'lone');
    let n = press(settled, data(c, { cwd: forwardSlashes(lone), repo: { root: forwardSlashes(lone), branch: 'main' } }), '6', '1');
    n = press(await perform(n, other, c, lone), w, 'return');
    expect(screen(n, w)).toMatch(/No dossier applies here[\s\S]*Create a dossier for this repo[\s\S]*Add this repo to a dossier/);
    expect(top(press(n, w, 'return'))).toMatchObject({ view: 'dossier-new', params: { repo: forwardSlashes(lone) } });
    expect(screen(press(n, w, 'return'), w)).toContain('Dossier name: lone');
  });

  it('deletes only after the name is typed, and hands off with a prompt and the areas an agent needs', async () => {
    const d = disk({ 'home/.toil/dossiers/team.json': { name: 'team', repos: [], jira: {} } });
    const c = configOf();
    const w = data(c);
    let s = press(settled, w, '6', '2');
    s = press(await perform(s, d, c), w, 'return', 'return');
    s = press(await perform(s, d, c), w, 'return');
    const agent = press(s, w, '4');
    expect(where(agent)).toBe('dossier-agent');
    expect(screen(agent, w)).toMatch(/toil mcp --areas dossiers,repos,jira[\s\S]*Build or extend the toil dossier "team"/);
    s = press(s, w, '5');
    expect(where(s)).toBe('dossier-delete');
    expect(top(press(type(s, w, 'tea'), w, 'return')).error).toContain("isn't");
    s = press(type(s, w, 'team'), w, 'return');
    expect(steps(s)).toEqual([['dossiers', 'remove', 'team']]);
    s = press(await perform(s, d, c), w, 'return');
    expect(where(s)).toBe('dossiers');
    expect(existsSync(join(d.home, '.toil', 'dossiers', 'team.json'))).toBe(false);
  });
});

describe('the dossier screens, as functions', () => {
  it('match a host selector the way a dossier does, and find which connections with writes on a binding selects', () => {
    expect(onHost({ baseUrl: 'https://jira.imagile.dev' }, 'JIRA.imagile.dev')).toBe(true);
    expect(onHost({ baseUrl: 'https://api.ocp.imagile.dev:6443' }, 'api.ocp.imagile.dev')).toBe(true);
    expect(onHost({ baseUrl: 'https://api.ocp.imagile.dev:6443' }, 'api.ocp.imagile.dev:443')).toBe(false);
    // The scheme's default port counts, as core's resolver counts it.
    expect(onHost({ baseUrl: 'https://jira.imagile.dev' }, 'jira.imagile.dev:443')).toBe(true);
    expect(writesTargets(data(configOf()), 'jira', { host: 'jira.imagile.dev:443' })).toEqual(['jira']);
    expect(onHost({ host: 'db.imagile.dev', port: 5432 }, 'db.imagile.dev:5432')).toBe(true);
    const w = data(configOf());
    expect(writesTargets(w, 'jira', { host: 'jira.imagile.dev' })).toEqual(['jira']);
    expect(writesTargets(w, 'jira', { connection: 'jira' })).toEqual(['jira']);
    expect(writesTargets(w, 'sonar', { connection: 'sonar' })).toEqual([]);
  });

  it('asks before import on the warning code alone, whatever its message says', () => {
    const c = (message: string) => ({ name: 'x', file: 'x.json', ok: true, problems: [{ level: 'warning' as const, code: 'DOSSIER_WRITES_BINDING', path: 'jira', message }] });
    expect(writesBindings(c('This selects connection jira, which has writes on. Reads follow it.'))).toEqual({ any: true, names: 'jira' });
    expect(writesBindings(c('Reworded entirely.'))).toEqual({ any: true, names: 'a connection' });
    expect(writesBindings({ name: 'x', file: 'x.json', ok: true, problems: [] }).any).toBe(false);
  });

  it('names fields, folders and reasons plainly', () => {
    expect(aliasFor('Story Points', 'customfield_10016')).toBe('storyPoints');
    expect(aliasFor('2nd Reviewer', 'customfield_10300')).toBe('field10300');
    expect(nameFromFolder('C:/Code/Payments_API/')).toBe('payments-api');
    expect(whyApplies({ by: 'env', match: null, repo: null })).toBe('TOIL_DOSSIER names it');
    expect(whyApplies({ by: 'folder', match: 'checked-in', repo: null })).toContain('checked into this repository');
    expect(findingSection('environments.prod.openshift.host')).toEqual({ env: 'prod', area: 'openshift' });
    expect(findingSection('repos[0].remotes[0]')).toBeUndefined();
    expect(groupFindings([{ level: 'warning', code: 'X', path: '', message: '' }, { level: 'error', code: 'DOSSIER_HOST_UNMATCHED', path: 'jira.host', message: '' }]).map((g) => g.title)).toEqual(['Connections', 'Other']);
    expect(handOffPrompt(undefined, '/work')).toContain('repos_scan (folder /work)');
  });

  it('reads a discovery list wherever the command puts it', () => {
    const env = (data: unknown): StepResult => ({ args: [], envelope: { ok: true, data, error: null, meta: { command: 'x', durationMs: 0, version: '0', contractVersion: 1 } } });
    expect(discovered(env({ paging: {}, components: [{ key: 'pay-api', name: 'Payments API' }] }), DISCOVERY.sonar!)).toEqual([{ id: 'pay-api', name: 'Payments API' }]);
    expect(discovered(env([{ key: 'PAY', name: 'Payments' }, { key: 'PAY', name: 'again' }]), DISCOVERY.confluence!)).toEqual([{ id: 'PAY', name: 'Payments' }]);
  });
});
