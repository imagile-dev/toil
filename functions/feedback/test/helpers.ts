// Fakes for every edge of the backend: tables in memory, GitHub and Turnstile
// behind a fetch that answers only the routes a test names, and a mailer that
// keeps what it was asked to send. Nothing here reaches a network.

import { generateKeyPairSync } from 'node:crypto';
import { readSettings, type Settings } from '../src/lib/config.js';
import type { Message, Mailer } from '../src/lib/email.js';
import { GitHub } from '../src/lib/github.js';
import type { Deps, Log } from '../src/lib/handlers.js';
import { TABLE_NAMES, type Entity, type Stored, type Table, type Tables } from '../src/lib/tables.js';

export function memoryTables(): Tables & { dump(name: keyof Tables): Stored[] } {
  const data = new Map<string, Map<string, Stored>>();
  let version = 0;
  const make = (name: string): Table => {
    const rows = () => data.get(name) ?? data.set(name, new Map()).get(name)!;
    const key = (pk: string, rk: string) => `${pk}\u0000${rk}`;
    const clone = <T>(value: T): T => structuredClone(value);
    return {
      async get(pk, rk) {
        const row = rows().get(key(pk, rk));
        return row ? clone(row) : undefined;
      },
      async create(entity: Entity) {
        if (rows().has(key(entity.partitionKey, entity.rowKey))) return false;
        rows().set(key(entity.partitionKey, entity.rowKey), { ...clone(entity), etag: String(++version) });
        return true;
      },
      async replace(entity: Stored) {
        const current = rows().get(key(entity.partitionKey, entity.rowKey));
        if (!current || current.etag !== entity.etag) return false;
        rows().set(key(entity.partitionKey, entity.rowKey), { ...clone(entity), etag: String(++version) });
        return true;
      },
      async upsert(entity: Entity) {
        const row: Record<string, unknown> = clone(entity);
        delete row.etag;
        rows().set(key(entity.partitionKey, entity.rowKey), { ...row, etag: String(++version) } as Stored);
      },
      async delete(pk, rk) {
        rows().delete(key(pk, rk));
      },
      async list(pk) {
        return [...rows().values()].filter((row) => row.partitionKey === pk).sort((a, b) => (a.rowKey < b.rowKey ? -1 : 1)).map(clone);
      },
    };
  };
  const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, make(name)])) as Tables;
  return Object.assign(tables, { dump: (name: keyof Tables) => [...(data.get(name)?.values() ?? [])].map((row) => structuredClone(row)) });
}

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** A fetch that answers only the routes given, "METHOD url-or-prefix*", and throws on anything else. */
export function fakeFetch(routes: Record<string, Responder>) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body === undefined ? undefined : String(init.body);
    const call = { method, url, headers, body };
    calls.push(call);
    for (const [route, respond] of Object.entries(routes)) {
      const [m, pattern] = route.split(' ') as [string, string];
      if (m !== method) continue;
      if (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern) return respond(call);
    }
    throw new Error(`No route for ${method} ${url}`);
  }) as typeof fetch;
  return { fetch: fetcher, calls };
}

export const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const { privateKey: TEST_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const API = 'https://api.github.com';
export const REPO = 'imagile-dev/toil';
export const ORIGIN = 'https://imagile-dev.github.io';
export const SHA = 'abc12345'.repeat(5);

/** GitHub's App and installation-token routes, which every GitHub test needs. */
export const appRoutes: Record<string, Responder> = {
  [`GET ${API}/repos/${REPO}/installation`]: () => json(200, { id: 42 }),
  [`POST ${API}/app/installations/42/access_tokens`]: (call) =>
    json(201, { token: `ghs_${Object.keys(JSON.parse(call.body!).permissions).join('_')}`, expires_at: '2026-10-18T13:00:00Z' }),
};

export function mailer(failing = false): Mailer & { sent: Message[] } {
  const sent: Message[] = [];
  return {
    sent,
    async send(message) {
      if (failing) throw new Error('ACS refused the message');
      sent.push(message);
    },
  };
}

export function logger(): Log & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`) };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...readSettings({
      GITHUB_APP_ID: '4428945',
      GITHUB_APP_PRIVATE_KEY: TEST_KEY,
      TURNSTILE_SECRET: 'turnstile-test-secret',
      SMOKE_TEST_KEY: 'smoke-test-key',
      WEBHOOK_SECRET: 'webhook-test-secret',
      ACS_CONNECTION_STRING: 'endpoint=https://acs.imagile.dev/;accesskey=abc12345',
    }),
    ...overrides,
  };
}

export function deps(options: { routes?: Record<string, Responder>; now?: Date; settings?: Partial<Settings>; failingMail?: boolean; tables?: ReturnType<typeof memoryTables> } = {}) {
  const net = fakeFetch({ ...appRoutes, ...(options.routes ?? {}) });
  const tables = options.tables ?? memoryTables();
  const mail = mailer(options.failingMail);
  const log = logger();
  const now = options.now ?? new Date('2026-10-18T12:00:00Z');
  const s = settings(options.settings);
  let github: GitHub | undefined;
  const d: Deps = {
    settings: s,
    tables,
    github: () => (github ??= new GitHub({ appId: s.githubAppId!, privateKey: s.githubPrivateKey!, repo: s.repo, mainBranch: s.mainBranch, api: s.githubApi, fetch: net.fetch, now: () => now })),
    mailer: () => mail,
    fetch: net.fetch,
    now: () => now,
    log,
  };
  return { deps: d, calls: net.calls, tables, mail, log };
}

export function request(body: unknown, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  return { headers: h, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
