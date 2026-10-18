import { connectionNames, healthScreen, helpScreen } from '../screens.js';
import type { Item, View } from '../view.js';
import { testAll } from './connections.js';

/**
 * Health check and Help. The health check is one report: the config file,
 * this folder, and every connection as last tested, each failure linked to
 * the connection that can fix it. Help is reading matter, and like all the
 * best policy documents, it fits on one screen.
 */

export const healthView: View = {
  title: () => 'Health check',
  body: (caps, p) => healthScreen(caps, p.data, p.session),
  items: (p) => {
    const names = connectionNames(p.data);
    const failing = names.filter((name) => p.session.health[name] && !p.session.health[name]!.ok);
    return [
      ...(names.length ? [{ label: 'Test all connections', hint: 'One read against each', action: { run: testAll(names) } } satisfies Item] : []),
      ...failing.map((name): Item => ({ label: `Fix ${name}`, hint: 'Open the connection', action: { go: 'connection', params: { name } }, attention: true })),
    ];
  },
};

export const helpView: View = {
  title: () => 'Help',
  body: (caps, p) => helpScreen(caps, p.data),
};
