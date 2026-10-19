/**
 * The Agent, server side (#206, Reasoning on the subscription you already
 * have). The browser's `Agent` (src/agent.ts) becomes an HTTP call to this
 * one, which takes the viewer from the request, so the adapters #251 adds
 * (Claude, Copilot, Codex) run on the server with the viewer's own
 * subscription and never in the page. It answers and cites; it never writes.
 * Two ship now: the scripted Agent the preview uses, for `--sample`, and
 * `noAgent`, which says plainly that no adapter is set up. A help desk that
 * opens on schedule and admits when nobody is in.
 */

import type { Answer, Starter } from '../src/agent.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import type { RequestContext } from './context.ts';

export type { Answer, Starter } from '../src/agent.ts';

export interface Agent {
  /** `scripted`, `none`, and later the adapter's name: shown in the session. */
  readonly kind: string;
  /** The questions offered about one dossier before anyone types. */
  starters(ctx: RequestContext, dossier: string): Promise<Starter[]>;
  /** Answers about the named dossier only, citing every item it used. Throws with a message the pane shows. */
  ask(ctx: RequestContext, dossier: string, prompt: string): Promise<Answer>;
}

/** The preview's scripted Agent: canned answers about the sample dossiers. */
export function fixtureAgent(): Agent {
  const scripted = scriptedAgent();
  return {
    kind: 'scripted',
    starters: async (_ctx, dossier) => scripted.starters(dossier),
    ask: (_ctx, dossier, prompt) => scripted.ask(dossier, prompt),
  };
}

/** No adapter yet: no starters, and a question gets a plain answer saying so. */
export function noAgent(): Agent {
  return {
    kind: 'none',
    starters: async () => [],
    ask: async () => {
      throw new Error('No agent is set up in this Toil UI yet. The agent adapters (Claude, Copilot, Codex) come in a later alpha; until then the dashboards work without one.');
    },
  };
}
