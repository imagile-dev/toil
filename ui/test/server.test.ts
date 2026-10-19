// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fixtureAgent, noAgent, type Agent } from '../server/agent.ts';
import type { RequestContext } from '../server/context.ts';
import { CSRF_HEADER, MAX_BODY, MAX_SESSIONS, createUiServer, type UiServerOptions } from '../server/server.ts';
import { parseSettings, SettingsError, type Settings } from '../server/settings.ts';
import { CALLER, READ_COMMANDS, fixtureStore, toilStore, type Access, type Store } from '../server/store.ts';
import { CANNED } from '../src/fixtures/execute.ts';
import type { Envelope, Execute } from '../src/toil.ts';

/**
 * The local server, over real loopback sockets: the Host check, the launch
 * token and its session cookie, the POST checks (Origin, JSON, CSRF), the read
 * allowlist and the config allowlist, the viewer on every call, and the static
 * files. node:http's own client sends whatever Host and Origin a test names,
 * which is how a rebinding page or a foreign origin is played.
 */

const TOKEN = 'launch-token-for-tests';
const app = mkdtempSync(join(tmpdir(), 'toil-ui-app-'));
mkdirSync(join(app, 'assets'));
writeFileSync(join(app, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(app, 'assets', 'app.js'), 'console.log(1);');
writeFileSync(join(app, 'assets', '..app.js'), 'console.log(2);');
writeFileSync(join(tmpdir(), 'toil-ui-secret.txt'), 'outside the app folder');

const settings = (over: Partial<Settings> = {}): Settings => ({ host: '127.0.0.1', port: 0, basePath: '/', dataDir: join(app, 'data'), sample: true, ...over });

interface Seen {
  ctx: RequestContext;
  command: string;
  input: Record<string, unknown>;
  access: Access;
}

/** A Store that records what reached it, answering from the fixture. */
function watched(): { store: Store; seen: Seen[] } {
  const inner = fixtureStore();
  const seen: Seen[] = [];
  return {
    seen,
    store: { ...inner, execute: (ctx, command, input, access) => (seen.push({ ctx, command, input, access }), inner.execute(ctx, command, input, access)) },
  };
}

const running: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (running.length) await running.pop()!();
});

