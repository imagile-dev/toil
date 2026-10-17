import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectionsCommands } from '../src/connections/commands.js';
import { defineArea } from '../src/core/area.js';
import { loadConfig } from '../src/core/config.js';
import type { Context } from '../src/core/context.js';
import { createSecretStore, type SecretStore } from '../src/core/keychain.js';
import type { Prompter } from '../src/core/prompt.js';
import { demoArea, demoCommands, demoRoutes } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { TEST_VERSION } from './harness/context.js';
import { fakeFetch } from './harness/fake-fetch.js';
import { fakeStore } from './harness/fake-store.js';

/**
 * `toil connections` against a real config file in a temp home, a fake
 * credential store and a scripted terminal. Nothing here touches the OS
 * store or reads a real terminal.
 */
const warehouse = defineArea({
  name: 'warehouse',
  description: 'A database that signs in with a username and password',
  connection: z.object({
    host: z.string().min(1).describe('Server host'),
    port: z.number().int().describe('Port'),
    username: z.string().min(1).describe('User name'),
    password: z.string().min(1).describe('Password'),
  }),
  secrets: ['password'],
  defaults: { port: 5432 },
});
const areas = [demoArea, warehouse];
const commands = [...connectionsCommands(areas), ...demoCommands];
const SECRET = 'fake-token-abc12345';

