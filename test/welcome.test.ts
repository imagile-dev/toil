import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION, logoCells, logoFrame, sceneAt, SIGNALS, SPIN } from '../src/welcome/logo.js';
import type { Settings } from '../src/core/config.js';
import type { Envelope } from '../src/core/envelope.js';
import { finish, initialState, reduce, render, top, type MenuState } from '../src/welcome/menu.js';
import { agentScreen, connectionsScreen, healthScreen, type WelcomeData } from '../src/welcome/screens.js';
import { launchCommand } from '../src/welcome/data.js';
import { playSplash, SPEED, splashFrame, TAGLINE } from '../src/welcome/splash.js';
import { detectCaps, fitLine, PALETTE, visibleLength, wrapLine } from '../src/welcome/term.js';
import { CTRL_C_WINDOW_MS, doubleTap, runWelcome, wantsWelcome } from '../src/welcome/index.js';
import { testConfig } from './harness/context.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[/;
const plain = { colorDepth: 1, unicode: true } as const;
const ascii = { colorDepth: 1, unicode: false } as const;
const color = { colorDepth: 24, unicode: true } as const;

const data = (over: Partial<WelcomeData> = {}): WelcomeData => ({
  version: '0.1.0-alpha.1',
  node: '22.12.0',
  platform: 'linux x64',
  configPath: '/home/test/.toil/config.json',
  configExists: true,
  config: testConfig({ jira: { baseUrl: 'https://jira.imagile.dev', token: 't' } }),
  areas: [
    { name: 'jira', description: 'Jira Data Center', signsIn: true, live: true, configurable: true },
    { name: 'confluence', description: 'Confluence Data Center', signsIn: true, live: true, configurable: true },
  ],
  mcpAreas: ['confluence', 'jira'],
  launch: { command: 'toil', args: [] },
  folder: { cwd: '/home/test' },
  ...over,
});

/** A config as written in the user's own file rather than set by env vars, so the menu may change it. */
const fileConfig = (areas: Record<string, Settings>) => {
  const config = testConfig(areas);
  for (const key of Object.keys(config.sources)) config.sources[key] = 'global';
  return config;
};

describe('when the welcome screen opens', () => {
  it('only for bare toil on an interactive terminal, never in a pipe, with arguments or in CI', () => {
    const tty = { isTTY: true };
    expect(wantsWelcome([], tty, tty, {})).toBe(true);
    expect(wantsWelcome(['version'], tty, tty, {})).toBe(false);
    expect(wantsWelcome([], { isTTY: false }, tty, {})).toBe(false);
    expect(wantsWelcome([], tty, {}, {})).toBe(false);
    expect(wantsWelcome([], tty, tty, { CI: 'true' })).toBe(false);
  });
});

describe('terminal capabilities', () => {
  const out = (depth: number, extra: object = {}) => ({ isTTY: true, columns: 120, rows: 40, getColorDepth: () => depth, ...extra });

  it('honours NO_COLOR, and stays still under NO_COLOR, TOIL_NO_ANIMATION, CI, TERM=dumb or a small window', () => {
    expect(detectCaps(out(24), { NO_COLOR: '1' }, 'linux')).toMatchObject({ colorDepth: 1, animate: false });
    expect(detectCaps(out(24), {}, 'linux')).toMatchObject({ colorDepth: 24, animate: true });
    for (const env of [{ TOIL_NO_ANIMATION: '1' }, { CI: 'true' }, { TERM: 'dumb' }]) expect(detectCaps(out(24), env, 'linux').animate).toBe(false);
    expect(detectCaps(out(24, { columns: 30 }), {}, 'linux').animate).toBe(false);
    expect(detectCaps(out(24, { isTTY: false }), {}, 'linux').animate).toBe(false);
  });

  it('draws in ASCII on a plain Windows console, and in braille on Windows Terminal or elsewhere', () => {
    expect(detectCaps(out(24), {}, 'win32').unicode).toBe(false);
    expect(detectCaps(out(24), { WT_SESSION: 'x' }, 'win32').unicode).toBe(true);
    expect(detectCaps(out(24), {}, 'darwin').unicode).toBe(true);
    expect(detectCaps(out(24), { TOIL_ASCII: '1' }, 'linux').unicode).toBe(false);
  });

  it('shows the still frame on the legacy Windows console host, and animates in Windows Terminal', () => {
    expect(detectCaps(out(24), {}, 'win32')).toMatchObject({ animate: false, unicode: false });
    expect(detectCaps(out(24), { WT_SESSION: 'x' }, 'win32')).toMatchObject({ animate: true, unicode: true });
    expect(detectCaps(out(24), { TERM_PROGRAM: 'vscode' }, 'win32').animate).toBe(true);
  });
});

