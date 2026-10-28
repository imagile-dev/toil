/**
 * Which agent the chat answers with when nobody has picked one in it (#494):
 * the one last used for this dossier's Analyze, if it can still answer; else
 * the default from Settings, Agent, if it can; else nothing, which is the old
 * behaviour (the server tries Settings' choice and says why it can't). Pure,
 * so the order is tested without a page. Seating by precedent, then by policy.
 */

import type { AdapterList } from './agent.ts';

export type DefaultSource = 'dossier' | 'settings';

export interface DefaultAgent {
  name: string;
  source: DefaultSource;
}

/** The adapter an unpicked chat uses, and where that came from; null when neither is ready. */
export function defaultAgent(list: AdapterList | null): DefaultAgent | null {
  if (!list) return null;
  const ready = (name: string | null | undefined) => (name ? list.options.some((o) => o.name === name && o.ready) : false);
  if (list.remembered && ready(list.remembered)) return { name: list.remembered, source: 'dossier' };
  if (list.chosen && ready(list.chosen)) return { name: list.chosen, source: 'settings' };
  return null;
}

/** The few words beside "Answered by": where the agent in front of the person came from. */
export function sourceHint(picked: boolean, from: DefaultAgent | null): string | null {
  if (picked) return 'picked for this chat';
  if (!from) return null;
  return from.source === 'dossier' ? 'last used on this dossier' : 'your default';
}