let root: string;
let home: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-connections-'));
  home = join(root, 'home');
  file = join(home, '.toil', 'config.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeConfig = (content: unknown) => {
  mkdirSync(join(home, '.toil'), { recursive: true });
  writeFileSync(file, JSON.stringify(content));
};
const readConfig = () => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A scripted terminal: answers by the question's first word, and records what was asked and how. */
function terminal(answers: Record<string, string>) {
  const asked: Array<{ key: string; hidden: boolean; question: string }> = [];
  const answer = (question: string, hidden: boolean) => {
    const key = question.split(/[\s(]/)[0]!;
    asked.push({ key, hidden, question });
    return answers[key] ?? '';
  };
  const prompt: Prompter = {
    ask: async (q, fallback) => answer(q, false) || fallback || '',
    askSecret: async (q) => answer(q, true),
  };
  return { prompt, asked };
}

function context(options: { prompt?: Prompter; secrets?: SecretStore; env?: NodeJS.ProcessEnv } = {}): Context {
  const env = options.env ?? {};
  return {
    config: loadConfig({ env, cwd: root, home, areas: areas.map((a) => ({ name: a.name })) }),
    fetch: fakeFetch(demoRoutes).fetch,
    env,
    version: TEST_VERSION,
    verbose: false,
    debug: () => {},
    ...(options.secrets ? { secrets: options.secrets } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
  };
}

const cli = (argv: string[], ctx: Context) => runCli(argv, { commands, context: ctx });

describe('toil connections add', () => {
  it('asks for the area, base URL and keys with defaults from defineArea, reads the token hidden, and keeps it only in the store', async () => {
    const store = fakeStore();
    const { prompt, asked } = terminal({ Area: 'demo', baseUrl: 'https://jira.imagile.dev', token: SECRET });
    const run = await cli(['connections', 'add', 'corp-demo'], context({ prompt, secrets: store }));

    expect(run.envelope).toMatchObject({ ok: true, data: { name: 'corp-demo', area: 'demo', secrets: { token: 'store' } } });
    expect(asked.map((a) => [a.key, a.hidden])).toEqual([
      ['Area', false],
      ['baseUrl', false],
      ['pageSize', false],
      ['token', true],
    ]);
    expect(asked.find((a) => a.key === 'baseUrl')!.question).toContain('API base URL');
    expect(store.entries.get('corp-demo.token')).toBe(SECRET);
    expect(store.log).toEqual(['set corp-demo.token', 'get corp-demo.token']);
    expect(readConfig()).toEqual({
      version: 2,
      connections: { 'corp-demo': { area: 'demo', baseUrl: 'https://jira.imagile.dev', token: 'keychain:corp-demo.token' } },
      defaults: { demo: { connection: 'corp-demo' } },
    });
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    expect(run.stdout + run.stderr).not.toContain(SECRET);
  });

  it('then the area command reads the token from the store and sends it, never the reference', async () => {
    const store = fakeStore();
    await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: store }));
    const ctx = context({ secrets: store });
    const http = fakeFetch(demoRoutes);
    ctx.fetch = http.fetch;
    const run = await cli(['demo', 'get-thing', '--id', 'THING-1'], ctx);
    expect(run.envelope?.ok, run.stdout).toBe(true);
    expect(http.calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('keeps an accepted provider default out of config, so the default can still change', async () => {
    const { prompt } = terminal({ token: SECRET });
    await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt, secrets: fakeStore() }));
    expect(readConfig().connections['corp-demo']).toEqual({ area: 'demo', token: 'keychain:corp-demo.token' });
  });

  it('asks a token area only for its token, and a password area for its password, both hidden', async () => {
    const tokenOnly = terminal({ token: SECRET });
    await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: tokenOnly.prompt, secrets: fakeStore() }));
    expect(tokenOnly.asked.filter((a) => a.hidden).map((a) => a.key)).toEqual(['token']);
    expect(tokenOnly.asked.map((a) => a.key)).not.toContain('password');
    expect(tokenOnly.asked.map((a) => a.key)).not.toContain('username');

    const store = fakeStore();
    const db = terminal({ host: 'db.imagile.dev', username: 'reporter', password: 'fake-password' });
    const run = await cli(['connections', 'add', 'reporting', '--area', 'warehouse'], context({ prompt: db.prompt, secrets: store }));
    expect(run.envelope?.ok, run.stdout).toBe(true);
    expect(db.asked.map((a) => [a.key, a.hidden])).toEqual([
      ['host', false],
      ['port', false],
      ['username', false],
      ['password', true],
    ]);
    expect(db.asked.find((a) => a.key === 'port')).toBeDefined();
    expect(readConfig().connections.reporting).toEqual({ area: 'warehouse', host: 'db.imagile.dev', username: 'reporter', password: 'keychain:reporting.password' });
  });

  it('carries through every key it did not ask about, and writes version 2', async () => {
    writeConfig({
      version: 2,
      $schema: 'https://imagile-dev.github.io/toil/config.schema.json',
      futureKey: { kept: true },
      connections: { other: { area: 'demo', baseUrl: 'https://other.imagile.dev', token: 'plain', writes: true, note: 'unknown key' } },
      defaults: { demo: { connection: 'other', pageSize: 5 } },
    });
    await cli(['connections', 'add', 'second', '--area', 'demo'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: fakeStore() }));
    expect(readConfig()).toEqual({
      version: 2,
      $schema: 'https://imagile-dev.github.io/toil/config.schema.json',
      futureKey: { kept: true },
      connections: {
        other: { area: 'demo', baseUrl: 'https://other.imagile.dev', token: 'plain', writes: true, note: 'unknown key' },
        second: { area: 'demo', token: 'keychain:second.token' },
      },
      defaults: { demo: { connection: 'other', pageSize: 5 } },
    });
  });

  it('upgrades a version 1 file to the version 2 file it meant, settings intact', async () => {
    writeConfig({ demo: { baseUrl: 'https://v1.imagile.dev', token: 'plain', writes: true } });
    await cli(['connections', 'add', 'reporting', '--area', 'warehouse'], context({ prompt: terminal({ host: 'h', username: 'u', password: 'p' }).prompt, secrets: fakeStore() }));
    expect(readConfig()).toEqual({
      version: 2,
      connections: {
        demo: { area: 'demo', baseUrl: 'https://v1.imagile.dev', token: 'plain', writes: true },
        reporting: { area: 'warehouse', host: 'h', username: 'u', password: 'keychain:reporting.password' },
      },
      defaults: { demo: { connection: 'demo' }, warehouse: { connection: 'reporting' } },
    });
  });

  it.skipIf(process.platform === 'win32')('writes the file readable by the user only (POSIX modes; Windows has none to set)', async () => {
    await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: fakeStore() }));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.toil')).mode & 0o777).toBe(0o700);
  });

  it('with --plaintext, keeps the secret in config and leaves the store alone', async () => {
    const store = fakeStore();
    const run = await cli(['connections', 'add', 'corp-demo', '--area', 'demo', '--plaintext'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: store }));
    expect(run.envelope?.data).toMatchObject({ secrets: { token: 'file' } });
    expect(readConfig().connections['corp-demo'].token).toBe(SECRET);
    expect(store.log).toEqual([]);
  });

  it('with no terminal, fails with a fix naming the env vars, and writes nothing', async () => {
    const store = fakeStore();
    const run = await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ secrets: store }));
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('TOIL_CONN_CORP_DEMO_AREA=demo, TOIL_CONN_CORP_DEMO_BASE_URL, TOIL_CONN_CORP_DEMO_TOKEN') });
    const unknownArea = await cli(['connections', 'add', 'corp-demo'], context({ secrets: store }));
    expect(unknownArea.envelope?.error?.fix).toContain('TOIL_CONN_CORP_DEMO_AREA=<area>');
    expect(store.log).toEqual([]);
    expect(() => readConfig()).toThrow();
  });

  it('when the store is unavailable, fails with a fix naming the env var or --plaintext, and writes nothing', async () => {
    // The real Linux store, with a spawner reporting that secret-tool isn't installed.
    const unavailable = createSecretStore({
      platform: 'linux',
      spawn: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync secret-tool ENOENT'), { code: 'ENOENT' }) }),
    });
    const run = await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: unavailable }));
    expect(run.envelope?.error).toMatchObject({ code: 'CREDENTIAL_STORE', fix: expect.stringMatching(/TOIL_CONN_CORP_DEMO_TOKEN.*--plaintext/) });
    expect(() => readConfig()).toThrow();
  });

  it('refuses settings the area would reject, before storing anything', async () => {
    const store = fakeStore();
    const run = await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: terminal({ baseUrl: 'not a url', token: SECRET }).prompt, secrets: store }));
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('baseUrl') });
    expect(JSON.stringify(run.envelope)).not.toContain(SECRET);
    expect(store.log).toEqual([]);
  });

  it('refuses a name that is taken, or not a valid connection name', async () => {
    writeConfig({ version: 2, connections: { 'corp-demo': { area: 'demo', token: 't' } } });
    const taken = await cli(['connections', 'add', 'corp-demo', '--area', 'demo'], context({ prompt: terminal({}).prompt, secrets: fakeStore() }));
    expect(taken.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('toil connections login corp-demo') });
    const bad = await cli(['connections', 'add', 'Corp_Demo'], context({ prompt: terminal({}).prompt, secrets: fakeStore() }));
    expect(bad.envelope?.error?.code).toBe('INVALID_INPUT');
  });
});

