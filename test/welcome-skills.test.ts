import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Settings } from '../src/core/config.js';
import { commands } from '../src/registry.js';
import { finish, initialState, reduce, top, type MenuState } from '../src/welcome/menu.js';
import type { WelcomeData } from '../src/welcome/screens.js';
import type { Run, StepResult } from '../src/welcome/view.js';
import { checkUrl, toggleChanges } from '../src/welcome/views/skills.js';
import { git, HOME, REPO } from './fixtures/skills.fixture.js';
import { runCli } from './harness/cli.js';
import { testConfig, testContext } from './harness/context.js';

/**
 * The Skills and Plugins menu modules (#54, #55), driven as data through the
 * menu's reducer, with every command they ask for run for real against a
 * temp home seeded like the skills fixture: a marketplace `skills` with
 * plugin `review` on and `docs` switched off, in Codex's and Claude Code's
 * user folders.
 */

type K = string | { name: string };
const keyOf = (k: K) => (typeof k === 'string' ? (k.length === 1 ? { sequence: k, name: k === ' ' ? 'space' : k } : { name: k }) : k);
const press = (state: MenuState, d: WelcomeData, ...keys: K[]) => keys.reduce((s, k) => reduce(s, keyOf(k), d), state);
const type = (state: MenuState, d: WelcomeData, text: string) => press(state, d, ...[...text]);
const where = (s: MenuState) => top(s).view;
const settled: MenuState = { ...initialState, session: { health: { skills: { ok: true, live: false } } } };

/** Menu data with the marketplace in the user's own file, so the menu may change it. */
function data(settings: Settings = { repoUrl: REPO, writes: true }): WelcomeData {
  const config = testConfig({ skills: settings });
  for (const key of Object.keys(config.sources)) config.sources[key] = 'global';
  return {
    version: '0.0.0-test',
    node: '24.14.0',
    platform: 'linux x64',
    configPath: '/home/test/.toil/config.json',
    configExists: true,
    config,
    areas: [{ name: 'skills', description: 'Agent skills', signsIn: true, live: false, configurable: true }],
    mcpAreas: ['skills'],
    launch: { command: 'toil', args: [] },
    folder: { cwd: '/work' },
  };
}

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
/** A fresh home seeded like the skills fixture. */
function seeded(): string {
  const home = mkdtempSync(join(tmpdir(), 'toil-welcome-skills-'));
  homes.push(home);
  for (const [path, content] of Object.entries(HOME)) {
    const at = join(home, ...path.split('/'));
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, content);
  }
  return home;
}

/** Runs one menu step as the real CLI would, in `home`. */
async function runStep(args: string[], home: string): Promise<StepResult> {
  const { context } = testContext({ config: { skills: { repoUrl: REPO, writes: true } }, home, git });
  const run = await runCli(args, { commands, context });
  expect(run.envelope, run.stdout + run.stderr).toBeDefined();
  return { args, envelope: run.envelope! };
}

/** What the loop does with a pending run: run every step, then `finish`. */
async function perform(state: MenuState, home: string): Promise<MenuState> {
  const run: Run = state.pending!;
  const results: StepResult[] = [];
  for (const step of run.steps) {
    const r = await runStep(step.args, home);
    results.push(r);
    if (!r.envelope.ok && !run.keepGoing) break;
  }
  return finish(state, results);
}

const steps = (s: MenuState) => s.pending?.steps.map((x) => x.args);

