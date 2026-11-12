// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureAgent } from '../server/agent.ts';
import { BoardRefusal, BoardService, sampleBoard, type BoardBackend } from '../server/board.ts';
import { createUiServer } from '../server/server.ts';
import { fixtureStore } from '../server/store.ts';
import type { Envelope, Execute, ExecuteOptions } from '../src/toil.ts';
import { letIn } from './let-in.ts';

/**
 * The Board's drop on the server: `api/board/move` takes a Toil project, an item's id and a column, and nothing else, and
 * runs toil's own transition command as that person behind the connection's `writes`. The service is held to a scripted toil
 * (what each command would answer), so what it asks of toil, and in which mode, is read off the calls.
 */

interface Call {
  command: string;
  input: Record<string, unknown>;
  options: ExecuteOptions;
}

const ok = (command: string, data: unknown, meta: Record<string, unknown> = {}): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 'test', contractVersion: 1, ...meta } }) as Envelope;
const fail = (command: string, code: string, message: string, fix: string): Envelope => ({ ok: false, data: null, error: { code, message, fix }, meta: { command, durationMs: 0, version: 'test', contractVersion: 1 } }) as Envelope;
const viaConnection = (value: string) => ({ context: { connection: { value, source: 'toil project' }, inputs: {}, shared: [] } });

/** A scripted toil: one Toil project, a Jira and an Azure DevOps connection, and what a read or a transition answers. */
function toil(over: Partial<Record<string, Envelope>> = {}, writes = true) {
  const calls: Call[] = [];
  const answers: Record<string, Envelope> = {
    'projects list': ok('projects list', { toilProjects: [{ name: 'card-payments' }] }),
    'connections list': ok('connections list', {
      configFile: 'x',
      connections: [
        { name: 'corp-jira', area: 'jira', writes },
        { name: 'corp-ado', area: 'ado', writes },
        { name: 'corp-gh', area: 'github', writes },
      ],
    }),
    'jira issue get': ok('jira issue get', { key: 'PAY-102' }, viaConnection('corp-jira')),
    'ado work-item get': ok('ado work-item get', { id: 2304 }, viaConnection('corp-ado')),
    'jira issue transition': ok('jira issue transition', { transitioned: 'PAY-102', transition: 'Start progress' }, { transition: { intent: 'start', transition: 'Start progress', toStatus: 'In Progress', resolvedBy: 'category' } }),
    'ado work-item transition': ok('ado work-item transition', { id: 2304 }),
    ...over,
  };
  const execute: Execute = async (command, input = {}, options = {}) => {
    calls.push({ command, input, options });
    return answers[command] ?? fail(command, 'INVALID_INPUT', `no answer for ${command}`, 'script it');
  };
  return { execute, calls, writesSent: () => calls.filter((c) => c.options.readOnly === false) };
}

const signal = new AbortController().signal;