describe('the logo', () => {
  it('is 16 lines of 32 cells at every moment', () => {
    for (const t of [0, 0.4, 0.9, 1.3, DURATION + 1]) {
      const frame = logoFrame(t, plain);
      expect(frame).toHaveLength(16);
      for (const line of frame) expect(visibleLength(line)).toBe(32);
    }
  });

  it('builds up over time: the ring and branches draw in, then the six tools pop on', () => {
    const inked = (t: number) => logoFrame(t, plain).join('').replace(/[ \u2800]/g, '').length;
    expect(inked(0.1)).toBeLessThan(inked(0.5));
    expect(inked(0.5)).toBeLessThan(inked(DURATION + 1));
    expect(sceneAt(0.5).tools.every((s) => s <= 0)).toBe(true);
    expect(sceneAt(DURATION + 1).tools.every((s) => s === 1)).toBe(true);
  });

  it('runs the command twice: two separate signals down the branches, then none once it settles', () => {
    const firing = (t: number) => sceneAt(t).signal !== null;
    expect(SIGNALS).toHaveLength(2);
    expect(firing(SIGNALS[0] + 0.15)).toBe(true);
    // A signal runs about 0.4s, so the first has finished well before the second starts.
    expect(firing(SIGNALS[0] + 0.5)).toBe(false);
    expect(SIGNALS[0] + 0.5).toBeLessThan(SIGNALS[1]);
    expect(firing(SIGNALS[1] + 0.15)).toBe(true);
    expect(firing(DURATION + 1)).toBe(false);
  });

  it('shows no comet before the ring is visibly turning, and a full one at speed', () => {
    // Regression: the comet used to appear at full length the instant the
    // spin began, while the eased spin hadn't moved yet: a bar, not a motion.
    const justStarted = SPIN.from + 0.04;
    expect(sceneAt(justStarted).spinSpeed).toBeLessThan(0.1);
    // The top of the ring (above the tools) holds no amber until it's moving.
    const amberOnTop = (t: number) =>
      logoCells(t, color)
        .slice(0, 3)
        .flat()
        .some((c) => c.color?.join() === PALETTE.amber.join());
    expect(amberOnTop(justStarted)).toBe(false);
    expect(amberOnTop(SPIN.from - 0.02)).toBe(false);
    expect(sceneAt((SPIN.from + SPIN.to) / 2).spinSpeed).toBeCloseTo(1, 1);
  });

  it('then spins the ring and branches twice, and lands exactly where it started', () => {
    expect(sceneAt(SPIN.from).spin).toBe(0);
    const mid = sceneAt((SPIN.from + SPIN.to) / 2).spin;
    expect(mid).toBeGreaterThan(Math.PI);
    expect(sceneAt(SPIN.to - 0.001).spin).toBeCloseTo(SPIN.turns * Math.PI * 2, 2);
    expect(sceneAt(SPIN.to).spin).toBe(0);
    expect(logoFrame((SPIN.from + SPIN.to) / 2, plain)).not.toEqual(logoFrame(DURATION + 1, plain));
    // Just before the spin and after it settles, the picture is identical.
    expect(logoFrame(SPIN.from - 0.02, plain)).toEqual(logoFrame(DURATION + 1, plain));
  });

  it('falls back to plain ASCII, and to no escape codes without color', () => {
    const still = logoFrame(DURATION + 1, ascii).join('\n');
    expect(still).toMatch(/^[\x20-\x7e\n]*$/);
    expect(still).toContain('O');
    expect(ANSI.test(logoFrame(DURATION + 1, plain).join(''))).toBe(false);
    expect(ANSI.test(logoFrame(DURATION + 1, color).join(''))).toBe(true);
  });
});

