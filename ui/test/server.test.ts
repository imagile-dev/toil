// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fixtureAgent, noAgent, type Agent } from '../server/agent.ts';
import type { RequestContext } from '../server/context.ts';
import { CSRF_HEADER, MAX_BODY, SESSION_HEADER, MAX_SESSIONS, createUiServer, type UiServerOptions } from '../server/server.ts';
import { parseSettings, SettingsError, type Settings } from '../server/settings.ts';
import { CALLER, READ_COMMANDS, fixtureStore, toilStore, type Access, type Store } from '../server/store.ts';
import { CANNED } from '../src/fixtures/execute.ts';
import type { Envelope, Execute } from '../src/toil.ts';

/**
 * The local server, over real loopback sockets: the Host check, the launch
 * token and the session id it trades for (a header, never a cookie), the POST
 * checks (Origin, JSON, CSRF), the read allowlist and the config allowlist,
 * the viewer on every call, and the static files. node:http's own client sends whatever Host and Origin a test names,
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

/** Trades the launch token for a session id, as the page does, and returns it with the session. */
async function signIn(origin: string, base = '/', token = TOKEN) {
  const res = await send(origin, `${base}api/session`, { method: 'POST', body: JSON.stringify({ token }), headers: { origin, 'content-type': 'application/json' } });
  const session = JSON.parse(res.body) as { session: string; csrf: string } & Record<string, unknown>;
  return { sid: session.session, session, res };
}