describe('toil connections login', () => {
  it('stores and verifies the new secret, rewrites config, and only then deletes the old plaintext or entry', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:old.token' }, b: { area: 'demo', token: 'plain-old' } }, defaults: { demo: { connection: 'a' } } });
    const seenAtDelete: string[] = [];
    const store = fakeStore({ entries: { 'old.token': 'old-secret' }, onDelete: () => seenAtDelete.push(readFileSync(file, 'utf8')) });

    const a = await cli(['connections', 'login', 'a'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: store }));
    expect(a.envelope, a.stdout).toMatchObject({ ok: true, data: { secrets: { token: 'store' } } });
    expect(store.log).toEqual(['set a.token', 'get a.token', 'delete old.token']);
    expect(seenAtDelete[0]).toContain('keychain:a.token');
    expect(seenAtDelete[0]).not.toContain('keychain:old.token');
    expect([...store.entries]).toEqual([['a.token', SECRET]]);

    await cli(['connections', 'login', 'b'], context({ prompt: terminal({ token: 'fake-new' }).prompt, secrets: store }));
    expect(readConfig().connections.b).toEqual({ area: 'demo', token: 'keychain:b.token' });
    expect(readFileSync(file, 'utf8')).not.toContain('plain-old');
  });

  it('replaces an entry in place, and keeps an old entry another connection still uses', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:shared.token' }, b: { area: 'demo', token: 'keychain:shared.token' } }, defaults: { demo: { connection: 'a' } } });
    const store = fakeStore({ entries: { 'shared.token': 'old' } });
    await cli(['connections', 'login', 'a'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: store }));
    expect(store.entries.get('shared.token')).toBe('old');
    expect(store.log).not.toContain('delete shared.token');
  });

  it('with --plaintext, moves the secret into config first and deletes the store entry after', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:a.token' } } });
    const seenAtDelete: string[] = [];
    const store = fakeStore({ entries: { 'a.token': 'old' }, onDelete: () => seenAtDelete.push(readFileSync(file, 'utf8')) });
    await cli(['connections', 'login', 'a', '--plaintext'], context({ prompt: terminal({ token: SECRET }).prompt, secrets: store }));
    expect(readConfig().connections.a.token).toBe(SECRET);
    expect(seenAtDelete[0]).toContain(SECRET);
    expect(store.entries.size).toBe(0);
  });

  it('with no terminal, fails with a fix naming the env vars and changes nothing', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:a.token' } } });
    const before = readFileSync(file, 'utf8');
    const run = await cli(['connections', 'login', 'a'], context({ secrets: fakeStore() }));
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('TOIL_CONN_A_TOKEN') });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses a connection defined only by env vars, or one that does not exist', async () => {
    const env = { TOIL_CONN_CI_DEMO_AREA: 'demo', TOIL_CONN_CI_DEMO_TOKEN: 'x' };
    const envOnly = await cli(['connections', 'login', 'ci-demo'], context({ env, prompt: terminal({}).prompt }));
    expect(envOnly.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('TOIL_CONN_CI_DEMO_') });
    const missing = await cli(['connections', 'login', 'nope'], context({ prompt: terminal({}).prompt }));
    expect(missing.envelope?.error?.code).toBe('INVALID_INPUT');
  });
});