describe('the splash', () => {
  it('plays the timeline at SPEED, finishing in DURATION / SPEED real seconds', async () => {
    let clock = 0;
    await playSplash(
      { write: () => {}, now: () => clock, sleep: async (ms) => void (clock += ms) },
      { colorDepth: 1, unicode: true, animate: true, columns: 120, rows: 40 },
      '0.1.0',
    );
    const expected = (DURATION / SPEED) * 1000;
    expect(clock).toBeGreaterThanOrEqual(expected - 40);
    expect(clock).toBeLessThan(expected + 40);
    expect(expected).toBeLessThan(3500);
  });

  it('ends on the tagline, typed out in full', () => {
    expect(splashFrame(DURATION + 1, { ...plain, columns: 120 }, '0.1.0').join('\n')).toContain(TAGLINE);
    expect(splashFrame(0.2, { ...plain, columns: 120 }, '0.1.0').join('\n')).not.toContain(TAGLINE);
  });

  it('keeps the same height on every frame, so redrawing in place never scrolls', () => {
    const heights = [0, 0.5, 1, 1.5, DURATION + 1].map((t) => splashFrame(t, { ...plain, columns: 120 }, 'x').length);
    expect(new Set(heights).size).toBe(1);
  });

  it('stacks the wordmark under the logo when the window is narrow, and never overflows it', () => {
    for (const columns of [50, 80, 120]) {
      const frame = splashFrame(DURATION + 1, { ...plain, columns }, '0.1.0');
      for (const line of frame) expect(visibleLength(line)).toBeLessThanOrEqual(columns);
    }
  });

  it('prints only the still when it cannot animate, and plays frames then the still when it can', async () => {
    let out = '';
    const caps = { colorDepth: 1, unicode: true, animate: false, columns: 120, rows: 40 } as const;
    await playSplash({ write: (t) => (out += t) }, caps, '0.1.0');
    expect(out).toContain(TAGLINE);
    expect(out).not.toContain('\x1b[?25l');

    let clock = 0;
    let animated = '';
    await playSplash(
      { write: (t) => (animated += t), now: () => clock, sleep: async (ms) => void (clock += ms) },
      { ...caps, animate: true },
      '0.1.0',
    );
    // Each redraw moves the cursor back up the splash's 16 lines.
    expect(animated.split('\x1b[16A').length - 1).toBeGreaterThan(10);
    expect(animated.endsWith('\x1b[?25h')).toBe(true);
  });

  it('jumps to the still on any key', async () => {
    let fire = () => {};
    let frames = 0;
    let clock = 0;
    await playSplash(
      {
        write: (t) => void (frames += t.includes('\x1b[2K') ? 1 : 0),
        onKey: (h) => ((fire = h), () => {}),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
          if (clock > 100) fire();
        },
      },
      { colorDepth: 1, unicode: true, animate: true, columns: 120, rows: 40 },
      '0.1.0',
    );
    expect(frames).toBeLessThan(8);
  });
});

