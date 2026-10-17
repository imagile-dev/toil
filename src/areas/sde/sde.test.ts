import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { fakeFetch } from '../../../test/harness/fake-fetch.js';
import { fakeStore } from '../../../test/harness/fake-store.js';
import { config as fixtureConfig, page, PROJECT, SDE, sdeProject, sdeTask, sdeThreat, sdeUser, serverInfo } from '../../../test/fixtures/sde.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { MAX_PAGES } from '../../core/paginate.js';
import { execute } from '../../core/run.js';
import { createNodeContext } from '../../node-context.js';
import { parseConnectionString } from './area.js';
import { projectCommand, projectsCommand, serverInfoCommand, taskCommand, tasksCommand, threatsCommand, usersCommand, whoamiCommand } from './commands.js';
import { area } from './index.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends to SD Elements and what it makes of the answer. The
 * parity suite proves both front doors agree; this proves what they agree
 * on is what the canonical implementation sent. Suspected bugs (#86) are
 * pinned here, not fixed, pending the usual review by a live server.
 */

const HEADERS = { authorization: 'Token test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });
const urlOf = (calls: Array<{ url: string }>) => calls.map((c) => c.url);

describe('server-info and whoami', () => {
  it('GET their endpoints with the Token header and the predecessor\'s JSON headers, and return the body as data', async () => {
    const info = await run(serverInfoCommand, {}, [ok(serverInfo)]);
    expect(info.calls).toEqual([{ method: 'GET', url: `${SDE}/api/v2/server-info/`, headers: HEADERS, body: undefined }]);
    expect(info.envelope.data).toEqual(serverInfo);
    const me = await run(whoamiCommand, {}, [ok(sdeUser(1))]);
    expect(urlOf(me.calls)).toEqual([`${SDE}/api/v2/users/me/`]);
    expect(me.envelope.data).toEqual(sdeUser(1));
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(whoamiCommand, {}, [ok(sdeUser(1))], { sde: { connectionString: 'test-token@sde.imagile.dev/sde' } });
    expect(urlOf(calls)).toEqual([`${SDE}/sde/api/v2/users/me/`]);
  });

  it('a 401 is AUTH, with where to make a token; a 404 carries the server\'s detail', async () => {
    const denied = await run(whoamiCommand, {}, [{ url: /.*/, respond: { status: 401, json: { detail: 'Invalid token.' } } }]);
    expect(denied.envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('API Tokens') });
    expect(denied.envelope.error?.fix).toContain('TOIL_SDE_CONNECTION_STRING');
    const missing = await run(projectCommand, { id: '9' }, [{ url: /.*/, respond: { status: 404, json: { detail: 'Not found.' } } }]);
    expect(missing.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('Not found.') });
  });
});

describe('the connection string', () => {
  it('splits at the first @ and adds https:// unless the host has a scheme', () => {
    expect(parseConnectionString('abc12345@sde.imagile.dev')).toEqual({ token: 'abc12345', baseUrl: 'https://sde.imagile.dev' });
    expect(parseConnectionString('abc12345@imagile.sdelements.com')).toEqual({ token: 'abc12345', baseUrl: 'https://imagile.sdelements.com' });
    // Suspected bug (#86 item 2): a later @ stays in the host, where a URL parser reads it as userinfo.
    expect(parseConnectionString('abc@sde.imagile.dev@x')).toEqual({ token: 'abc', baseUrl: 'https://sde.imagile.dev@x' });
    expect(parseConnectionString('abc@HTTP://sde.imagile.dev:8080')).toEqual({ token: 'abc', baseUrl: 'HTTP://sde.imagile.dev:8080' });
    expect(parseConnectionString('no-at-sign')).toBeUndefined();
    expect(parseConnectionString('@sde.imagile.dev')).toBeUndefined();
  });

  it('supplies both the host and the token', async () => {
    const { calls } = await run(whoamiCommand, {}, [ok(sdeUser(1))], { sde: { connectionString: 'abc12345@sde.imagile.dev' } });
    expect(calls).toEqual([{ method: 'GET', url: `${SDE}/api/v2/users/me/`, headers: { ...HEADERS, authorization: 'Token abc12345' }, body: undefined }]);
  });

  it('the old key, connection, still works, with a renamed-key warning', async () => {
    const { envelope, calls } = await run(whoamiCommand, {}, [ok(sdeUser(1))], { sde: { connection: 'abc12345@sde.imagile.dev' } });
    expect(envelope.ok).toBe(true);
    expect(calls[0]!.headers.authorization).toBe('Token abc12345');
    expect(envelope.meta.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_RENAMED_KEY' })]));
  });

  it('with no @, or @ first, nothing is set: NOT_CONFIGURED before the project check and before any request', async () => {
    for (const connectionString of ['abc12345', '@sde.imagile.dev']) {
      const { envelope, calls } = await run(tasksCommand, {}, [], { sde: { connectionString } });
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'SDElements not configured.', fix: expect.stringContaining('TOIL_SDE_CONNECTION_STRING') });
    }
    const unset = await run(whoamiCommand, {}, [], { sde: { project: '42' } });
    expect(unset.envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'SDElements not configured.' });
  });
});

