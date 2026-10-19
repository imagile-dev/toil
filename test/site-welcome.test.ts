import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Envelope } from '../src/core/envelope.js';
import { DURATION } from '../src/welcome/logo.js';
import { finish, initialState, reduce, render, type Key, type MenuState } from '../src/welcome/menu.js';
import type { WelcomeData } from '../src/welcome/screens.js';
import { SPEED, splashFrame } from '../src/welcome/splash.js';
import { commands } from '../src/registry.js';
import { commandSummaries } from '../src/welcome/data.js';
import { testConfig } from './harness/context.js';

/**
 * The site's welcome page shows the real thing: the splash recorded frame by
 * frame from the same pure function the terminal draws, and menu screens
 * rendered by the same `render`. The site can't import src/, so this test
 * writes site/src/data/welcome.json and fails when it's stale; `npx vitest
 * run -u` rewrites it. A screenshot that regenerates itself is the only kind
 * that never needs a ticket to update.
 */

/** A line as coloured runs: [text, index into colours, or -1 for none]. */
type Run = [string, number];

const FPS = 20;
const COLUMNS = 100;
const caps = { colorDepth: 24, unicode: true, columns: COLUMNS, animate: true, rows: 34 } as const;

function encoder() {
  const colors: string[] = [];
  const lines: Run[][] = [];
  const known = new Map<string, number>();
  const color = (rgb: string) => {
    let i = colors.indexOf(rgb);
    if (i < 0) i = colors.push(rgb) - 1;
    return i;
  };
  /** One terminal line of 24-bit ANSI to runs, deduplicated across frames. */
  const line = (text: string): number => {
    const hit = known.get(text);
    if (hit !== undefined) return hit;
    const runs: Run[] = [];
    let current = -1;
    // eslint-disable-next-line no-control-regex
    for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
      if (!part) continue;
      // eslint-disable-next-line no-control-regex
      const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
      if (sgr) {
        const m = /^38;2;(\d+);(\d+);(\d+)$/.exec(sgr[1]!);
        current = m ? color(`#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`) : -1;
        continue;
      }
      const last = runs[runs.length - 1];
      if (last && last[1] === current) last[0] += part;
      else runs.push([part, current]);
    }
    const id = lines.push(runs) - 1;
    known.set(text, id);
    return id;
  };
  return { colors, lines, line };
}

const sample: WelcomeData = {
  version: 'alpha',
  node: '24.14.0',
  platform: 'linux x64',
  configPath: '/home/you/.toil/config.json',
  configExists: true,
  config: (() => {
    const c = testConfig({
      'corp-jira': { baseUrl: 'https://jira.imagile.dev', apiToken: 'keychain:corp-jira.apiToken' },
      wiki: { baseUrl: 'https://confluence.imagile.dev', apiToken: 'keychain:wiki.apiToken' },
    });
    c.connections.wiki!.area = 'confluence';
    c.connections['corp-jira']!.area = 'jira';
    c.defaults = { jira: { connection: 'corp-jira' }, confluence: { connection: 'wiki' } };
    for (const key of Object.keys(c.sources)) c.sources[key] = 'global';
    return c;
  })(),
  areas: [
    { name: 'confluence', commands: commandSummaries('confluence', commands), description: 'Confluence Data Center: pages, spaces, CQL search, comments, labels and attachments', signsIn: true, live: true, configurable: true },
    { name: 'github', commands: commandSummaries('github', commands), description: 'GitHub and GitHub Enterprise Server: pull requests, reviews and checks', signsIn: true, live: true, configurable: true },
    { name: 'jenkins', commands: commandSummaries('jenkins', commands), description: 'Jenkins: jobs, builds, console logs and the build queue', signsIn: true, live: true, configurable: true },
    { name: 'jira', commands: commandSummaries('jira', commands), description: 'Jira Data Center: issues, search, transitions, comments, worklogs, attachments', signsIn: true, live: true, configurable: true },
    { name: 'sonar', commands: commandSummaries('sonar', commands), description: 'SonarQube: projects, quality gates, issues and measures', signsIn: true, live: true, configurable: true },
  ],
  mcpAreas: ['confluence', 'connections', 'github', 'jenkins', 'jira', 'sonar'],
  launch: { command: 'toil', args: [] },
  folder: { cwd: '/home/you/payments', repo: { root: '/home/you/payments', branch: 'main', remote: 'https://bitbucket.imagile.dev/scm/pay/payments.git' } },
};

