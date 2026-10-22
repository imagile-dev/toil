import { connectionNames, folderLines, statusLine } from '../screens.js';
import { PALETTE, paint } from '../term.js';
import type { Item, View, ViewProps } from '../view.js';
import { testAll } from './connections.js';

/**
 * Home: what this folder resolves to, anything that needs attention, and the
 * modules. A "needs attention" row jumps straight to its fix, which is more
 * than most escalation paths manage.
 */

/** One row on the home screen per menu module, in order. A new module adds its row here. */
export interface HomeEntry {
  label: string;
  hint: string;
  view: string;
}

export function homeView(entries: readonly HomeEntry[]): View {
  return {
    title: () => '',
    body: (caps, p) => [statusLine(caps, p.data, p.session), '', ...folderLines(caps, p.data), ...(attention(p).length ? ['', paint(caps, PALETTE.danger, 'Needs attention')] : [])],
    items: (p) => [
      ...attention(p),
      ...entries.map((e): Item => ({ label: e.label, hint: e.hint, action: { go: e.view } })),
      { label: 'Quit', hint: 'Back to your shell', action: { quit: true } },
    ],
  };
}

/** The "needs attention" rows: a config that won't load, its warnings, failed tests, or nothing set up yet. */
export function attention({ data, session }: ViewProps): Item[] {
  if ('error' in data.config) return [{ label: `Config: ${data.config.error.code}`, hint: 'See what is wrong and the fix', action: { go: 'health' }, attention: true }];
  const items: Item[] = [];
  const warnings = data.config.warnings.length;
  if (warnings) items.push({ label: `${warnings} config warning${warnings === 1 ? '' : 's'}`, hint: 'See them in Health check', action: { go: 'health' }, attention: true });
  for (const name of connectionNames(data)) {
    const health = session.health[name];
    if (!health || health.ok) continue;
    const signIn = health.code === 'AUTH' || health.code === 'CONFIG_INVALID' || health.code === 'CONFIG_SECRET_UNRESOLVED';
    items.push({ label: `${name}: ${health.code === 'AUTH' ? 'sign-in rejected' : health.code}`, hint: signIn ? 'Sign in again' : 'Open the connection', action: { go: 'connection', params: { name } }, attention: true });
  }
  const names = connectionNames(data);
  if (names.length === 0) items.push({ label: 'Add your first connection', hint: 'Pick a service, sign in, test it', action: { go: 'add-area' }, attention: true });
  else if (names.every((name) => !session.health[name])) items.push({ label: 'Test your connections', hint: 'One read against each, to see which work', action: { run: testAll(names) }, attention: true });
  return items;
}