describe('the menu', () => {
  type K = string | { name: string; ctrl?: boolean; sequence?: string };
  const keyOf = (k: K) => (typeof k === 'string' ? (k.length === 1 ? { sequence: k, name: k === ' ' ? 'space' : k } : { name: k }) : k);
  const press = (state: MenuState, d: WelcomeData, ...keys: K[]) => keys.reduce((s, k) => reduce(s, keyOf(k), d), state);
  const type = (state: MenuState, d: WelcomeData, text: string) => press(state, d, ...[...text]);
  const where = (s: MenuState) => top(s).view;
  // Home with one tested connection: no attention rows, so the modules are 1-4 and Quit is 5.
  const settled = { ...initialState, session: { health: { jira: { ok: true as const, live: true } } } };

  it('moves with arrows or j/k, wrapping at both ends', () => {
    expect(top(press(settled, data(), 'down', 'down')).selected).toBe(2);
    expect(top(press(settled, data(), 'up')).selected).toBe(5);
    expect(top(press(settled, data(), 'j', 'k', 'k')).selected).toBe(5);
  });

  it('opens a screen with enter or its number, and goes back with esc to where it was', () => {
    expect(where(press(settled, data(), 'down', 'return'))).toBe('connections');
    expect(where(press(settled, data(), '1'))).toBe('health');
    const back = press(settled, data(), '3', 'escape');
    expect(where(back)).toBe('home');
    expect(top(back).selected).toBe(2);
  });

  it('quits with q or the Quit entry; Ctrl+C is left to the loop, which wants it twice', () => {
    expect(press(settled, data(), 'q').quit).toBe(true);
    expect(press(settled, data(), { name: 'c', ctrl: true }).quit).toBeUndefined();
    expect(press(settled, data(), '6').quit).toBe(true);
    expect(press(settled, data(), '7').quit).toBeUndefined();
  });

  it('puts what needs attention first on home, each row jumping to its fix', () => {
    const none = data({ config: fileConfig({}) });
    expect(render(initialState, plain, none).join('\n')).toMatch(/Needs attention[\s\S]*Add your first connection/);
    expect(where(press(initialState, none, '1'))).toBe('add-area');

    const untested = press(initialState, data(), '1');
    expect(untested.pending?.steps.map((s) => s.args)).toEqual([['connections', 'test', 'jira']]);

    const rejected = { ...initialState, session: { health: { jira: { ok: false as const, code: 'AUTH', message: 'Jira rejected the token.' } } } };
    expect(render(rejected, plain, data()).join('\n')).toContain('jira: sign-in rejected');
    const opened = press(rejected, data(), '1');
    expect(top(opened)).toMatchObject({ view: 'connection', params: { name: 'jira' } });
    expect(render(opened, plain, data()).join('\n')).toMatch(/AUTH: Jira rejected the token\./);
  });

  it('shows the config error as the one thing needing attention, and opens the health check on it', () => {
    const broken = data({ config: { error: { code: 'CONFIG_INVALID', message: 'not valid JSON', fix: 'Fix the JSON.' } } });
    expect(render(initialState, plain, broken).join('\n')).toContain('Config: CONFIG_INVALID');
    expect(where(press(initialState, broken, '1'))).toBe('health');
  });

  it("offers a file connection's actions, each one a real connections command", () => {
    const d = data({ config: fileConfig({ jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'keychain:jira.apiToken' } }) });
    const conn = press(settled, d, '2', '1');
    expect(top(conn)).toMatchObject({ view: 'connection', params: { name: 'jira' } });
    const text = render(conn, plain, d).join('\n');
    for (const label of ['Test it', 'Sign in again', 'Turn writes on', 'Remove']) expect(text).toContain(label);
    expect(press(conn, d, '1').pending?.steps.map((s) => s.args)).toEqual([['connections', 'test', 'jira']]);
    expect(press(conn, d, '2').pending?.steps.map((s) => s.args)).toEqual([
      ['connections', 'login', 'jira'],
      ['connections', 'test', 'jira'],
    ]);
    expect(press(conn, d, '3').pending?.steps.map((s) => s.args)).toEqual([['connections', 'writes', 'jira', 'on']]);
  });

  it('removes a connection only once its name is typed back', () => {
    const d = data({ config: fileConfig({ jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'keychain:jira.apiToken' } }) });
    const remove = press(settled, d, '2', '1', '4');
    expect(where(remove)).toBe('remove');
    const wrong = press(type(remove, d, 'jir'), d, 'return');
    expect(wrong.pending).toBeUndefined();
    expect(render(wrong, plain, d).join('\n')).toContain(`That isn't "jira"`);
    // q is a letter in a text field, not a way out.
    expect(press(remove, d, 'q').quit).toBeUndefined();
    const right = press(type(remove, d, 'jira'), d, 'return');
    expect(right.pending?.steps.map((s) => s.args)).toEqual([['connections', 'remove', 'jira']]);
  });

  it('only tests a connection defined by env vars, since there is nothing in the file to change', () => {
    const conn = press(settled, data(), '2', '1');
    const text = render(conn, plain, data()).join('\n');
    expect(text).toContain('Defined by env vars');
    expect(text).not.toContain('Turn writes on');
  });

  it('walks the add wizard: service, then name, then the real add and test commands, in four numbered steps', () => {
    const d = data();
    const service = press(settled, d, '2', 'down', 'return');
    expect(where(service)).toBe('add-area');
    expect(render(service, plain, d).join('\n')).toContain('Step 1 of 4: service');
    const named = press(service, d, '2');
    expect(top(named)).toMatchObject({ view: 'add-name', params: { area: 'confluence' } });
    // The suggestion is the area's own name, and enter accepts it.
    expect(render(named, plain, d).join('\n')).toMatch(/Step 2 of 4: name[\s\S]*Connection name: confluence/);
    const bad = press(named, d, 'backspace', 'backspace', ...'!!'.split(''), 'return');
    expect(top(bad).error).toMatch(/lowercase/);
    // Esc goes back a step; the answer is still there on the way forward again.
    const back = press(type(named, d, '-2'), d, 'escape');
    expect(where(back)).toBe('add-area');
    const run = press(named, d, 'return').pending!;
    expect(run.steps.map((s) => [s.args, s.label])).toEqual([
      [['connections', 'add', 'confluence', '--area', 'confluence'], 'Step 3 of 4: settings and secret'],
      [['connections', 'test', 'confluence'], 'Step 4 of 4: live test'],
    ]);
    expect(press(named, d, 'return').stack.map((f) => f.view)).toEqual(['home', 'connections', 'add-area', 'add-name']);
  });

  it('after a run, records the health it found, shows each command and its outcome, and goes where the run says', () => {
    const d = data();
    const started = press(settled, d, '2', 'down', 'return', '2', 'return');
    const ok: Envelope = { ok: true, data: { name: 'confluence', area: 'confluence', configFile: '/home/test/.toil/config.json' }, error: null, meta: { command: 'connections add', durationMs: 1, version: '0' } };
    const tested: Envelope = { ok: false, data: null, error: { code: 'AUTH', message: 'Confluence rejected the token.', fix: 'Make a new one.' }, meta: { command: 'connections test', durationMs: 1, version: '0' } };
    const done = finish(started, [
      { args: ['connections', 'add', 'confluence', '--area', 'confluence'], envelope: ok },
      { args: ['connections', 'test', 'confluence'], envelope: tested },
    ]);
    expect(done.pending).toBeUndefined();
    expect(done.session.health.confluence).toMatchObject({ ok: false, code: 'AUTH' });
    const screen = render(done, plain, d).join('\n');
    expect(screen).toContain('$ toil connections add confluence --area confluence');
    expect(screen).toContain('Saved confluence (confluence)');
    expect(screen).toMatch(/AUTH: Confluence rejected the token\.[\s\S]*Fix: Make a new one\./);
    // Continue lands on the new connection, under Connections, with the result off the stack.
    const after = press(done, d, 'return');
    expect(after.stack.map((f) => f.view)).toEqual(['home', 'connections', 'connection']);
    expect(top(after).params).toEqual({ name: 'confluence' });
  });

  it('asks which areas an agent should see, and prints the snippet for just those', () => {
    const d = data({ mcpAreas: ['confluence', 'jira'] });
    const areas = press(settled, d, '3', '1');
    expect(where(areas)).toBe('agent-areas');
    const snippet = press(areas, d, 'down', ' ', 'return');
    expect(top(snippet)).toMatchObject({ view: 'agent', params: { client: 'claude', areas: 'jira' } });
    expect(render(snippet, plain, d).join('\n')).toContain('claude mcp add toil -- toil mcp --areas jira');
    expect(render(press(areas, d, 'return'), plain, d).join('\n')).toContain('claude mcp add toil -- toil mcp\n');
  });

  it('renders every screen without throwing, with a breadcrumb, at any width, never past the edge', () => {
    const d = data();
    for (const keys of [[], ['1'], ['2'], ['2', '1'], ['2', 'down', 'return'], ['2', 'down', 'return', '1'], ['3'], ['3', '1'], ['3', '1', 'return'], ['4']]) {
      for (const columns of [40, 80, 120]) {
        const lines = render(press(settled, d, ...keys), { ...plain, columns, rows: 30 }, d);
        expect(lines.join('\n')).toContain('toil');
        for (const line of lines) expect(visibleLength(line)).toBeLessThan(columns);
      }
    }
    expect(render(press(settled, d, '2'), plain, d).join('\n')).toContain('toil › Connections');
    expect(render(press(settled, d, '2'), ascii, d).join('\n')).toContain('toil > Connections');
  });

  it('scrolls a long list to keep the selection in view on a short terminal', () => {
    const d = data({ areas: Array.from({ length: 30 }, (_, i) => ({ name: `area-${i}`, description: '', signsIn: true, live: true, configurable: true })) });
    const wizard = press(settled, d, '2', 'down', 'return', ...Array(20).fill('down'));
    const lines = render(wizard, { ...plain, rows: 24 }, d);
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.join('\n')).toContain('area-20');
    expect(lines.join('\n')).toMatch(/↑ \d+ more/);
  });
});

