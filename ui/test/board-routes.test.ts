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
    // GitHub: an open issue in acme/shop, on a Toil project that names no board until a test says so.
    'github issue get': ok('github issue get', { number: 7, state: 'open' }, viaConnection('corp-gh')),
    'projects show': ok('projects show', { name: 'card-payments', toilProject: { github: { connection: 'corp-gh', owner: 'acme', repo: 'shop' } }, areas: { github: { connection: { value: 'corp-gh' }, inputs: { owner: 'acme', repo: 'shop' } } } }),
    'github issue close': ok('github issue close', { number: 7, state: 'closed' }),
    'github issue reopen': ok('github issue reopen', { number: 7, state: 'open' }),
    'github project status': ok('github project status', { changed: true }),
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

  it('leaves a Toil project that would use another connection to the person', async () => {
    const other = toil({ 'jira issue get': ok('jira issue get', {}, viaConnection('other-jira')) });
    const out = await new BoardService({ execute: other.execute }).move('card-payments', 'corp-jira:PAY-102', 'DONE', signal);
    expect(out).toMatchObject({ status: 'proposal', why: 'unsupported' });
    expect((out as { reason: string }).reason).toMatch(/other-jira rather than corp-jira/);
    expect(other.writesSent()).toEqual([]);
    const gh = toil({ 'github issue get': ok('github issue get', { number: 7, state: 'open' }, viaConnection('other-gh')) });
    expect(await new BoardService({ execute: gh.execute }).move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining('other-gh rather than corp-gh') });
    expect(gh.writesSent()).toEqual([]);
  });

  it('leaves an area with no status command to the person', async () => {
    const t = toil({ 'connections list': ok('connections list', { connections: [{ name: 'corp-wiki', area: 'confluence', writes: true }] }) });
    expect(await new BoardService({ execute: t.execute }).move('card-payments', 'corp-wiki:123', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'unsupported' });
    expect(t.writesSent()).toEqual([]);
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

describe('the Board service, GitHub', () => {
  const showWith = (projects: string[]) => ok('projects show', { name: 'card-payments', toilProject: { github: { connection: 'corp-gh', owner: 'acme', repo: 'shop', projects } }, areas: { github: { connection: { value: 'corp-gh' }, inputs: { owner: 'acme', repo: 'shop' } } } });
  const board = (extra: Partial<Record<string, Envelope>> = {}, writes = true) => {
    const t = toil({ 'projects show': showWith(['3']), ...extra }, writes);
    return { t, service: new BoardService({ execute: t.execute }) };
  };
  const item = (id: string, number: number, repo = 'acme/shop') => ({ id, type: 'ISSUE', content: { number, repository: { nameWithOwner: repo } } });
  const items = ok('github project items', [item('PVTI_other', 6, 'acme/elsewhere'), item('PVTI_seven', 7), item('PVTI_eight', 8)]);
  const fields = (options: string[]) => ok('github project fields', [{ name: 'Priority', options: [{ name: 'P1' }] }, { name: 'Status', options: options.map((name) => ({ name })) }]);
  const standard = fields(['Todo', 'In Progress', 'Done']);
  const closedIssue = ok('github issue get', { number: 7, state: 'closed' }, viaConnection('corp-gh'));

  it('moves a card on a project board by the one Status option that reads as the column: project status with the item id, allowWrite, as the UI', async () => {
    const { t, service } = board({ 'github project items': items, 'github project fields': standard });
    const out = await service.move('card-payments', 'corp-gh:acme/shop#7', 'IN_PROGRESS', signal);
    expect(out).toEqual({ status: 'applied', transition: null, toStatus: 'In Progress' });
    expect(t.calls.map((c) => c.command)).toEqual(['projects list', 'connections list', 'github issue get', 'projects show', 'github project items', 'github project fields', 'github project status']);
    expect(t.calls.every((c) => c.options.caller === 'toil-ui')).toBe(true);
    // Owner, repository and number are the id's own, and the board's owner is the Toil project's.
    expect(t.calls[2]).toMatchObject({ input: { toilProject: 'card-payments', owner: 'acme', repo: 'shop', number: [7] } });
    expect(t.calls[4]).toMatchObject({ input: { toilProject: 'card-payments', owner: 'acme', project: 3 } });
    expect(t.calls[5]).toMatchObject({ input: { toilProject: 'card-payments', owner: 'acme', project: 3 } });
    expect(t.calls.slice(0, 6).every((c) => c.options.readOnly === true)).toBe(true);
    expect(t.writesSent()).toEqual([{ command: 'github project status', input: { toilProject: 'card-payments', item: 'PVTI_seven', to: 'In Progress', allowWrite: true }, options: expect.objectContaining({ readOnly: false, caller: 'toil-ui' }) }]);
    expect(t.calls.some((c) => 'connection' in c.input)).toBe(false);
  });

  it("maps the options with toil's own table, whatever the case: Backlog is To do and done is Done", async () => {
    const { t, service } = board({ 'github project items': items, 'github project fields': fields(['Backlog', 'DOING', 'done']) });
    await service.move('card-payments', 'corp-gh:acme/shop#7', 'TODO', signal);
    await service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal);
    expect(t.writesSent().map((c) => c.input.to)).toEqual(['Backlog', 'done']);
  });

  it('moves a pull request that is on the board the same way', async () => {
    const { t, service } = board({ 'github issue get': ok('github issue get', { number: 8, state: 'open', pull_request: {} }, viaConnection('corp-gh')), 'github project items': items, 'github project fields': standard });
    expect((await service.move('card-payments', 'corp-gh:acme/shop#8', 'DONE', signal)).status).toBe('applied');
    expect(t.writesSent()[0]).toMatchObject({ command: 'github project status', input: { item: 'PVTI_eight', to: 'Done' } });
  });

  it.each([
    ['two options read as the column', ['Todo', 'In Progress', 'In Review', 'Done'], /More than one Status option of project 3 reads as In progress/, 'In Progress; In Review'],
    ['none does', ['Todo', 'Done'], /no Status option that toil reads as In progress/, 'Todo; Done'],
  ])('proposes, naming the options and writing nothing, when %s', async (_why, options, reason, listed) => {
    const { t, service } = board({ 'github project items': items, 'github project fields': fields(options) });
    const out = await service.move('card-payments', 'corp-gh:acme/shop#7', 'IN_PROGRESS', signal);
    expect(out).toMatchObject({ status: 'proposal', why: 'choices', reason: expect.stringMatching(reason), detail: expect.stringContaining(listed) });
    expect(t.writesSent()).toEqual([]);
  });

  it('leaves an item that is on none of the boards, and a closed issue asked to leave Done, to the person', async () => {
    const off = board({ 'github project items': ok('github project items', [item('PVTI_other', 6)]) });
    expect(await off.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining("isn't on a GitHub project board") });
    const closed = board({ 'github issue get': closedIssue, 'github project items': items, 'github project fields': standard });
    expect(await closed.service.move('card-payments', 'corp-gh:acme/shop#7', 'TODO', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining('stays in Done') });
    expect(off.t.writesSent().concat(closed.t.writesSent())).toEqual([]);
  });

  it('closes a plain issue dropped on Done, and reopens a closed one dropped on To do', async () => {
    const open = board({ 'projects show': showWith([]) });
    expect(await open.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toEqual({ status: 'applied', transition: null, toStatus: 'closed' });
    expect(open.t.writesSent()).toEqual([{ command: 'github issue close', input: { toilProject: 'card-payments', owner: 'acme', repo: 'shop', number: 7, allowWrite: true }, options: expect.objectContaining({ readOnly: false, caller: 'toil-ui' }) }]);
    // No board is read when the Toil project names none.
    expect(open.t.calls.map((c) => c.command)).toEqual(['projects list', 'connections list', 'github issue get', 'projects show', 'github issue close']);
    const shut = board({ 'projects show': showWith([]), 'github issue get': closedIssue });
    expect(await shut.service.move('card-payments', 'corp-gh:acme/shop#7', 'TODO', signal)).toEqual({ status: 'applied', transition: null, toStatus: 'open' });
    expect(shut.t.writesSent()[0]).toMatchObject({ command: 'github issue reopen', input: { toilProject: 'card-payments', owner: 'acme', repo: 'shop', number: 7, allowWrite: true } });
  });

  it('leaves In progress, a pull request with no board and a move to where the issue already is as proposals, with the reason', async () => {
    const plain = { 'projects show': showWith([]) };
    const a = board(plain);
    expect(await a.service.move('card-payments', 'corp-gh:acme/shop#7', 'IN_PROGRESS', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining('only open or closed') });
    const pull = board({ ...plain, 'github issue get': ok('github issue get', { number: 8, state: 'open', pull_request: {} }, viaConnection('corp-gh')) });
    expect(await pull.service.move('card-payments', 'corp-gh:acme/shop#8', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining('pull request') });
    const there = board(plain);
    expect(await there.service.move('card-payments', 'corp-gh:acme/shop#7', 'TODO', signal)).toMatchObject({ status: 'proposal', why: 'unsupported', reason: expect.stringContaining('already open') });
    const fromDone = board({ ...plain, 'github issue get': closedIssue });
    expect(await fromDone.service.move('card-payments', 'corp-gh:acme/shop#7', 'IN_PROGRESS', signal)).toMatchObject({ status: 'proposal', why: 'unsupported' });
    expect([a, pull, there, fromDone].flatMap((x) => x.t.writesSent())).toEqual([]);
  });

  it('leaves it a proposal, writing nothing, when the connection has writes off', async () => {
    const plain = board({ 'projects show': showWith([]) }, false);
    expect(await plain.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'writes-off' });
    const onBoard = board({ 'github project items': items, 'github project fields': standard }, false);
    expect(await onBoard.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'writes-off' });
    expect(plain.t.writesSent().concat(onBoard.t.writesSent())).toEqual([]);
  });

  it("refuses with toil's own message and fix when toil refuses the write, and shows its refusal to choose as a proposal", async () => {
    const refused = board({ 'projects show': showWith([]), 'github issue close': fail('github issue close', 'WRITE_DISABLED', 'The Toil project chose corp-gh, which Toil UI has not adopted.', 'Copy it with toil projects import.') });
    await expect(refused.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).rejects.toMatchObject({ status: 403, fix: 'Copy it with toil projects import.' });
    const choose = board({ 'github project items': items, 'github project fields': standard, 'github project status': fail('github project status', 'INVALID_INPUT', 'No Status option named "Done".', 'The options are Todo; Done.') });
    expect(await choose.service.move('card-payments', 'corp-gh:acme/shop#7', 'DONE', signal)).toMatchObject({ status: 'proposal', why: 'choices', detail: 'The options are Todo; Done.' });
  });

  it('refuses a malformed id, a draft and a repository that is a dot segment before anything is read from GitHub', async () => {
    const { t, service } = board();
    for (const id of ['corp-gh:7', 'corp-gh:acme/shop', 'corp-gh:acme/shop#0', 'corp-gh:acme/shop#7x', 'corp-gh:acme/draft/PVTI_abc', 'corp-gh:acme/../x#7', 'corp-gh:acme/..#7', 'corp-gh:-acme/shop#7', 'corp-gh:acme/sh op#7']) {
      await expect(service.move('card-payments', id, 'DONE', signal), id).rejects.toBeInstanceOf(BoardRefusal);
    }
    expect(t.calls.filter((c) => c.command.startsWith('github'))).toEqual([]);
    expect(t.writesSent()).toEqual([]);
  });

  it('refuses an issue GitHub does not have', async () => {
    const { t, service } = board({ 'github issue get': fail('github issue get', 'NOT_FOUND', 'Not Found', 'Check the number.') });
    await expect(service.move('card-payments', 'corp-gh:acme/shop#99', 'DONE', signal)).rejects.toMatchObject({ status: 404 });
    expect(t.writesSent()).toEqual([]);
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
