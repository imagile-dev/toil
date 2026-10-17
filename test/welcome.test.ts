import { describe, expect, it } from 'vitest';
import { DURATION, logoFrame, sceneAt } from '../src/welcome/logo.js';
import { initialState, reduce, render, type MenuState } from '../src/welcome/menu.js';
import { agentScreen, connectionsScreen, healthScreen, type WelcomeData } from '../src/welcome/screens.js';
import { launchCommand } from '../src/welcome/data.js';
import { playSplash, splashFrame, TAGLINE } from '../src/welcome/splash.js';
import { detectCaps, visibleLength } from '../src/welcome/term.js';
import { wantsWelcome } from '../src/welcome/index.js';
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
  areas: ['jira'],
  launch: { command: 'toil', args: [] },
  ...over,
});

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

  it('fires one signal down the branches mid-animation, and none once it settles', () => {
    expect(sceneAt(1.3).signal).not.toBeNull();
    expect(sceneAt(DURATION + 1).signal).toBeNull();
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
  const press = (state: MenuState, ...keys: Array<string | { name: string; ctrl?: boolean }>) =>
    keys.reduce((s, k) => reduce(s, typeof k === 'string' ? (k.length === 1 ? { sequence: k, name: k } : { name: k }) : k), state);

  it('moves with arrows or j/k, wrapping at both ends', () => {
    expect(press(initialState, 'down', 'down').selected).toBe(2);
    expect(press(initialState, 'up').selected).toBe(5);
    expect(press(initialState, 'j', 'k', 'k').selected).toBe(5);
  });

  it('opens a screen with enter or its number, and goes back with esc to where it was', () => {
    expect(press(initialState, 'down', 'return').view).toBe('connections');
    expect(press(initialState, '1').view).toBe('health');
    const back = press(initialState, '3', 'escape');
    expect(back).toMatchObject({ view: 'home', selected: 2 });
  });

  it('walks to an agent snippet and back', () => {
    const codex = press(initialState, '3', 'down', 'return');
    expect(codex).toMatchObject({ view: 'agent', client: 'codex' });
    expect(press(codex, 'escape').view).toBe('agents');
  });

  it('quits with q, Ctrl+C or the Quit entry, and asks for a replay with its entry', () => {
    expect(press(initialState, 'q').quit).toBe(true);
    expect(press(initialState, { name: 'c', ctrl: true }).quit).toBe(true);
    expect(press(initialState, '6').quit).toBe(true);
    expect(press(initialState, '4').replay).toBe(true);
  });

  it('renders every screen without throwing, with a breadcrumb', () => {
    for (const keys of [[], ['1'], ['2'], ['3'], ['3', '1'], ['5']]) {
      const lines = render(press(initialState, ...keys), plain, data()).join('\n');
      expect(lines).toContain('toil');
    }
    expect(render(press(initialState, '2'), plain, data()).join('\n')).toContain('toil › Connections');
  });
});

describe('the screens', () => {
  it('show a config that will not load as a finding with its fix, not a crash', () => {
    const broken = data({ config: { error: { code: 'CONFIG_INVALID', message: 'not valid JSON', fix: 'Fix the JSON.' } } });
    expect(healthScreen(plain, broken).join('\n')).toMatch(/CONFIG_INVALID[\s\S]*Fix: Fix the JSON\./);
    expect(connectionsScreen(plain, broken).join('\n')).toContain('Health check');
  });

  it('list connections with area, host, writes and where they came from, never a token', () => {
    const text = connectionsScreen(plain, data()).join('\n');
    expect(text).toMatch(/jira\s+jira\s+jira\.imagile\.dev\s+read only\s+file/);
    expect(text).not.toContain('token');
  });

  it('give each agent client a snippet that runs toil mcp the way this toil was started', () => {
    const fromClone = data({ launch: launchCommand('C:\\Code\\toil\\dist\\toil.js') });
    expect(agentScreen(plain, fromClone, 'claude').join('\n')).toContain('claude mcp add toil -- node C:/Code/toil/dist/toil.js mcp');
    expect(agentScreen(plain, data(), 'codex').join('\n')).toContain('args = ["mcp"]');
    const vscode = agentScreen(plain, data(), 'vscode').join('\n');
    expect(vscode).toContain('"command": "toil"');
    expect(launchCommand('/usr/lib/node_modules/@imagile-dev/toil/dist/toil.js')).toEqual({ command: 'toil', args: [] });
  });
});