describe('Ctrl+C', () => {
  it('exits only on a second press within the window', () => {
    let t = 0;
    const press = doubleTap(2000, () => t);
    expect(press()).toBe(false);
    t = 1500;
    expect(press()).toBe(true);
  });

  it('starts over when the second press comes too late, or after an exit', () => {
    let t = 0;
    const press = doubleTap(2000, () => t);
    press();
    t = 5000;
    expect(press()).toBe(false);
    t = 5100;
    expect(press()).toBe(true);
    t = 5200;
    expect(press()).toBe(false);
  });

  it('shows the notice in the menu footer in place of the key hints', () => {
    const lines = render(initialState, plain, data(), 'Press Ctrl+C again to exit.').join('\n');
    expect(lines).toContain('Press Ctrl+C again to exit.');
    expect(lines).not.toContain('jump');
  });
});

describe('the screens', () => {
  it('show a config that will not load as a finding with its fix, not a crash', () => {
    const broken = data({ config: { error: { code: 'CONFIG_INVALID', message: 'not valid JSON', fix: 'Fix the JSON.' } } });
    expect(healthScreen(plain, broken).join('\n')).toMatch(/CONFIG_INVALID[\s\S]*Fix: Fix the JSON\./);
    expect(connectionsScreen(plain, broken).join('\n')).toContain('Health check');
  });

  it('list connections with area, host, writes, where they came from and health, never a token', () => {
    const text = connectionsScreen(plain, data()).join('\n');
    expect(text).toMatch(/jira\s+jira\s+jira\.imagile\.dev\s+read only\s+env\s+not tested/);
    expect(text).not.toContain('token');
    expect(connectionsScreen(plain, data(), { health: { jira: { ok: true, live: true } } }).join('\n')).toContain('healthy');
  });

  it('show what this folder is: the repository, its branch and remote, or that it is in none', () => {
    const inRepo = data({ folder: { cwd: '/work/toil', repo: { root: '/work/toil', branch: 'main', remote: 'https://github.com/imagile-dev/toil.git' } } });
    expect(healthScreen(plain, inRepo).join('\n')).toMatch(/Repo\s+\/work\/toil[\s\S]*Branch\s+main\s+from https:\/\/github.com\/imagile-dev\/toil.git/);
    expect(healthScreen(plain, data()).join('\n')).toContain('not in a git repository');
  });

  it('give each agent client a snippet that runs toil mcp the way this toil was started', () => {
    const fromClone = data({ launch: launchCommand('C:\\Code\\toil\\dist\\toil.js') });
    expect(agentScreen(plain, fromClone, 'claude').join('\n')).toContain('claude mcp add toil -- node C:/Code/toil/dist/toil.js mcp');
    expect(agentScreen(plain, data(), 'codex').join('\n')).toContain('args = ["mcp"]');
    expect(agentScreen(plain, data(), 'codex', ['jira', 'confluence']).join('\n')).toContain('args = ["mcp", "--areas", "jira,confluence"]');
    const vscode = agentScreen(plain, data(), 'vscode').join('\n');
    expect(vscode).toContain('"command": "toil"');
    expect(launchCommand('/usr/lib/node_modules/@imagile-dev/toil/dist/toil.js')).toEqual({ command: 'toil', args: [] });
  });

  it('cut a line to the window without counting or breaking colour codes', () => {
    const line = `\x1b[38;2;1;2;3mabcdef\x1b[0mghij`;
    expect(visibleLength(fitLine(line, 8))).toBe(8);
    expect(fitLine(line, 8).endsWith('\x1b[0m')).toBe(true);
    expect(fitLine('short', 8)).toBe('short');
  });

  it('wrap a line at a space on the window edge without gluing the next word on', () => {
    // Regression: a space landing exactly on the edge was dropped, giving "tallerand".
    const text = `  ${'x'.repeat(70)} taller and a little more`;
    const lines = wrapLine(text, 80);
    expect(lines.join(' ')).not.toMatch(/tallerand|anda/);
    expect(lines.map((l) => l.trim().split(/\s+/)).flat()).toEqual(text.trim().split(/\s+/));
    for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(80);
    // Every width around the edge keeps every word whole.
    for (let width = 75; width <= 85; width++) expect(wrapLine(text, width).map((l) => l.trim()).join(' ')).toBe(text.trim());
  });
});