describe('the project ID', () => {
  it('comes from the connection (defaults.sde.project) and says so in meta.context; --id on project', async () => {
    const config = { sde: { ...fixtureConfig.sde, project: '7' } };
    const tasks = await run(tasksCommand, {}, [ok(page('/x/', [], 0, 1, 100))], config);
    expect(urlOf(tasks.calls)).toEqual([`${SDE}/api/v2/projects/7/tasks/?page=1&page_size=100`]);
    expect(tasks.envelope.meta.context?.inputs?.project).toEqual({ value: '7', source: 'connection' });
    const project = await run(projectCommand, {}, [ok(sdeProject(7))], config);
    expect(urlOf(project.calls)).toEqual([`${SDE}/api/v2/projects/7/`]);
    expect(project.envelope.meta.context?.inputs?.id).toEqual({ value: '7', source: 'connection' });
    const flag = await run(projectCommand, { id: '9' }, [ok(sdeProject(9))], config);
    expect(urlOf(flag.calls)).toEqual([`${SDE}/api/v2/projects/9/`]);
  });

  it('missing or not a positive whole number fails with the predecessor\'s wording before any request', async () => {
    const none = await run(threatsCommand, {}, []);
    expect(none.calls).toEqual([]);
    expect(none.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'No project specified. Use --project or set defaults.sde.project in config.', fix: expect.stringContaining('TOIL_SDE_PROJECT') });
    for (const bad of ['abc', '-1', '1.5', '0', '00']) {
      const { envelope, calls } = await run(taskCommand, { project: bad, task: '1-T1' }, []);
      expect(calls).toEqual([]);
      expect(envelope.error, bad).toMatchObject({ code: 'INVALID_INPUT', message: `Invalid project ID: "${bad}". SDElements project IDs must be positive integers.` });
    }
    const leading = await run(projectCommand, { id: '007' }, [ok(sdeProject(7))]);
    expect(urlOf(leading.calls)).toEqual([`${SDE}/api/v2/projects/7/`]);
  });
});

