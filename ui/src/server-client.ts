/**
 * The page's side of the local server's API (ui/server/server.ts). The App is
 * built on two seams, `execute()` and the `Agent`; here each is an HTTP call to
 * the server, which hands it to the Store or Agent chosen at startup. Paths are
 * relative to the page, so the app works under any base path, and nothing
 * here assumes the server is on the same machine (#206, Hosting-ready by
 * design).
 *
 * The page signs in by trading the launch token in its URL for a session id,
 * which it keeps in memory only and sends as `X-Toil-UI-Session` on every
 * call, with the session's CSRF token on every POST. No cookie: a browser
 * would hand one to every server on 127.0.0.1. A reload forgets the id, so it
 * needs the launch URL again. Paperwork, but the kind that files itself.
 */

import { NO_AGENT_FIX, NO_AGENT_NOTICE, type Agent, type Answer, type Starter } from './agent.ts';
import type { AreaInfo, ConfigApi, SettingsInfo } from './config.ts';
import type { SyncStatus } from '../server/sync.ts';
import type { Envelope, Execute } from './toil.ts';

export type { DossierState, SourceState } from '../server/cache.ts';
export type { SyncJob, SyncStatus } from '../server/sync.ts';
import type { AgentStatus } from '../server/agents/host.ts';
import type { AgentSettings } from '../server/agents/settings.ts';
export type { AdapterStatus, AgentStatus } from '../server/agents/host.ts';
export type { AgentSettings } from '../server/agents/settings.ts';

export interface Session {
  /** The session id, sent as X-Toil-UI-Session. */
  session: string;
  csrf: string;
  version: string;
  toil: { version: string; contractVersion: number };
  viewer: { id: string; name: string };
  store: string;
  /** The server keeps a cache and syncs it (#250); false with sample data. */
  sync: boolean;
  agent: string;
  /** The agent can be chosen in Settings (#251); false with sample data. */
  agentSettings?: boolean;
  sample: boolean;
  now: string;
}

const SESSION_HEADER = 'X-Toil-UI-Session';
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

/**
 * Signs in with the launch token in the page's URL, then takes the token out
 * of the address bar and the history. Without one (a reload, a bookmark)
 * it says to open the launch URL again.
 */
export async function signIn(base = './', location: Pick<Location, 'search' | 'pathname' | 'hash'> = window.location, history: Pick<History, 'replaceState'> = window.history): Promise<Session> {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) throw new Error('This page needs the URL toil-ui printed when it started, which carries the launch token. A reloaded page forgets its session, so open that URL again.');
  const res = await fetch(`${base}api/session`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  if (!res.ok) throw await failure(res, 'Signing in');
  return (await res.json()) as Session;
}

const call = (base: string, session: Session, path: string, init: { body?: unknown; signal?: AbortSignal } = {}) =>
  fetch(`${base}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: {
      [SESSION_HEADER]: session.session,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json', [CSRF_HEADER]: session.csrf }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: init.signal,
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
    const res = await call(base, session, 'api/execute', { body: { command, input }, signal: options.signal });
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

/** The sync job over the server (#250): its status, a start, and the wipe. Each throws with the server's message. */
export interface SyncClient {
  status(): Promise<SyncStatus>;
  /** Every dossier, or the one named. */
  start(dossier?: string): Promise<SyncStatus>;
  wipe(): Promise<SyncStatus>;
}

export function httpSync(session: Session, base = './'): SyncClient {
  const answer = async (res: Response, what: string) => {
    if (!res.ok) throw await failure(res, what);
    return (await res.json()) as SyncStatus;
  };
  return {
    status: async () => answer(await call(base, session, 'api/sync'), 'Reading the sync status'),
    start: async (dossier) => answer(await call(base, session, 'api/sync', { body: dossier === undefined ? {} : { dossier } }), 'Starting the sync'),
    wipe: async () => answer(await call(base, session, 'api/cache/wipe', { body: { confirm: 'wipe' } }), 'Wiping the cache'),
  };
}

/**
 * The settings pages' calls (src/config.ts) over the server's `/api/config`.
 * The server decides which commands run and how; the page sends the command,
 * its input, and what the person typed for its questions. A secret travels in
 * this one request body and is not kept here after it.
 */
export function httpConfig(session: Session, base = './'): ConfigApi {
  const get = async <T,>(path: string): Promise<T> => {
    const res = await call(base, session, path);
    if (!res.ok) throw await failure(res, path);
    return (await res.json()) as T;
  };
  return {
    disabled: null,
    areas: () => get<AreaInfo[]>('api/config/areas'),
    settings: () => get<SettingsInfo>('api/config/settings'),
    async run(command, input, answers = {}) {
      const res = await call(base, session, 'api/config', { body: { command, input, ...answers } });
      let body: unknown;
      try {
        body = await res.clone().json();
      } catch {
        body = undefined;
      }
      if (isEnvelope(body)) return body;
      throw await failure(res, `toil ${command}`);
    },
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
      const res = await call(base, session, `api/agent/starters?dossier=${encodeURIComponent(name)}`);
      starters.set(name, res.ok ? ((await res.json()) as Starter[]) : []);
    }
  }
  return {
    ...(session.agent === 'none' ? { notice: `${NO_AGENT_NOTICE} ${NO_AGENT_FIX}` } : {}),
    starters: (dossier) => starters.get(dossier) ?? [],
    async ask(dossier, prompt) {
      const res = await call(base, session, 'api/agent/ask', { body: { dossier, prompt } });
      if (!res.ok) throw await failure(res, 'The question');
      return (await res.json()) as Answer;
    },
    async *stream(dossier, prompt, signal) {
      const res = await call(base, session, 'api/agent/ask', { body: { dossier, prompt, stream: true }, ...(signal ? { signal } : {}) });
      if (!res.ok) throw await failure(res, 'The question');
      if (!/^application\/x-ndjson/.test(res.headers.get('content-type') ?? '')) {
        yield (await res.json()) as Answer;
        return;
      }
      yield* answerLines(res);
    },
  };
}

/** One streamed answer's NDJSON lines (server.ts, streamAnswer): each answer as it grows, then done or an error. */
export async function* answerLines(res: Response): AsyncIterable<Answer> {
  if (!res.body) throw new Error('The answer arrived with no body.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const line = (text: string): Answer | null => {
    const msg = JSON.parse(text) as { answer?: Answer; done?: boolean; error?: { message?: string; fix?: string } };
    if (msg.error) throw new Error(`${msg.error.message ?? 'The agent failed.'}${msg.error.fix ? ` ${msg.error.fix}` : ''}`);
    if (msg.done) done = true;
    return msg.answer ?? null;
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!text) continue;
      const answer = line(text);
      if (answer) yield answer;
    }
    if (end) break;
  }
  if (buffer.trim()) {
    const answer = line(buffer.trim());
    if (answer) yield answer;
  }
  if (!done) throw new Error('The answer stopped partway: the connection to Toil UI closed.');
}

/** What Settings shows and changes about the agent (#251): server/agents/host.ts's status. */
export interface AgentSettingsClient {
  status(): Promise<AgentStatus>;
  save(settings: AgentSettings): Promise<AgentStatus>;
}

export function httpAgentSettings(session: Session, base = './'): AgentSettingsClient {
  const answer = async (res: Response, what: string) => {
    if (!res.ok) throw await failure(res, what);
    return (await res.json()) as AgentStatus;
  };
  return {
    status: async () => answer(await call(base, session, 'api/agent/settings'), 'Reading the agent settings'),
    save: async (settings) => answer(await call(base, session, 'api/agent/settings', { body: settings }), 'Saving the agent settings'),
  };
}
