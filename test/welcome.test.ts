import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION, logoCells, logoFrame, sceneAt, SIGNALS, SPIN } from '../src/welcome/logo.js';
import { initialState, reduce, render, type MenuState } from '../src/welcome/menu.js';
import { agentScreen, connectionsScreen, healthScreen, type WelcomeData } from '../src/welcome/screens.js';
import { launchCommand } from '../src/welcome/data.js';
import { playSplash, SPEED, splashFrame, TAGLINE } from '../src/welcome/splash.js';
import { detectCaps, PALETTE, visibleLength } from '../src/welcome/term.js';
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
  const press = (state: MenuState, ...keys: Array<string | { name: string; ctrl?: boolean }>) =>
    keys.reduce((s, k) => reduce(s, typeof k === 'string' ? (k.length === 1 ? { sequence: k, name: k } : { name: k }) : k), state);

  it('moves with arrows or j/k, wrapping at both ends', () => {
    expect(press(initialState, 'down', 'down').selected).toBe(2);
    expect(press(initialState, 'up').selected).toBe(4);
    expect(press(initialState, 'j', 'k', 'k').selected).toBe(4);
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

  it('quits with q or the Quit entry; Ctrl+C is left to the loop, which wants it twice', () => {
    expect(press(initialState, 'q').quit).toBe(true);
    expect(press(initialState, { name: 'c', ctrl: true }).quit).toBeUndefined();
    expect(press(initialState, '5').quit).toBe(true);
    expect(press(initialState, '6').quit).toBeUndefined();
  });

  it('renders every screen without throwing, with a breadcrumb', () => {
    for (const keys of [[], ['1'], ['2'], ['3'], ['3', '1'], ['4']]) {
      const lines = render(press(initialState, ...keys), plain, data()).join('\n');
      expect(lines).toContain('toil');
    }
    expect(render(press(initialState, '2'), plain, data()).join('\n')).toContain('toil › Connections');
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
    expect(lines).not.toContain('1-5 jump');
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
    expect(text).toContain('toil connections add <name>');
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