describe('the list commands', () => {
  it('users sends each filter by the API\'s name, then page and page_size, and returns the server page as data', async () => {
    const body = page('/users/', [sdeUser(1)], 26, 2, 25);
    const { envelope, calls } = await run(usersCommand, { email: 'you@example.com', firstName: 'Pat', lastName: 'Lee', active: 'true', page: '2', pageSize: '25' }, [ok(body)]);
    expect(calls).toEqual([
      { method: 'GET', url: `${SDE}/api/v2/users/?email=you%40example.com&first_name=Pat&last_name=Lee&is_active=true&page=2&page_size=25`, headers: HEADERS, body: undefined },
    ]);
    // next and previous are passed through as the server sent them, never followed.
    expect(envelope.data).toEqual(body);
  });

  it('projects keeps commas literal and checks --active against true, false and all', async () => {
    const { calls } = await run(projectsCommand, { active: 'all', expand: 'application,creator', include: 'task_counts,permissions' }, [ok(page('/projects/', [], 0, 1, 100))]);
    expect(urlOf(calls)).toEqual([`${SDE}/api/v2/projects/?active=all&expand=application,creator&include=task_counts,permissions&page=1&page_size=100`]);
    const bad = await run(projectsCommand, { active: 'yes' }, []);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --active value: "yes". Allowed: true, false, all.' });
    const users = await run(usersCommand, { active: 'all', all: true }, []);
    expect(users.calls).toEqual([]);
    expect(users.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --active value: "all". Allowed: true, false.' });
  });

  it('tasks and threats send their filters unchecked, by the API\'s names', async () => {
    const tasks = await run(tasksCommand, { project: '42', assignedTo: 'you@example.com', priority: 'high', accepted: 'maybe' }, [ok(page('/x/', [], 0, 1, 100))]);
    expect(urlOf(tasks.calls)).toEqual([`${SDE}/api/v2/projects/42/tasks/?priority=high&assigned_to=you%40example.com&accepted=maybe&page=1&page_size=100`]);
    const threats = await run(threatsCommand, { project: '42', capecId: '66', componentId: 'C12', severity: 'x' }, [ok(page('/x/', [], 0, 1, 100))]);
    expect(urlOf(threats.calls)).toEqual([`${SDE}/api/v2/projects/42/threats/?severity=x&capec_id=66&component_id=C12&page=1&page_size=100`]);
  });

  it('--page and --page-size go through parseInt and must be at least 1', async () => {
    const lenient = await run(usersCommand, { page: '3x', pageSize: 10 }, [ok(page('/users/', [], 0, 3, 10))]);
    expect(urlOf(lenient.calls)).toEqual([`${SDE}/api/v2/users/?page=3&page_size=10`]);
    for (const [field, flag, value] of [['page', '--page', '0'], ['pageSize', '--page-size', 'abc'], ['page', '--page', '-2']] as const) {
      const { envelope, calls } = await run(threatsCommand, { project: '42', [field]: value }, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: `Invalid ${flag}: "${value}". Must be a positive integer.` });
    }
  });

  it('--all ignores --page and --page-size (unchecked), asks 100 at a time, goes past a short page until count, and returns a bare array', async () => {
    const routes: Route[] = [
      { path: '/api/v2/projects/42/threats/', query: { page: '1', page_size: '100' }, respond: { json: page('/t/', [sdeThreat(1), sdeThreat(2)], 3, 1, 100) } },
      { path: '/api/v2/projects/42/threats/', query: { page: '2', page_size: '100' }, respond: { json: page('/t/', [sdeThreat(3)], 3, 2, 100) } },
    ];
    const { envelope, calls } = await run(threatsCommand, { project: '42', all: true, page: '0', pageSize: 'abc' }, routes);
    expect(calls).toHaveLength(2);
    expect(envelope.data).toEqual([sdeThreat(1), sdeThreat(2), sdeThreat(3)]);
  });

  it('--all stops on an empty page, and keeps going while count is missing', async () => {
    const routes: Route[] = [
      { path: '/api/v2/projects/', query: { page: '1', page_size: '100' }, respond: { json: { results: [sdeProject(1)] } } },
      { path: '/api/v2/projects/', query: { page: '2', page_size: '100' }, respond: { json: { results: [sdeProject(2)] } } },
      { path: '/api/v2/projects/', query: { page: '3', page_size: '100' }, respond: { json: { count: 99, results: [] } } },
    ];
    const { envelope, calls } = await run(projectsCommand, { all: true }, routes);
    expect(calls).toHaveLength(3);
    expect(envelope.data).toEqual([sdeProject(1), sdeProject(2)]);
  });

  it('--all fails with HTTP, naming the list, after the 1,000-page bound', async () => {
    const endless: Route = { url: /.*/, respond: { json: { results: [sdeTask(1)] } } };
    const { envelope, calls } = await run(tasksCommand, { project: '42', all: true }, [endless]);
    expect(calls).toHaveLength(MAX_PAGES);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('SD Elements tasks for project 42') });
  });
});