describe('the Skills module', () => {
  it('sits on home after Connect an agent, with Plugins after it', () => {
    expect(where(press(settled, data(), '4'))).toBe('skills');
    expect(where(press(settled, data(), '5'))).toBe('plugins');
  });

  it('adds a marketplace: refuses ssh, suggests a name, and runs add, which asks for the token itself', () => {
    const d = data();
    const url = press(press(settled, d, '4'), d, 'down', 'return');
    expect(where(url)).toBe('skills-add-url');
    const ssh = press(type(url, d, 'git@bitbucket.imagile.dev:ai/team.git'), d, 'return');
    expect(top(ssh).error).toContain('https only');
    const name = press(type(url, d, 'https://bitbucket.imagile.dev/scm/ai/team-skills.git'), d, 'return');
    expect(where(name)).toBe('skills-add-name');
    const added = press(name, d, 'return');
    expect(steps(added)).toEqual([['skills', 'marketplace', 'add', 'https://bitbucket.imagile.dev/scm/ai/team-skills.git', '--name', 'team-skills', '--allow-write']]);
    expect(added.pending?.steps[0]?.label).toContain('access token');
  });

  it('checks a URL the way add will', () => {
    expect(checkUrl('https://bitbucket.imagile.dev/scm/ai/skills.git')).toBeUndefined();
    expect(checkUrl('C:/repos/skills')).toBeUndefined();
    expect(checkUrl('ssh://git@bitbucket.imagile.dev/ai/skills.git')).toContain('https only');
    expect(checkUrl('http://bitbucket.imagile.dev/scm/ai/skills.git')).toContain('https');
    expect(checkUrl('https://me:secret@bitbucket.imagile.dev/x.git')).toContain('Leave the user name and token out');
  });

  it('offers writes on first when they are off, through connections writes, which confirms on the terminal', () => {
    const d = data({ repoUrl: REPO });
    const mk = press(press(settled, d, '4'), d, 'return');
    expect(where(mk)).toBe('marketplace');
    expect(steps(press(mk, d, 'return'))).toEqual([['connections', 'writes', 'skills', 'on']]);
  });

  it('installs a plugin: lists plugins with the real command, then agent and place with the defaults preselected', async () => {
    const home = seeded();
    const d = data();
    const mk = press(press(settled, d, '4'), d, 'return');
    const listing = press(mk, d, 'return');
    expect(steps(listing)).toEqual([['skills', 'marketplace', 'plugins', 'skills']]);
    const listed = await perform(listing, home);
    const picker = press(listed, d, 'return');
    expect(where(picker)).toBe('skills-plugin');
    const agent = press(picker, d, 'return');
    // Codex (.agents/skills, which Copilot reads too) is first and highlighted: enter takes the default.
    expect(where(agent)).toBe('skills-agent');
    expect(top(agent).selected).toBe(0);
    const scope = press(agent, d, 'return');
    expect(top(scope)).toMatchObject({ view: 'skills-scope', selected: 0, params: { agent: 'codex', plugin: 'review' } });
    const install = press(scope, d, 'return');
    expect(steps(install)).toEqual([['skills', 'marketplace', 'sync', 'review', '--marketplace', 'skills', '--agent', 'codex', '--scope', 'user', '--allow-write']]);
    const done = await perform(install, home);
    expect(top(done).results?.[0]?.envelope.ok).toBe(true);
    // Claude Code, in this repository, is two moves away.
    expect(steps(press(picker, d, 'return', 'down', 'down', 'return', 'down', 'return'))).toEqual([
      ['skills', 'marketplace', 'sync', 'review', '--marketplace', 'skills', '--agent', 'claude-code', '--scope', 'project', '--allow-write'],
    ]);
  });
});