describe('the Board service', () => {
  it('moves a Jira issue with one toil command: the column as toil\'s intent, allowWrite, as the UI, after reading the issue through the same Toil project', async () => {
    const t = toil();
    const out = await new BoardService({ execute: t.execute }).move('card-payments', 'corp-jira:PAY-102', 'IN_PROGRESS', signal);
    expect(out).toEqual({ status: 'applied', transition: 'Start progress', toStatus: 'In Progress' });
    // The reads run read-only, the transition is the only call that doesn't, and every call names the UI.
    expect(t.calls.map((c) => c.command)).toEqual(['projects list', 'connections list', 'jira issue get', 'jira issue transition']);
    expect(t.calls.every((c) => c.options.caller === 'toil-ui')).toBe(true);
    expect(t.calls.slice(0, 3).every((c) => c.options.readOnly === true)).toBe(true);
    expect(t.writesSent()).toEqual([{ command: 'jira issue transition', input: { toilProject: 'card-payments', key: 'PAY-102', to: 'start', allowWrite: true }, options: expect.objectContaining({ readOnly: false, caller: 'toil-ui' }) }]);
    // The connection is never sent, so a Toil project's own choice of connection and its adoption rules still decide.
    expect(t.calls.some((c) => 'connection' in c.input)).toBe(false);
  });

  it.each([
    ['TODO', 'reopen'],
    ['IN_PROGRESS', 'start'],
    ['DONE', 'done'],
  ] as const)('asks toil for the intent of the %s column: %s', async (column, intent) => {
    const t = toil();
    await new BoardService({ execute: t.execute }).move('card-payments', 'corp-jira:PAY-102', column, signal);
    expect(t.writesSent()[0]!.input.to).toBe(intent);
  });

  it('moves an Azure DevOps work item by its number', async () => {
    const t = toil();
    const out = await new BoardService({ execute: t.execute }).move('card-payments', 'corp-ado:2304', 'DONE', signal);
    expect(out.status).toBe('applied');
    expect(t.writesSent()[0]).toMatchObject({ command: 'ado work-item transition', input: { toilProject: 'card-payments', id: 2304, to: 'done', allowWrite: true } });
  });

  it('leaves it a proposal, writing nothing, when the connection has writes off', async () => {
    const t = toil({}, false);
    const out = await new BoardService({ execute: t.execute }).move('card-payments', 'corp-jira:PAY-102', 'DONE', signal);
    expect(out).toMatchObject({ status: 'proposal', why: 'writes-off' });
    expect((out as { reason: string }).reason).toMatch(/Changes to corp-jira are switched off/);
    expect(t.writesSent()).toEqual([]);
  });

  it('leaves a GitHub item to its command, and a Toil project that would use another connection to the person', async () => {
    const gh = toil();
    expect(await new BoardService({ execute: gh.execute }).move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'unsupported' });
    expect(gh.writesSent()).toEqual([]);
    const other = toil({ 'jira issue get': ok('jira issue get', {}, viaConnection('other-jira')) });
    const out = await new BoardService({ execute: other.execute }).move('card-payments', 'corp-jira:PAY-102', 'DONE', signal);
    expect(out).toMatchObject({ status: 'proposal', why: 'unsupported' });
    expect((out as { reason: string }).reason).toMatch(/other-jira rather than corp-jira/);
    expect(other.writesSent()).toEqual([]);
  });

  it("shows toil's refusal to choose, with the moves it offers, as a proposal: nothing is guessed", async () => {
    const t = toil({ 'jira issue transition': fail('jira issue transition', 'INVALID_INPUT', '"start" is ambiguous for PAY-102 (Story, now To Do): more than one move leads into its status category: In Progress, In Review.', 'PAY-102 offers: In Progress; In Review. Pass one of them with --to <status>.') });
    const out = await new BoardService({ execute: t.execute }).move('card-payments', 'corp-jira:PAY-102', 'IN_PROGRESS', signal);
    expect(out).toEqual({ status: 'proposal', why: 'choices', reason: expect.stringContaining('ambiguous for PAY-102'), detail: expect.stringContaining('In Progress; In Review') });
  });

  it("refuses with toil's own message and fix when toil refuses the write", async () => {
    const t = toil({ 'jira issue transition': fail('jira issue transition', 'WRITE_DISABLED', 'The Toil project chose corp-jira, which Toil UI has not adopted.', 'Copy it with toil projects import, then try again.') });
    await expect(new BoardService({ execute: t.execute }).move('card-payments', 'corp-jira:PAY-102', 'DONE', signal)).rejects.toMatchObject({ status: 403, message: 'The Toil project chose corp-jira, which Toil UI has not adopted.', fix: 'Copy it with toil projects import, then try again.' });
  });

  it('refuses an unknown Toil project, connection, item or id before anything is written', async () => {
    const t = toil({ 'jira issue get': fail('jira issue get', 'NOT_FOUND', 'Issue does not exist.', 'Check the key.') });
    const board = new BoardService({ execute: t.execute });
    await expect(board.move('no-such', 'corp-jira:PAY-102', 'DONE', signal)).rejects.toMatchObject({ status: 404 });
    await expect(board.move('card-payments', 'ghost-jira:PAY-102', 'DONE', signal)).rejects.toMatchObject({ status: 404 });
    await expect(board.move('card-payments', 'corp-jira:PAY-999', 'DONE', signal)).rejects.toMatchObject({ status: 404, message: expect.stringContaining('PAY-999 couldn') });
    await expect(board.move('card-payments', 'not an id', 'DONE', signal)).rejects.toBeInstanceOf(BoardRefusal);
    await expect(board.move('card-payments', 'corp-ado:not-a-number', 'DONE', signal)).rejects.toBeInstanceOf(BoardRefusal);
    expect(t.writesSent()).toEqual([]);
  });

  it('takes one move of a card at a time', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const t = toil();
    const slow: Execute = async (command, input, options) => {
      if (command === 'jira issue transition') await held;
      return t.execute(command, input, options);
    };
    const board = new BoardService({ execute: slow });
    const first = board.move('card-payments', 'corp-jira:PAY-102', 'DONE', signal);
    await new Promise((r) => setTimeout(r, 20));
    await expect(board.move('card-payments', 'corp-jira:PAY-102', 'TODO', signal)).rejects.toMatchObject({ status: 409 });
    release();
    expect((await first).status).toBe('applied');
  });
});