describe('toil connections remove', () => {
  it('removes the connection and its default, then deletes its store entry', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:a.token' }, b: { area: 'demo', token: 'keychain:b.token' } }, defaults: { demo: { connection: 'a', pageSize: 5 } } });
    const seenAtDelete: string[] = [];
    const store = fakeStore({ entries: { 'a.token': 'x', 'b.token': 'y' }, onDelete: () => seenAtDelete.push(readFileSync(file, 'utf8')) });
    const run = await cli(['connections', 'remove', 'a'], context({ secrets: store }));
    expect(run.envelope).toMatchObject({ ok: true, data: { name: 'a', deletedFromStore: ['a.token'] } });
    expect(readConfig()).toEqual({ version: 2, connections: { b: { area: 'demo', token: 'keychain:b.token' } }, defaults: { demo: { pageSize: 5 } } });
    expect(seenAtDelete[0]).not.toContain('"a"');
    expect([...store.entries.keys()]).toEqual(['b.token']);
  });

  it('removes from config even when the store is unavailable, and warns about what was left', async () => {
    writeConfig({ version: 2, connections: { a: { area: 'demo', token: 'keychain:a.token' } } });
    const run = await cli(['connections', 'remove', 'a'], context({ secrets: fakeStore({ fail: new Error('locked') }) }));
    expect(run.envelope?.ok).toBe(true);
    expect(run.envelope?.meta.warnings).toEqual([expect.objectContaining({ code: 'CREDENTIAL_STORE_LEFTOVER' })]);
    expect(readConfig().connections).toEqual({});
  });
});

describe('toil connections list', () => {
  it('shows names, areas, hosts, writes and where each value came from, never a secret', async () => {
    writeConfig({
      version: 2,
      connections: {
        a: { area: 'demo', baseUrl: 'https://jira.imagile.dev', token: 'keychain:a.token', writes: true },
        b: { area: 'demo', token: 'plaintext-secret' },
        reporting: { area: 'warehouse', host: 'db.imagile.dev', username: 'reporter', password: 'plaintext-password' },
      },
      defaults: { demo: { connection: 'a', pageSize: 5 } },
    });
    const store = fakeStore({ entries: { 'a.token': SECRET } });
    const run = await cli(['connections', 'list'], context({ secrets: store, env: { TOIL_CONN_B_BASE_URL: 'https://env.imagile.dev' } }));
    expect(run.envelope?.data).toEqual({
      configFile: file.replace(/\\/g, '/'),
      connections: [
        { name: 'a', area: 'demo', isDefault: true, host: 'jira.imagile.dev', writes: true, values: { baseUrl: 'file', token: 'store', writes: 'file', pageSize: 'defaults' } },
        { name: 'b', area: 'demo', isDefault: false, host: 'env.imagile.dev', writes: false, values: { token: 'file', baseUrl: 'env', pageSize: 'defaults' } },
        { name: 'reporting', area: 'warehouse', isDefault: true, host: 'db.imagile.dev', writes: false, values: { host: 'file', username: 'file', password: 'file' } },
      ],
    });
    for (const secret of [SECRET, 'plaintext-secret', 'plaintext-password', 'keychain:']) expect(run.stdout).not.toContain(secret);
    // Listing never asks the store for anything.
    expect(store.log).toEqual([]);
  });
});