describe('the Plugins module', () => {
  /** Plugins → agent → place → status, run for real, then Continue: the checkbox screen. */
  async function checkboxes(home: string, agentKeys: K[] = []): Promise<MenuState> {
    const d = data();
    const status = press(press(settled, d, '5'), d, 'return', ...agentKeys, 'return', 'return');
    expect(steps(status)?.[0]?.slice(0, 2)).toEqual(['skills', 'status']);
    return press(await perform(status, home), d, 'return');
  }

  it('ticks what is on, shows what changed before writing, and runs one command per change', async () => {
    const home = seeded();
    const d = data();
    const list = await checkboxes(home);
    expect(where(list)).toBe('plugins-toggle');
    // review is on and docs is off in the seeded folder; the ticks start there.
    expect(JSON.parse(top(list).params.plugins!).map((s: { plugin: string }) => s.plugin)).toEqual(['docs', 'review']);
    // Nothing changed: enter writes nothing and goes back.
    expect(where(press(list, d, 'return'))).toBe('plugins');
    // Space on docs (first) turns it on, space on review turns it off.
    const review = press(list, d, ' ', 'down', ' ', 'return');
    expect(where(review)).toBe('plugins-review');
    expect(JSON.parse(top(review).params.changes!)).toEqual([
      { marketplace: 'skills', plugin: 'docs', on: true },
      { marketplace: 'skills', plugin: 'review', on: false },
    ]);
    expect(review.pending).toBeUndefined();
    const save = press(review, d, 'return');
    expect(steps(save)).toEqual([
      ['skills', 'marketplace', 'enable', 'docs', '--marketplace', 'skills', '--agent', 'codex', '--scope', 'user', '--allow-write'],
      ['skills', 'marketplace', 'disable', 'review', '--marketplace', 'skills', '--agent', 'codex', '--scope', 'user', '--allow-write'],
    ]);
  });

  it('toggling from the menu writes the same files as the commands do by hand', async () => {
    const viaMenu = seeded();
    const byHand = seeded();
    const d = data();
    const save = press(await checkboxes(viaMenu, ['down', 'down']), d, 'down', ' ', 'return', 'return');
    expect(steps(save)).toEqual([['skills', 'marketplace', 'disable', 'review', '--marketplace', 'skills', '--agent', 'claude-code', '--scope', 'user', '--allow-write']]);
    const saved = await perform(save, viaMenu);
    expect(top(saved).results?.every((r) => r.envelope.ok)).toBe(true);
    await runStep(['skills', 'marketplace', 'disable', 'review', '--marketplace', 'skills', '--claude', '--allow-write'], byHand);

    const index = (home: string) => readFileSync(join(home, '.claude', 'skills', '.toil-installed.json'), 'utf8');
    expect(index(viaMenu)).toBe(index(byHand));
    expect(JSON.parse(index(viaMenu)).disabled).toHaveProperty('code-review');
    // The other folder, which the change wasn't for, is untouched by either.
    const codex = (home: string) => readFileSync(join(home, '.agents', 'skills', '.toil-installed.json'), 'utf8');
    expect(codex(viaMenu)).toBe(HOME['.agents/skills/.toil-installed.json']);
    expect(codex(byHand)).toBe(HOME['.agents/skills/.toil-installed.json']);

    // After saving, Continue runs status again and reopens the boxes with the new state.
    const again = press(saved, d, 'return');
    expect(steps(again)?.[0]).toEqual(['skills', 'status', '--agent', 'claude-code', '--scope', 'user']);
    const reopened = press(await perform(again, viaMenu), d, 'return');
    expect(where(reopened)).toBe('plugins-toggle');
    // Saving and looking again replaces the checkbox screen rather than stacking another.
    expect(reopened.stack.map((f) => f.view)).toEqual(['home', 'plugins', 'skills-agent', 'skills-scope', 'plugins-toggle']);
    expect(JSON.parse(top(reopened).params.plugins!).find((s: { plugin: string }) => s.plugin === 'review')).toMatchObject({ on: 0, off: 1 });
  });

  it('works out changes only for what the ticks actually change', () => {
    const states = [
      { marketplace: 'm', plugin: 'a', on: 1, off: 0 },
      { marketplace: 'm', plugin: 'b', on: 0, off: 2 },
      { marketplace: 'm', plugin: 'c', on: 1, off: 1 },
    ];
    // Opened as ticked (a and c, which is partly on), left alone: nothing to write.
    expect(toggleChanges(states, ['m/a', 'm/c'])).toEqual([]);
    expect(toggleChanges([{ marketplace: 'm', plugin: 'p', on: 1, off: 1 }], ['m/p'])).toEqual([]);
    expect(toggleChanges(states, ['m/b'])).toEqual([
      { marketplace: 'm', plugin: 'a', on: false },
      { marketplace: 'm', plugin: 'b', on: true },
      { marketplace: 'm', plugin: 'c', on: false },
    ]);
  });
});