describe('project and task', () => {
  it('project sends expand and include', async () => {
    const { envelope, calls } = await run(projectCommand, { id: '42', expand: 'application,business_unit', include: 'task_counts' }, [ok(sdeProject(PROJECT))]);
    expect(urlOf(calls)).toEqual([`${SDE}/api/v2/projects/42/?expand=application,business_unit&include=task_counts`]);
    expect(envelope.data).toEqual(sdeProject(PROJECT));
  });

  it('task needs --task', async () => {
    const { envelope, calls } = await run(taskCommand, { project: '42' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('suspected bug #86 item 1: --task goes into the path as given, with no <project>- prefix and no encoding', async () => {
    const bare = await run(taskCommand, { project: '42', task: 'T21' }, [ok(sdeTask(21))]);
    expect(urlOf(bare.calls)).toEqual([`${SDE}/api/v2/projects/42/tasks/T21/`]);
    const composite = await run(taskCommand, { project: '42', task: '42-T21', expand: 'status' }, [ok(sdeTask(21))]);
    expect(urlOf(composite.calls)).toEqual([`${SDE}/api/v2/projects/42/tasks/42-T21/?expand=status`]);
    expect(composite.envelope.data).toEqual(sdeTask(21));
    const slash = await run(taskCommand, { project: '42', task: 'a/b' }, [ok(sdeTask(21))]);
    expect(urlOf(slash.calls)).toEqual([`${SDE}/api/v2/projects/42/tasks/a/b/`]);
  });
});

describe('the connection string, through the real config loader', () => {
  const root = mkdtempSync(join(tmpdir(), 'toil-sde-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function whoami(env: Record<string, string>, file?: Record<string, unknown>) {
    const home = mkdtempSync(join(root, 'home-'));
    if (file) {
      mkdirSync(join(home, '.toil'));
      writeFileSync(join(home, '.toil', 'config.json'), JSON.stringify({ version: 2, connections: { sde: { area: 'sde', ...file } }, defaults: { sde: { connection: 'sde' } } }));
    }
    const http = fakeFetch([ok(sdeUser(1))]);
    const ctx = createNodeContext({
      globals: {},
      def: whoamiCommand,
      signal: new AbortController().signal,
      env,
      cwd: home,
      home,
      areas: [{ name: area.name, fallbacks: area.fallbacks }],
      version: '0.0.0-test',
      stderr: () => {},
      secrets: fakeStore({ entries: { 'sde-conn': 'from-store@sde.imagile.dev' } }),
    });
    const envelope = await execute(whoamiCommand, {}, { ...ctx, fetch: http.fetch });
    return { envelope, call: http.calls[0] };
  }

  it('the old TOIL_SDE_CONNECTION env var works, with a renamed-key warning', async () => {
    const { envelope, call } = await whoami({ TOIL_SDE_CONNECTION: 'from-env@sde.imagile.dev' });
    expect(envelope.error).toBeNull();
    expect(call).toMatchObject({ url: `${SDE}/api/v2/users/me/`, headers: { authorization: 'Token from-env' } });
    expect(envelope.meta.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_RENAMED_KEY' })]));
  });

  it('a connection string in the file must be a keychain reference', async () => {
    const stored = await whoami({}, { connectionString: 'keychain:sde-conn' });
    expect(stored.call).toMatchObject({ url: `${SDE}/api/v2/users/me/`, headers: { authorization: 'Token from-store' } });
    const plain = await whoami({}, { connection: 'abc@sde.imagile.dev' });
    expect(plain.envelope.error?.code).toBe('CONFIG_INVALID');
  });

  it('an env value beats the config file, host and token together, under either name', async () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['TOIL_SDE_CONNECTION_STRING', { connectionString: 'keychain:sde-conn' }],
      ['TOIL_SDE_CONNECTION_STRING', { connection: 'keychain:sde-conn' }],
      ['TOIL_SDE_CONNECTION', { connection: 'keychain:sde-conn' }],
    ];
    for (const [name, file] of cases) {
      const { envelope, call } = await whoami({ [name]: 'from-env@env.sde.imagile.dev' }, file);
      expect(envelope.error, `${name} over ${Object.keys(file)[0]}`).toBeNull();
      expect(call, `${name} over ${Object.keys(file)[0]}`).toMatchObject({ url: 'https://env.sde.imagile.dev/api/v2/users/me/', headers: { authorization: 'Token from-env' } });
    }
  });

  it('the old TOIL_SDE_CONNECTION beats a connectionString in the file too: core ranks a renamed key by tier (#128 item 20)', async () => {
    const { envelope, call } = await whoami({ TOIL_SDE_CONNECTION: 'from-env@env.sde.imagile.dev' }, { connectionString: 'keychain:sde-conn' });
    expect(envelope.error).toBeNull();
    expect(call).toMatchObject({ url: 'https://env.sde.imagile.dev/api/v2/users/me/', headers: { authorization: 'Token from-env' } });
  });

  it('no sde connection at all is NOT_CONFIGURED in the old wording, with what to set', async () => {
    const http = fakeFetch([]);
    const home = mkdtempSync(join(root, 'home-'));
    const ctx = createNodeContext({ globals: {}, def: whoamiCommand, signal: new AbortController().signal, env: {}, cwd: home, home, areas: [{ name: area.name, fallbacks: area.fallbacks }], version: '0.0.0-test', stderr: () => {} });
    const envelope = await execute(whoamiCommand, {}, { ...ctx, fetch: http.fetch });
    expect(http.calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'SDElements not configured.', fix: expect.stringContaining('TOIL_SDE_CONNECTION_STRING') });
  });
});