describe('api/board/move', () => {
  let close: (() => Promise<void>) | undefined;
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'toil-ui-board-routes-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  });
  afterEach(async () => {
    await close?.();
    close = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function serve(board?: BoardBackend) {
    const ui = createUiServer({
      settings: { host: '127.0.0.1', port: 0, basePath: '/', dataDir: dir, retentionDays: 30, sample: true },
      store: fixtureStore(),
      agent: fixtureAgent(),
      appDir: dir,
      version: '0.0.0-test',
      toil: { version: '0.0.0-test', contractVersion: 1 },
      ...(board ? { board } : {}),
    });
    const { origin } = await ui.listen();
    close = () => ui.close();
    const cookie = await letIn(origin);
    const post = async (body: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(new URL('/api/board/move', origin), { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as { error?: { message: string; fix: string }; status?: string; why?: string } };
    };
    return { post, origin, cookie };
  }

  /** A backend that records what it was asked, so a refused body can be shown never to have reached it. */
  function recording(answer: () => ReturnType<BoardBackend['move']> = async () => ({ status: 'applied', transition: null, toStatus: null })) {
    const asked: unknown[][] = [];
    const backend: BoardBackend = { move: (...args) => (asked.push(args.slice(0, 3)), answer()) };
    return { backend, asked };
  }

  it('passes the Toil project, the item and the column to the backend, and only those', async () => {
    const { backend, asked } = recording();
    const { post } = await serve(backend);
    const r = await post({ toilProject: 'card-payments', item: 'corp-jira:PAY-102', to: 'DONE' });
    expect(r).toEqual({ status: 200, body: { status: 'applied', transition: null, toStatus: null } });
    expect(asked).toEqual([['card-payments', 'corp-jira:PAY-102', 'DONE']]);
  });

  it('takes no command, connection, path, transition or write flag from the body', async () => {
    const { backend, asked } = recording();
    const { post } = await serve(backend);
    const base = { toilProject: 'card-payments', item: 'corp-jira:PAY-102', to: 'DONE' };
    for (const extra of [{ command: 'jira issue delete' }, { connection: 'corp-jira' }, { input: { allowWrite: true } }, { allowWrite: true }, { transition: '31' }, { path: 'C:/secrets.json' }]) {
      const r = await post({ ...base, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error?.message).toMatch(/A move takes toilProject, item and to, not /);
    }
    expect(asked).toEqual([]);
  });

  it('refuses a body that is not a Toil project, an item and one of the three columns, before the backend runs', async () => {
    const { backend, asked } = recording();
    const { post } = await serve(backend);
    expect((await post({ toilProject: '../etc', item: 'corp-jira:PAY-1', to: 'DONE' })).status).toBe(400);
    expect((await post({ toilProject: 'card-payments', item: '', to: 'DONE' })).status).toBe(400);
    expect((await post({ toilProject: 'card-payments', item: 7, to: 'DONE' })).status).toBe(400);
    expect((await post({ toilProject: 'card-payments', item: 'corp-jira:PAY-1', to: 'UNKNOWN' })).status).toBe(400);
    expect((await post({ toilProject: 'card-payments', item: 'corp-jira:PAY-1', to: 'Done' })).status).toBe(400);
    expect((await post({ toilProject: 'card-payments', item: 'corp-jira:PAY-1' })).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("shows a refusal the way every other refusal is shown, with its status and its fix", async () => {
    const { backend } = recording(async () => {
      throw new BoardRefusal('Changes to corp-jira are switched off.', 'Turn them on under Settings, Connections.', 403);
    });
    const { post } = await serve(backend);
    const r = await post({ toilProject: 'card-payments', item: 'corp-jira:PAY-102', to: 'DONE' });
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({ message: 'Changes to corp-jira are switched off.', fix: 'Turn them on under Settings, Connections.' });
  });

  it("answers from the sample's backend with a proposal, and says there is nothing to ask when the server has none", async () => {
    const sample = await serve(sampleBoard());
    expect(await sample.post({ toilProject: 'sample-team', item: 'sample-jira:SHOP-93', to: 'DONE' })).toMatchObject({ status: 200, body: { status: 'proposal', why: 'sample' } });
    await close?.();
    close = undefined;
    const none = await serve();
    const r = await none.post({ toilProject: 'sample-team', item: 'sample-jira:SHOP-93', to: 'DONE' });
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toMatch(/applies no moves/);
  });

  it('is behind the same guards as every write route: the cookie, the Origin, JSON only', async () => {
    const { backend, asked } = recording();
    const { origin, cookie } = await serve(backend);
    const body = JSON.stringify({ toilProject: 'card-payments', item: 'corp-jira:PAY-102', to: 'DONE' });
    const send = (headers: Record<string, string>) => fetch(new URL('/api/board/move', origin), { method: 'POST', headers, body });
    expect((await send({ origin, 'content-type': 'application/json' })).status).toBe(401);
    expect((await send({ cookie, origin: 'http://evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ cookie, origin, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ cookie, origin, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await fetch(new URL('/api/board/move', origin), { headers: { cookie, origin } })).status).toBe(404);
    expect(asked).toEqual([]);
  });
});
