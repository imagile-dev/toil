/**
 * The page's side of the local server's API (ui/server/server.ts). The App is
 * built on two seams, `execute()` and the `Agent`; here each is an HTTP call to
 * the server, which hands it to the Store or Agent chosen at startup. Paths are
 * relative to the page, so the app works under any base path, and nothing
 * here assumes the server is on the same machine (#206, Hosting-ready by
 * design). Every POST carries the session's CSRF token. Paperwork, but the
 * kind that files itself.
 */

import type { Agent, Answer, Starter } from './agent.ts';
import type { Envelope, Execute } from './toil.ts';

export interface Session {
  version: string;
  toil: { version: string; contractVersion: number };
  viewer: { id: string; name: string };
  store: string;
  agent: string;
  sample: boolean;
  now: string;
  csrf: string;
}

const CSRF_HEADER = 'X-Toil-UI-CSRF';

/** The server's error body, as a message the page can show. */
async function failure(res: Response, what: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string; fix?: string } };
    if (body.error?.message) return new Error(`${body.error.message}${body.error.fix ? ` ${body.error.fix}` : ''}`);
  } catch {
    // Not JSON: fall through to the status.
  }
  return new Error(`${what} failed: the server answered ${res.status}.`);
}

export async function loadSession(base = './'): Promise<Session> {
  const res = await fetch(`${base}api/session`, { credentials: 'same-origin' });
  if (!res.ok) throw await failure(res, 'Reading the session');
  return (await res.json()) as Session;
}

const post = (base: string, session: Session, path: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: session.csrf },
    body: JSON.stringify(body),
    signal,
  });

const isEnvelope = (v: unknown): v is Envelope => typeof v === 'object' && v !== null && 'ok' in v && 'meta' in v;

/**
 * `execute()` over the server. The server decides what the call may do (reads
 * only, always read-only), so the options' `readOnly` and `caller` aren't
 * sent: the page can't loosen them. A refusal is toil's own envelope, shown on
 * its panel like any failed call.
 */
export function httpExecute(session: Session, base = './'): Execute {
  return async (command, input = {}, options = {}) => {
    const res = await post(base, session, 'api/execute', { command, input }, options.signal);
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      body = undefined;
    }
    if (isEnvelope(body)) return body;
    throw await failure(res, `toil ${command}`);
  };
}

/**
 * The Agent over the server. The App asks for starters while it renders, so
 * they're fetched for each dossier before it mounts.
 */
export async function httpAgent(session: Session, dossiers: string[], base = './'): Promise<Agent> {
  const starters = new Map<string, Starter[]>();
  if (session.agent !== 'none') {
    for (const name of dossiers) {
      const res = await fetch(`${base}api/agent/starters?dossier=${encodeURIComponent(name)}`, { credentials: 'same-origin' });
      starters.set(name, res.ok ? ((await res.json()) as Starter[]) : []);
    }
  }
  return {
    starters: (dossier) => starters.get(dossier) ?? [],
    async ask(dossier, prompt) {
      const res = await post(base, session, 'api/agent/ask', { dossier, prompt });
      if (!res.ok) throw await failure(res, 'The question');
      return (await res.json()) as Answer;
    },
  };
}