async function start(over: Partial<UiServerOptions> = {}) {
  const ui = createUiServer({ settings: settings(), store: fixtureStore(), agent: fixtureAgent(), appDir: app, version: '0.0.0-test', toil: { version: '0.1.0-alpha.2', contractVersion: 1 }, token: TOKEN, ...over });
  const address = await ui.listen();
  running.push(() => ui.close());
  const host = new URL(address.origin).host;
  return { ui, ...address, host };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(origin: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port, path: `${url.pathname}${url.search}`, method: options.method ?? 'GET', headers: { host: url.host, ...options.headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/** Signs in with the launch token, as the printed URL does, and returns the cookie and the session. */
async function signIn(origin: string, base = '/') {
  const res = await send(origin, `${base}?token=${TOKEN}`);
  const cookie = String((res.headers['set-cookie'] as string[])[0]).split(';')[0]!;
  const session = JSON.parse((await send(origin, `${base}api/session`, { headers: { cookie } })).body) as { csrf: string } & Record<string, unknown>;
  return { cookie, session, res };
}

async function post(origin: string, path: string, body: unknown, auth: { cookie: string; csrf: string }, headers: Record<string, string> = {}) {
  return send(origin, path, { method: 'POST', body: JSON.stringify(body), headers: { cookie: auth.cookie, origin, 'content-type': 'application/json', [CSRF_HEADER]: auth.csrf, ...headers } });
}

const noCors = (r: Reply) => Object.keys(r.headers).filter((h) => h.startsWith('access-control-'));

describe('the lock on the door', () => {
  it('refuses any Host but the one it printed, before reading anything else', async () => {
    const { origin, host } = await start();
    for (const other of ['rebind.imagile.dev', `localhost:${new URL(origin).port}`, `127.0.0.1:1`, `127.0.0.1.rebind.imagile.dev:${new URL(origin).port}`]) {
      const res = await send(origin, `/?token=${TOKEN}`, { headers: { host: other } });
      expect(res.status, other).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body).toContain(`http://${host}`);
    }
  });

  it('opens nothing without the launch token, and refuses a wrong one', async () => {
    const { origin } = await start();
    expect((await send(origin, '/')).status).toBe(401);
    expect((await send(origin, '/assets/app.js')).status).toBe(401);
    const api = await send(origin, '/api/session');
    expect(api.status).toBe(401);
    expect(JSON.parse(api.body).error.message).toContain('URL it printed');
    const wrong = await send(origin, '/?token=not-it');
    expect(wrong.status).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('trades the token for a session cookie that lives in memory, and drops the token from the URL', async () => {
    const { origin, launchUrl } = await start();
    expect(launchUrl).toBe(`${origin}/?token=${TOKEN}`);
    const { res, cookie } = await signIn(origin);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
    const set = String((res.headers['set-cookie'] as string[])[0]);
    expect(set).toMatch(new RegExp(`^toil-ui-${new URL(origin).port}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Strict$`));
    expect(set).not.toMatch(/Expires|Max-Age/i);
    expect(cookie).not.toContain(TOKEN);
    const page = await send(origin, '/', { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('<div id="root">');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(noCors(page)).toEqual([]);
  });

  it('never sends a CORS header, even when asked', async () => {
    const { origin } = await start();
    const { cookie } = await signIn(origin);
    const preflight = await send(origin, '/api/execute', { method: 'OPTIONS', headers: { cookie, origin: 'https://rebind.imagile.dev', 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(405);
    expect(noCors(preflight)).toEqual([]);
    const get = await send(origin, '/api/session', { headers: { cookie, origin: 'https://rebind.imagile.dev' } });
    expect(noCors(get)).toEqual([]);
  });

  it('keeps at most MAX_SESSIONS sessions, dropping the oldest', async () => {
    const { origin } = await start();
    const first = await signIn(origin);
    for (let i = 0; i < MAX_SESSIONS; i++) await signIn(origin);
    expect((await send(origin, '/', { headers: { cookie: first.cookie } })).status).toBe(401);
  });
});

describe('every POST', () => {
  it("needs the page's own Origin, a JSON body and the session's CSRF token", async () => {
    const { origin } = await start();
    const { cookie, session } = await signIn(origin);
    const auth = { cookie, csrf: session.csrf };
    const call = { command: 'dossiers list', input: {} };
    expect((await post(origin, '/api/execute', call, auth, { origin: 'https://rebind.imagile.dev' })).status).toBe(403);
    const noOrigin = await send(origin, '/api/execute', { method: 'POST', body: JSON.stringify(call), headers: { cookie, 'content-type': 'application/json', [CSRF_HEADER]: session.csrf } });
    expect(noOrigin.status).toBe(403);
    expect((await post(origin, '/api/execute', call, auth, { 'content-type': 'text/plain' })).status).toBe(415);
    const noCsrf = await post(origin, '/api/execute', call, { cookie, csrf: 'wrong' });
    expect(noCsrf.status).toBe(403);
    expect(JSON.parse(noCsrf.body).error.message).toContain('CSRF');
    const ok = await post(origin, '/api/execute', call, auth);
    expect(ok.status).toBe(200);
    expect((JSON.parse(ok.body) as Envelope).ok).toBe(true);
  });

  it("takes a session's CSRF token only for that session", async () => {
    const { origin } = await start();
    const a = await signIn(origin);
    const b = await signIn(origin);
    expect(a.session.csrf).not.toBe(b.session.csrf);
    expect((await post(origin, '/api/execute', { command: 'dossiers list' }, { cookie: a.cookie, csrf: b.session.csrf })).status).toBe(403);
  });

  it('refuses a body over the limit, and one that is not an object', async () => {
    const { origin } = await start();
    const { cookie, session } = await signIn(origin);
    const big = await post(origin, '/api/execute', { command: 'dossiers list', input: { pad: 'x'.repeat(MAX_BODY) } }, { cookie, csrf: session.csrf });
    expect(big.status).toBe(413);
    const list = await send(origin, '/api/execute', { method: 'POST', body: '[1]', headers: { cookie, origin, 'content-type': 'application/json', [CSRF_HEADER]: session.csrf } });
    expect(list.status).toBe(400);
  });
});

describe('the API', () => {
  it('reports the session: versions, viewer, Store, Agent and the clock', async () => {
    const viewer = { id: 'local', name: 'you', via: 'launch-token' as const };
    const { origin } = await start({ viewer });
    const { session } = await signIn(origin);
    expect(session).toEqual({
      version: '0.0.0-test',
      toil: { version: '0.1.0-alpha.2', contractVersion: 1 },
      viewer: { id: 'local', name: 'you' },
      store: 'fixture',
      agent: 'scripted',
      sample: true,
      now: '2026-10-13T08:00:00.000Z',
      csrf: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('runs a read from the allowlist read-only, with the viewer in its context', async () => {
    const { store, seen } = watched();
    const viewer = { id: 'local', name: 'you', via: 'launch-token' as const };
    const { origin } = await start({ store, viewer });
    const { cookie, session } = await signIn(origin);
    const res = await post(origin, '/api/execute', { command: 'dossiers show', input: { dossier: 'card-payments' } }, { cookie, csrf: session.csrf });
    const env = JSON.parse(res.body) as Envelope;
    expect(env.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ command: 'dossiers show', input: { dossier: 'card-payments' }, access: 'read' });
    expect(seen[0]!.ctx.viewer).toEqual(viewer);
    expect(seen[0]!.ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['connections list', 'jira create-issue', 'dossiers field', 'util md'])('refuses %s, which the views never read, before the Store sees it', async (command) => {
    const { store, seen } = watched();
    const { origin } = await start({ store });
    const { cookie, session } = await signIn(origin);
    const res = await post(origin, '/api/execute', { command, input: {} }, { cookie, csrf: session.csrf });
    expect(res.status).toBe(403);
    const env = JSON.parse(res.body) as Envelope;
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.message).toContain(`toil ${command}`);
      expect(env.error.fix).toContain('CLI');
    }
    expect(seen).toEqual([]);
  });

  it('runs no config change in this release: the config allowlist is empty', async () => {
    const { store, seen } = watched();
    const { origin } = await start({ store });
    const { cookie, session } = await signIn(origin);
    const res = await post(origin, '/api/config', { command: 'dossiers field', input: {} }, { cookie, csrf: session.csrf });
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('runs a config command on the allowlist with config access, and only those', async () => {
    const { store, seen } = watched();
    const { origin } = await start({ store, configCommands: new Set(['dossiers field']) });
    const { cookie, session } = await signIn(origin);
    await post(origin, '/api/config', { command: 'dossiers field', input: { dossier: 'card-payments' } }, { cookie, csrf: session.csrf });
    expect(seen.map((s) => [s.command, s.access])).toEqual([['dossiers field', 'config']]);
    // A read command isn't a config command, and a config command isn't a read.
    expect((await post(origin, '/api/config', { command: 'dossiers list' }, { cookie, csrf: session.csrf })).status).toBe(403);
    expect((await post(origin, '/api/execute', { command: 'dossiers field' }, { cookie, csrf: session.csrf })).status).toBe(403);
  });

  it('asks the Agent with the viewer, and shows its failure as a message', async () => {
    const asked: string[] = [];
    const agent: Agent = { ...fixtureAgent(), ask: async (ctx, dossier, prompt) => (asked.push(`${ctx.viewer.id} ${dossier} ${prompt}`), fixtureAgent().ask(ctx, dossier, prompt)) };
    const { origin } = await start({ agent });
    const { cookie, session } = await signIn(origin);
    const starters = JSON.parse((await send(origin, '/api/agent/starters?dossier=card-payments', { headers: { cookie } })).body) as Array<{ id: string }>;
    expect(starters.map((s) => s.id)).toEqual(['risk', 'deployed']);
    const answer = JSON.parse((await post(origin, '/api/agent/ask', { dossier: 'card-payments', prompt: 'risk' }, { cookie, csrf: session.csrf })).body);
    expect(answer.citations).toContain('corp-jira:PAY-101');
    expect(asked).toEqual(['local card-payments risk']);

    const none = await start({ agent: noAgent() });
    const other = await signIn(none.origin);
    expect(JSON.parse((await send(none.origin, '/api/agent/starters?dossier=card-payments', { headers: { cookie: other.cookie } })).body)).toEqual([]);
    const failed = await post(none.origin, '/api/agent/ask', { dossier: 'card-payments', prompt: 'risk' }, { cookie: other.cookie, csrf: other.session.csrf });
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body).error.message).toContain('No agent is set up');
  });

  it('answers an unknown route with where the API is', async () => {
    const { origin } = await start();
    const { cookie } = await signIn(origin);
    const res = await send(origin, '/api/nothing', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error.fix).toContain('session, execute, config');
  });
});

describe('the static files', () => {
  it('serves the app and nothing outside its folder', async () => {
    const { origin } = await start();
    const { cookie } = await signIn(origin);
    const js = await send(origin, '/assets/app.js', { headers: { cookie } });
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    const dotted = await send(origin, '/assets/..app.js', { headers: { cookie } });
    expect(dotted.status, 'a name that merely starts with two dots').toBe(200);
    const paths = ['/../toil-ui-secret.txt', '/%2e%2e/toil-ui-secret.txt', '/assets/..%2f..%2ftoil-ui-secret.txt', '/..%5ctoil-ui-secret.txt', '/%2e%2e%5ctoil-ui-secret.txt', '/index.html::$DATA', '/assets', '/missing.js'];
    for (const path of paths) {
      const res = await send(origin, path, { headers: { cookie } });
      expect(res.status, path).toBe(404);
      expect(res.body).not.toContain('outside the app folder');
      expect(res.body).not.toContain('<div id="root">');
    }
  });

  it('keeps a signed-in browser signed in when it opens a launch URL again', async () => {
    const { origin } = await start();
    const { cookie } = await signIn(origin);
    for (const token of [TOKEN, 'an-old-launch']) {
      const res = await send(origin, `/?token=${token}`, { headers: { cookie } });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await send(origin, '/', { headers: { cookie } })).status).toBe(200);
  });

  it('serves under its base path only', async () => {
    const { origin, launchUrl } = await start({ settings: settings({ basePath: '/toil/' }) });
    expect(launchUrl).toBe(`${origin}/toil/?token=${TOKEN}`);
    const { cookie, res } = await signIn(origin, '/toil/');
    expect(res.headers.location).toBe('/toil/');
    expect(String((res.headers['set-cookie'] as string[])[0])).toContain('Path=/toil/;');
    expect((await send(origin, '/toil', { headers: { cookie } })).status).toBe(308);
    expect((await send(origin, '/index.html', { headers: { cookie } })).status).toBe(404);
    expect((await send(origin, '/toil/', { headers: { cookie } })).status).toBe(200);
  });
});

describe('the Stores', () => {
  it('lets the views read exactly the commands the fixture answers', () => {
    expect([...READ_COMMANDS].sort()).toEqual([...new Set(CANNED.map((c) => c.command))].sort());
  });

  it("toil's own execute() gets every read read-only, and every call named toil-ui", async () => {
    const calls: unknown[] = [];
    const execute: Execute = async (command, input, options) => (calls.push([command, input, options]), { ok: true, data: null, error: null, meta: { command, durationMs: 0, version: 'x', contractVersion: 1 } } as Envelope);
    const store = toilStore(execute);
    const ctx: RequestContext = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal };
    await store.execute(ctx, 'dossiers list', {}, 'read');
    await store.execute(ctx, 'dossiers field', { dossier: 'd' }, 'config');
    expect(calls).toEqual([
      ['dossiers list', {}, { readOnly: true, caller: CALLER, signal: ctx.signal }],
      ['dossiers field', { dossier: 'd' }, { readOnly: false, caller: CALLER, signal: ctx.signal }],
    ]);
    expect(store.sample).toBe(false);
  });

  it('the fixture Store refuses anything but a read', async () => {
    const ctx: RequestContext = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal };
    const env = await fixtureStore().execute(ctx, 'dossiers list', {}, 'config');
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('WRITE_DISABLED');
  });
});

describe('the settings', () => {
  const home = join(app, 'home');

  it('defaults to loopback, a free port, the root path and ~/.toil-ui', () => {
    expect(parseSettings([], {}, home)).toEqual({ settings: { host: '127.0.0.1', port: 0, basePath: '/', dataDir: join(home, '.toil-ui'), sample: false }, help: false, version: false });
  });

  it('takes a flag over its env var, and the env var over the default', () => {
    const env = { TOIL_UI_PORT: '4400', TOIL_UI_BASE_PATH: 'toil', TOIL_UI_HOST: '::1' };
    expect(parseSettings([], env, home).settings).toMatchObject({ host: '::1', port: 4400, basePath: '/toil/' });
    expect(parseSettings(['--port', '4500', '--base-path=/a/b/', '--sample'], env, home).settings).toMatchObject({ port: 4500, basePath: '/a/b/', sample: true });
  });

  it.each(['0.0.0.0', '192.168.0.10', 'localhost', '::'])('refuses to bind %s, with a fix', (host) => {
    expect(() => parseSettings(['--host', host], {}, home)).toThrow(SettingsError);
    try {
      parseSettings([], { TOIL_UI_HOST: host }, home);
    } catch (e) {
      expect((e as SettingsError).fix).toContain('127.0.0.1');
    }
  });

  it.each([['--port', '70000'], ['--port', 'eighty'], ['--base-path', '/a/../b'], ['--base-path', '/a b'], ['--nope'], ['--port']])('refuses %s %s', (...argv) => {
    expect(() => parseSettings(argv, {}, home)).toThrow(SettingsError);
  });
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
  rmSync(join(tmpdir(), 'toil-ui-secret.txt'), { force: true });
});
