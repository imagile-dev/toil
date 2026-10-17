import { aboutScreen, AGENT_CLIENTS, agentScreen, type AgentClient, connectionsScreen, healthScreen, statusLine, type WelcomeData } from './screens.js';
import { wordmarkFrame } from './splash.js';
import { PALETTE, paint, type TermCaps } from './term.js';

/**
 * The main menu as a small state machine: `reduce(state, key)` returns the
 * next state, and `render(state)` returns the lines to draw. Neither touches
 * the terminal, so the whole menu is testable as data, and the loop that does
 * touch the terminal stays a few lines long. Five numbered options on one
 * screen: the rare phone tree that never says "please listen carefully".
 */

export type View = 'home' | 'health' | 'connections' | 'agents' | 'agent' | 'about';

export interface MenuState {
  view: View;
  /** Highlighted row on a list screen (home, agents). */
  selected: number;
  client?: AgentClient;
  quit?: boolean;
}

export interface Key {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
}

const HOME: Array<{ label: string; hint: string; go: View | 'quit' }> = [
  { label: 'Health check', hint: 'Config file, connections and warnings', go: 'health' },
  { label: 'Connections', hint: 'What toil can talk to, and with what', go: 'connections' },
  { label: 'Connect an agent', hint: 'Register toil mcp with Claude Code, Codex or VS Code', go: 'agents' },
  { label: 'About toil', hint: 'Version, docs, source', go: 'about' },
  { label: 'Quit', hint: 'Back to your shell', go: 'quit' },
];

export const initialState: MenuState = { view: 'home', selected: 0 };

const listLength = (view: View) => (view === 'home' ? HOME.length : view === 'agents' ? AGENT_CLIENTS.length : 0);
const parentOf = (view: View): View => (view === 'agent' ? 'agents' : 'home');

export function reduce(state: MenuState, key: Key): MenuState {
  const s: MenuState = { ...state };
  // Ctrl+C is the loop's to handle (twice to exit); q quits from anywhere.
  if (key.name === 'q' && !key.ctrl) return { ...s, quit: true };
  if (key.name === 'escape' || key.name === 'backspace' || key.name === 'left') {
    if (s.view === 'home') return s;
    const parent = parentOf(s.view);
    return { view: parent, selected: parent === 'home' ? HOME.findIndex((h) => h.go === s.view || (s.view === 'agent' && h.go === 'agents')) : 0 };
  }
  const n = listLength(s.view);
  if (n === 0) return s;
  if (key.name === 'up' || key.name === 'k') return { ...s, selected: (s.selected - 1 + n) % n };
  if (key.name === 'down' || key.name === 'j') return { ...s, selected: (s.selected + 1) % n };
  const digit = key.sequence && /^[1-9]$/.test(key.sequence) ? Number(key.sequence) - 1 : -1;
  if (digit >= 0 && digit < n) return choose({ ...s, selected: digit });
  if (key.name === 'return' || key.name === 'enter' || key.name === 'right') return choose(s);
  return s;
}

function choose(s: MenuState): MenuState {
  if (s.view === 'agents') return { view: 'agent', selected: 0, client: AGENT_CLIENTS[s.selected]!.id };
  const target = HOME[s.selected]!.go;
  if (target === 'quit') return { ...s, quit: true };
  return { view: target, selected: 0 };
}

const CRUMB: Record<View, string> = {
  home: '',
  health: 'Health check',
  connections: 'Connections',
  agents: 'Connect an agent',
  agent: 'Connect an agent',
  about: 'About toil',
};

export function render(state: MenuState, caps: Pick<TermCaps, 'colorDepth' | 'unicode'>, data: WelcomeData, notice = ''): string[] {
  const arrow = caps.unicode ? '›' : '>';
  const crumbs = ['toil', CRUMB[state.view], state.view === 'agent' ? AGENT_CLIENTS.find((c) => c.id === state.client)?.label : '']
    .filter(Boolean)
    .join(` ${arrow} `);
  const lines: string[] = ['', ...wordmarkFrame(99, caps).map((l) => `  ${l}`), ''];
  lines.push(`  ${paint(caps, PALETTE.amber, crumbs)}   ${statusLine(caps, data)}`, '');

  let body: string[];
  switch (state.view) {
    case 'home':
      body = list(caps, HOME.map((h) => [h.label, h.hint]), state.selected);
      break;
    case 'agents':
      body = [paint(caps, PALETTE.muted, 'Which agent?'), '', ...list(caps, AGENT_CLIENTS.map((c) => [c.label, '']), state.selected)];
      break;
    case 'agent':
      body = agentScreen(caps, data, state.client ?? 'claude');
      break;
    case 'health':
      body = healthScreen(caps, data);
      break;
    case 'connections':
      body = connectionsScreen(caps, data);
      break;
    case 'about':
      body = aboutScreen(caps, data);
      break;
  }
  lines.push(...body.map((l) => `  ${l}`), '');
  const keys = state.view === 'home' ? 'up/down move   enter select   1-5 jump   q quit' : listLength(state.view) ? 'up/down move   enter select   esc back   q quit' : 'esc back   q quit';
  lines.push(notice ? `  ${paint(caps, PALETTE.accent, notice)}` : `  ${paint(caps, PALETTE.faint, keys)}`);
  return lines;
}

function list(caps: Pick<TermCaps, 'colorDepth' | 'unicode'>, items: string[][], selected: number): string[] {
  const pointer = caps.unicode ? '▸' : '>';
  const width = Math.max(...items.map(([label]) => label!.length));
  return items.map(([label, hint], i) => {
    const on = i === selected;
    const mark = on ? paint(caps, PALETTE.accent, pointer) : ' ';
    const number = paint(caps, PALETTE.faint, `${i + 1}`);
    const text = on ? paint(caps, PALETTE.ink, label!.padEnd(width)) : paint(caps, PALETTE.muted, label!.padEnd(width));
    return `${mark} ${number}  ${text}   ${hint ? paint(caps, PALETTE.faint, hint) : ''}`;
  });
}