async function post(origin: string, path: string, body: unknown, auth: { sid: string; csrf: string }, headers: Record<string, string> = {}) {
  return send(origin, path, { method: 'POST', body: JSON.stringify(body), headers: { [SESSION_HEADER]: auth.sid, origin, 'content-type': 'application/json', [CSRF_HEADER]: auth.csrf, ...headers } });
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

  it('serves the app without a session, since its files hold no data, and never sets a cookie', async () => {
    const { origin, launchUrl } = await start();
    expect(launchUrl).toBe(`${origin}/?token=${TOKEN}`);
    for (const path of ['/', `/?token=${TOKEN}`, '/?token=not-it', '/assets/app.js']) {
      const res = await send(origin, path);
      expect(res.status, path).toBe(200);
      expect(res.headers['set-cookie'], path).toBeUndefined();
    }
    const page = await send(origin, '/');
    expect(page.body).toContain('<div id="root">');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(noCors(page)).toEqual([]);
  });

  it('trades the launch token for a session id in the response body, never a cookie, and refuses a wrong token', async () => {
    const { origin } = await start();
    const { res, sid, session } = await signIn(origin);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sid).not.toBe(TOKEN);
    expect(session.csrf).not.toBe(sid);
    const wrong = await signIn(origin, '/', 'not-it');
    expect(wrong.res.status).toBe(401);
    expect(wrong.res.headers['set-cookie']).toBeUndefined();
    const foreign = await send(origin, '/api/session', { method: 'POST', body: JSON.stringify({ token: TOKEN }), headers: { origin: 'http://127.0.0.1:1', 'content-type': 'application/json' } });
    expect(foreign.status).toBe(403);
  });

  it('answers the API only with the session header: a cookie alone is refused', async () => {
    const { origin } = await start();
    const { sid, session } = await signIn(origin);
    const call = JSON.stringify({ command: 'dossiers list', input: {} });
    const asCookie = { cookie: `toil-ui-${new URL(origin).port}=${sid}; toil-ui=${sid}; session=${sid}` };
    for (const [path, method] of [['/api/session', 'GET'], ['/api/execute', 'POST'], ['/api/agent/starters?dossier=card-payments', 'GET']] as const) {
      const res = await send(origin, path, { method, body: method === 'POST' ? call : undefined, headers: { ...asCookie, origin, 'content-type': 'application/json', [CSRF_HEADER]: session.csrf } });
      expect(res.status, `${method} ${path} with only a cookie`).toBe(401);
      expect(JSON.parse(res.body).error.message).toContain(SESSION_HEADER);
    }
    expect((await send(origin, '/api/session')).status).toBe(401);
    expect((await send(origin, '/api/session', { headers: { [SESSION_HEADER]: 'not-a-session' } })).status).toBe(401);
    const withHeader = await post(origin, '/api/execute', { command: 'dossiers list', input: {} }, { sid, csrf: session.csrf });
    expect(withHeader.status).toBe(200);
    expect((JSON.parse(withHeader.body) as Envelope).ok).toBe(true);
    expect((await send(origin, '/api/session', { headers: { [SESSION_HEADER]: sid } })).status).toBe(200);
  });

  it('never sends a CORS header, even when asked', async () => {
    const { origin } = await start();
    const { sid } = await signIn(origin);
    const preflight = await send(origin, '/api/execute', { method: 'OPTIONS', headers: { [SESSION_HEADER]: sid, origin: 'https://rebind.imagile.dev', 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(405);
    expect(noCors(preflight)).toEqual([]);
    const get = await send(origin, '/api/session', { headers: { [SESSION_HEADER]: sid, origin: 'https://rebind.imagile.dev' } });
    expect(noCors(get)).toEqual([]);
  });

  it('keeps at most MAX_SESSIONS sessions, dropping the oldest', async () => {
    const { origin } = await start();
    const first = await signIn(origin);
    for (let i = 0; i < MAX_SESSIONS; i++) await signIn(origin);
    expect((await send(origin, '/api/session', { headers: { [SESSION_HEADER]: first.sid } })).status).toBe(401);
  });
});

describe('every POST', () => {
  it("needs the page's own Origin, a JSON body and the session's CSRF token", async () => {
    const { origin } = await start();
    const { sid, session } = await signIn(origin);
    const auth = { sid, csrf: session.csrf };
    const call = { command: 'dossiers list', input: {} };
    expect((await post(origin, '/api/execute', call, auth, { origin: 'https://rebind.imagile.dev' })).status).toBe(403);
    const noOrigin = await send(origin, '/api/execute', { method: 'POST', body: JSON.stringify(call), headers: { [SESSION_HEADER]: sid, 'content-type': 'application/json', [CSRF_HEADER]: session.csrf } });
    expect(noOrigin.status).toBe(403);
    expect((await post(origin, '/api/execute', call, auth, { 'content-type': 'text/plain' })).status).toBe(415);
    const noCsrf = await post(origin, '/api/execute', call, { sid, csrf: 'wrong' });
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
    expect((await post(origin, '/api/execute', { command: 'dossiers list' }, { sid: a.sid, csrf: b.session.csrf })).status).toBe(403);
  });

  it('refuses a body over the limit, and one that is not an object', async () => {
    const { origin } = await start();
    const { sid, session } = await signIn(origin);
    const big = await post(origin, '/api/execute', { command: 'dossiers list', input: { pad: 'x'.repeat(MAX_BODY) } }, { sid, csrf: session.csrf });
    expect(big.status).toBe(413);
    const list = await send(origin, '/api/execute', { method: 'POST', body: '[1]', headers: { [SESSION_HEADER]: sid, origin, 'content-type': 'application/json', [CSRF_HEADER]: session.csrf } });
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
      session: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('runs a read from the allowlist read-only, with the viewer in its context', async () => {
    const { store, seen } = watched();
    const viewer = { id: 'local', name: 'you', via: 'launch-token' as const };
    const { origin } = await start({ store, viewer });
    const { sid, session } = await signIn(origin);
    const res = await post(origin, '/api/execute', { command: 'dossiers show', input: { dossier: 'card-payments' } }, { sid, csrf: session.csrf });
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
    const { sid, session } = await signIn(origin);
    const res = await post(origin, '/api/execute', { command, input: {} }, { sid, csrf: session.csrf });
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
    const { sid, session } = await signIn(origin);
    const res = await post(origin, '/api/config', { command: 'dossiers field', input: {} }, { sid, csrf: session.csrf });
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('runs a config command on the allowlist with config access, and only those', async () => {
    const { store, seen } = watched();
    const { origin } = await start({ store, configCommands: new Set(['dossiers field']) });
    const { sid, session } = await signIn(origin);
    await post(origin, '/api/config', { command: 'dossiers field', input: { dossier: 'card-payments' } }, { sid, csrf: session.csrf });
    expect(seen.map((s) => [s.command, s.access])).toEqual([['dossiers field', 'config']]);
    // A read command isn't a config command, and a config command isn't a read.
    expect((await post(origin, '/api/config', { command: 'dossiers list' }, { sid, csrf: session.csrf })).status).toBe(403);
    expect((await post(origin, '/api/execute', { command: 'dossiers field' }, { sid, csrf: session.csrf })).status).toBe(403);
  });

  it('asks the Agent with the viewer, and shows its failure as a message', async () => {
    const asked: string[] = [];
    const agent: Agent = { ...fixtureAgent(), ask: async (ctx, dossier, prompt) => (asked.push(`${ctx.viewer.id} ${dossier} ${prompt}`), fixtureAgent().ask(ctx, dossier, prompt)) };
    const { origin } = await start({ agent });
    const { sid, session } = await signIn(origin);
    const starters = JSON.parse((await send(origin, '/api/agent/starters?dossier=card-payments', { headers: { [SESSION_HEADER]: sid } })).body) as Array<{ id: string }>;
    expect(starters.map((s) => s.id)).toEqual(['risk', 'attention', 'deployed']);
    const answer = JSON.parse((await post(origin, '/api/agent/ask', { dossier: 'card-payments', prompt: 'risk' }, { sid, csrf: session.csrf })).body);
    expect(answer.citations).toContain('corp-jira:PAY-101');
    expect(answer.proposals.map((p: { command: string }) => p.command)).toEqual(['jira update-issue']);
    expect(asked).toEqual(['local card-payments risk']);

    const none = await start({ agent: noAgent() });
    const other = await signIn(none.origin);
    expect(JSON.parse((await send(none.origin, '/api/agent/starters?dossier=card-payments', { headers: { [SESSION_HEADER]: other.sid } })).body)).toEqual([]);
    const failed = await post(none.origin, '/api/agent/ask', { dossier: 'card-payments', prompt: 'risk' }, { sid: other.sid, csrf: other.session.csrf });
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body).error.message).toContain('No agent is set up');
  });

  it('answers an unknown route with where the API is', async () => {
    const { origin } = await start();
    const { sid } = await signIn(origin);
    const res = await send(origin, '/api/nothing', { headers: { [SESSION_HEADER]: sid } });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error.fix).toContain('session, execute, config');
  });
});

describe('the static files', () => {
  it('serves the app and nothing outside its folder', async () => {
    const { origin } = await start();
    const { sid } = await signIn(origin);
    const js = await send(origin, '/assets/app.js', { headers: { [SESSION_HEADER]: sid } });
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    const dotted = await send(origin, '/assets/..app.js', { headers: { [SESSION_HEADER]: sid } });
    expect(dotted.status, 'a name that merely starts with two dots').toBe(200);
    const paths = ['/../toil-ui-secret.txt', '/%2e%2e/toil-ui-secret.txt', '/assets/..%2f..%2ftoil-ui-secret.txt', '/..%5ctoil-ui-secret.txt', '/%2e%2e%5ctoil-ui-secret.txt', '/index.html::$DATA', '/assets', '/missing.js'];
    for (const path of paths) {
      const res = await send(origin, path, { headers: { [SESSION_HEADER]: sid } });
      expect(res.status, path).toBe(404);
      expect(res.body).not.toContain('outside the app folder');
      expect(res.body).not.toContain('<div id="root">');
    }
  });

  it('serves under its base path only', async () => {
    const { origin, launchUrl } = await start({ settings: settings({ basePath: '/toil/' }) });
    expect(launchUrl).toBe(`${origin}/toil/?token=${TOKEN}`);
    const { sid, res } = await signIn(origin, '/toil/');
    expect(res.status).toBe(200);
    expect((await send(origin, '/toil')).status).toBe(308);
    expect((await send(origin, '/index.html')).status).toBe(404);
    expect((await send(origin, '/api/session', { headers: { [SESSION_HEADER]: sid } })).status).toBe(404);
    expect((await send(origin, '/toil/')).status).toBe(200);
    expect((await send(origin, '/toil/api/session', { headers: { [SESSION_HEADER]: sid } })).status).toBe(200);
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