const env = (data: unknown, command: string): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 120, version: 'alpha', contractVersion: 1 } });
const keys = (state: MenuState, ...list: string[]) =>
  list.reduce((s, k) => reduce(s, (k.length === 1 ? { name: k, sequence: k } : { name: k }) satisfies Key, sample), state);

/** The screens the page shows, in the order a first-time user meets them. */
function screens(): Array<{ id: string; caption: string; state: MenuState }> {
  const tested = finish({ ...initialState, pending: { title: 'Test connections', keepGoing: true, steps: [] } }, [
    { args: ['connections', 'test', 'corp-jira'], envelope: env({ name: 'corp-jira', area: 'jira', host: 'jira.imagile.dev', live: true, request: 'GET /rest/api/2/myself' }, 'connections test') },
    {
      args: ['connections', 'test', 'wiki'],
      envelope: {
        ok: false,
        data: null,
        error: { code: 'AUTH', message: 'Confluence rejected the personal access token on connection "wiki".', fix: 'Create a new token, then run toil connections login wiki.' },
        meta: { command: 'connections test', durationMs: 90, version: 'alpha', contractVersion: 1 },
      },
    },
  ]);
  const home = keys(tested, 'return');
  const added = finish(
    { ...keys(home, '4', '3', '5'), pending: { title: 'Add sonar', steps: [] } },
    [
      { args: ['connections', 'add', 'sonar', '--area', 'sonar'], envelope: env({ name: 'sonar', area: 'sonar', configFile: '/home/you/.toil/config.json' }, 'connections add') },
      { args: ['connections', 'test', 'sonar'], envelope: env({ name: 'sonar', area: 'sonar', host: 'sonar.imagile.dev', live: true, request: 'GET /api/authentication/validate' }, 'connections test') },
    ],
  );
  return [
    { id: 'home', caption: 'Home: this folder, connection health, and what needs attention first.', state: home },
    { id: 'services', caption: 'Services: a service and its resources, each with the actions under it.', state: keys(home, '2', '3') },
    { id: 'service-command', caption: 'A command as you would type it; Run it asks for the ids, then flags, and shows the line first.', state: keys(home, '2', '3', '1', '1') },
    { id: 'connections', caption: 'Connections, with where each came from and whether it answered.', state: keys(home, '4') },
    { id: 'add', caption: 'Adding a connection starts with the service, then its name.', state: keys(home, '4', '3') },
    { id: 'added', caption: 'Every step shows the plain command it ran, and what came back.', state: added },
    { id: 'connection', caption: "One connection's actions; a rejected sign-in comes with its fix.", state: keys(home, '1') },
    { id: 'agent', caption: 'Pick the areas an agent should see, and copy its config snippet.', state: keys(home, '5', '1', 'down', 'down', 'down', 'down', 'space', 'return') },
    { id: 'agent-skills', caption: 'Agent skills: skill plugins from marketplaces, what is installed, and the toil skill.', state: keys(home, '6') },
  ];
}

export function welcomeData() {
  const e = encoder();
  const seconds = DURATION / SPEED;
  const frames: number[][] = [];
  for (let i = 0; i <= Math.ceil(seconds * FPS); i++) frames.push(splashFrame((i / FPS) * SPEED, caps, 'alpha').map(e.line));
  const still = splashFrame(DURATION + 1, caps, 'alpha').map(e.line);
  const shots = screens().map((s) => ({ id: s.id, caption: s.caption, lines: render(s.state, caps, sample).map(e.line) }));
  return { fps: FPS, columns: COLUMNS, colors: e.colors, lines: e.lines, splash: { frames, still }, screens: shots };
}

describe('site welcome page', () => {
  it('site/src/data/welcome.json matches what the terminal draws', async () => {
    const data = welcomeData();
    expect(data.splash.frames.length).toBeGreaterThan(40);
    await expect(`${JSON.stringify(data)}\n`).toMatchFileSnapshot(join(import.meta.dirname, '..', 'site', 'src', 'data', 'welcome.json'));
  });
});