describe('the welcome loop', () => {
  // A terminal made of plain objects: keys go in as keypress events, and
  // everything written comes out in `screen`.
  function fakeTerminal() {
    const input = Object.assign(new EventEmitter(), { isTTY: true, setRawMode: () => input, resume: () => input, pause: () => input });
    let screen = '';
    const output = Object.assign(new EventEmitter(), { isTTY: true, columns: 120, rows: 40, getColorDepth: () => 1, write: (t: string) => ((screen += t), true) });
    const signals = new EventEmitter();
    const ctrlC = () => input.emit('keypress', '\x03', { ctrl: true, name: 'c' });
    const key = (name: string) => input.emit('keypress', name, { name, sequence: name });
    return { input, output, signals, ctrlC, key, screen: () => screen };
  }

  async function start(t: ReturnType<typeof fakeTerminal>) {
    const ended = runWelcome(
      { input: t.input as never, output: t.output as never, env: { TOIL_NO_ANIMATION: '1' }, signals: t.signals as never },
      data(),
    );
    await vi.advanceTimersByTimeAsync(10);
    return ended;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('warns on the first Ctrl+C and exits on the second, restoring the terminal', async () => {
    const t = fakeTerminal();
    const ended = start(t);
    await vi.advanceTimersByTimeAsync(10);
    t.ctrlC();
    expect(t.screen()).toContain('Press Ctrl+C again to exit.');
    t.ctrlC();
    await expect(ended).resolves.toBe('interrupted');
    expect(t.screen()).toContain('\x1b[?1049l');
    expect(t.screen()).toContain('\x1b[?25h');
  });

  it('starts over when the second Ctrl+C comes after the window, and q still quits at once', async () => {
    const t = fakeTerminal();
    const ended = start(t);
    await vi.advanceTimersByTimeAsync(10);
    t.ctrlC();
    await vi.advanceTimersByTimeAsync(CTRL_C_WINDOW_MS + 500);
    t.ctrlC();
    t.key('q');
    await expect(ended).resolves.toBe('quit');
  });

  const answered: Envelope = {
    ok: true,
    data: { name: 'jira', area: 'jira', host: 'jira.imagile.dev', live: true, request: 'GET /rest/api/2/myself' },
    error: null,
    meta: { command: 'connections test', durationMs: 1, version: '0' },
  };

  it('runs a chosen command with the menu out of the way, then shows what it returned', async () => {
    const t = fakeTerminal();
    const raw: boolean[] = [];
    t.input.setRawMode = ((on: boolean) => (raw.push(on), t.input)) as never;
    const calls: string[][] = [];
    const ended = runWelcome(
      { input: t.input as never, output: t.output as never, env: { TOIL_NO_ANIMATION: '1' }, signals: t.signals as never, run: async (args) => (calls.push(args), answered), reload: () => data() },
      data(),
    );
    await vi.advanceTimersByTimeAsync(10);
    // Row 1 on an untested home is "Test your connections".
    t.key('1');
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual([['connections', 'test', 'jira']]);
    // Raw mode is off while the command runs (its prompts read whole lines), and back on after.
    expect(raw.slice(-2)).toEqual([false, true]);
    expect(t.screen()).toContain('$ toil connections test jira');
    expect(t.screen()).toContain('jira answered GET /rest/api/2/myself on jira.imagile.dev.');
    t.key('return');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.screen()).toContain('1 healthy');
    t.key('q');
    await expect(ended).resolves.toBe('quit');
  });

  it('ignores menu keys while a command runs, and Ctrl+C cancels that command, not the menu', async () => {
    const t = fakeTerminal();
    let signal: AbortSignal | undefined;
    const run = (_args: string[], s: AbortSignal) =>
      new Promise<Envelope>((resolve) => {
        signal = s;
        s.addEventListener('abort', () => resolve({ ok: false, data: null, error: { code: 'CANCELLED', message: 'connections test was cancelled.' }, meta: { command: 'connections test', durationMs: 1, version: '0' } }));
      });
    const ended = runWelcome({ input: t.input as never, output: t.output as never, env: { TOIL_NO_ANIMATION: '1' }, signals: t.signals as never, run, reload: () => data() }, data());
    await vi.advanceTimersByTimeAsync(10);
    t.key('1');
    await vi.advanceTimersByTimeAsync(10);
    t.key('q');
    t.ctrlC();
    await vi.advanceTimersByTimeAsync(10);
    expect(signal?.aborted).toBe(true);
    expect(t.screen()).toContain('CANCELLED: connections test was cancelled.');
    t.key('q');
    await expect(ended).resolves.toBe('quit');
  });

  it('treats SIGINT the same as a Ctrl+C keypress, and stops listening once it exits', async () => {
    const t = fakeTerminal();
    const ended = start(t);
    await vi.advanceTimersByTimeAsync(10);
    t.signals.emit('SIGINT');
    t.signals.emit('SIGINT');
    await expect(ended).resolves.toBe('interrupted');
    expect(t.signals.listenerCount('SIGINT')).toBe(0);
  });
});
