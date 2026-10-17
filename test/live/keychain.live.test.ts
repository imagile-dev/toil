import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connectionsCommands } from '../../src/connections/commands.js';
import { loadConfig } from '../../src/core/config.js';
import type { Context } from '../../src/core/context.js';
import { createSecretStore, SERVICE } from '../../src/core/keychain.js';
import type { Prompter } from '../../src/core/prompt.js';
import { demoArea, demoCommands, demoRoutes } from '../fixtures/demo-commands.js';
import { runCli } from '../harness/cli.js';
import { TEST_VERSION } from '../harness/context.js';
import { fakeFetch } from '../harness/fake-fetch.js';
import { memoryFiles } from '../harness/files.js';

/**
 * The one suite that touches a real OS credential store. `npm test` never
 * runs it (vitest.config.ts excludes test/live/); `npm run test:keychain-live`
 * does, and .github/workflows/keychain-live.yml runs that on macOS (Keychain,
 * `security`) and Linux (Secret Service, `secret-tool`).
 *
 * It drives the real CLI program in-process, through `connections login`, an
 * area command and `connections remove`, with the store createSecretStore()
 * gives the shipped CLI. The area is the test-only `demo` one, because no
 * shipped area holds a secret yet. The token goes in through a scripted
 * prompter, so it is never on any argv, and it is never printed: the log
 * says only whether what came back matched.
 *
 * Each side of the round trip is checked twice: once by toil, and once by
 * asking the OS's own tool directly, so toil can't vouch for itself. The
 * auditor and the audited are, for once, different departments.
 */
const live = process.platform === 'darwin' || process.platform === 'linux';
const NAME = `keychain-live-${Date.now().toString(36)}`;
const REF = `${NAME}.token`;
const TOKEN = `fake-token-${Math.random().toString(36).slice(2, 12)}`;
const commands = [...connectionsCommands([demoArea]), ...demoCommands];

const root = mkdtempSync(join(tmpdir(), 'toil-keychain-live-'));
const home = join(root, 'home');
const file = join(home, '.toil', 'config.json');
const store = createSecretStore();

const log = (line: string) => console.log(`[keychain-live] ${line}`);

/** A fresh context per call, as each CLI run loads config anew. */
function context(fetch: typeof globalThis.fetch, prompt?: Prompter): Context {
  return {
    config: loadConfig({ env: {}, cwd: root, home, areas: [{ name: demoArea.name }] }),
    fetch,
    env: {},
    version: TEST_VERSION,
    verbose: false,
    debug: () => {},
    files: memoryFiles(),
    secrets: store,
    ...(prompt ? { prompt } : {}),
  };
}

/** What the OS's own tool says is stored under the reference, asked directly. Undefined when there's no entry. */
function osLookup(ref: string): { status: number | null; secret: string | undefined } {
  const r =
    process.platform === 'darwin'
      ? spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', ref, '-w'], { encoding: 'utf8' })
      : spawnSync('secret-tool', ['lookup', 'service', SERVICE, 'account', ref], { encoding: 'utf8' });
  return { status: r.status, secret: r.status === 0 ? r.stdout.replace(/\r?\n$/, '') : undefined };
}
const osTool = process.platform === 'darwin' ? `security find-generic-password -s ${SERVICE} -a ${REF}` : `secret-tool lookup service ${SERVICE} account ${REF}`;

afterAll(async () => {
  // Leave the runner (or a developer's machine) as it was, whatever failed.
  try {
    await store.delete(REF);
  } catch {
    // The assertion that failed is the report worth reading.
  }
  rmSync(root, { recursive: true, force: true });
});

describe.runIf(live)(`OS credential store round trip (${store.name})`, () => {
  it('login stores the token, an area command resolves it, remove deletes it', async () => {
    log(`platform ${process.platform}, store ${store.name}, connection ${NAME}`);
    expect(osLookup(REF).secret, 'no entry before the run').toBeUndefined();

    // A connection with no secret yet, as `connections add` would leave one without a token.
    mkdirSync(join(home, '.toil'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 2, connections: { [NAME]: { area: 'demo', baseUrl: 'https://demo.imagile.dev' } } }));

    // 1. login: the token arrives through the prompter, never argv.
    const asked: string[] = [];
    const prompt: Prompter = {
      ask: async () => {
        throw new Error('login asked a visible question');
      },
      askSecret: async (question) => {
        asked.push(question);
        return TOKEN;
      },
    };
    const login = await runCli(['connections', 'login', NAME], { commands, context: context(fakeFetch().fetch, prompt) });
    expect(login.envelope, login.stdout).toMatchObject({ ok: true, data: { name: NAME, secrets: { token: 'store' } } });
    expect(asked).toHaveLength(1);
    expect(login.stdout).not.toContain(TOKEN);
    const written = readFileSync(file, 'utf8');
    expect(JSON.parse(written).connections[NAME].token).toBe(`keychain:${REF}`);
    expect(written).not.toContain(TOKEN);
    log(`login: ok=${login.envelope?.ok}, config holds token="keychain:${REF}", token absent from config and output`);

    const stored = osLookup(REF);
    expect(stored.status, `${osTool} exit code`).toBe(0);
    expect(stored.secret === TOKEN, 'the OS tool returns the token toil stored').toBe(true);
    log(`${osTool} -> exit ${stored.status}, value matches the token: ${stored.secret === TOKEN}`);

    // 2. An area command resolves the reference from the real store and sends it.
    const http = fakeFetch(demoRoutes);
    const get = await runCli(['--verbose', 'demo', 'get-thing', '--id', 'THING-1', '--connection', NAME], { commands, context: context(http.fetch) });
    expect(get.envelope, get.stdout).toMatchObject({ ok: true, data: { id: 'THING-1' } });
    expect(http.calls).toHaveLength(1);
    const authorization = http.calls[0]!.headers.authorization;
    expect(authorization === `Bearer ${TOKEN}`, 'the Authorization header carries the stored token, not the reference').toBe(true);
    expect(get.stdout).not.toContain(TOKEN);
    expect(get.stdout).not.toContain('keychain:');
    const requests = (get.envelope?.meta as { requests?: unknown[] } | undefined)?.requests;
    log(`demo get-thing --verbose: ok=${get.envelope?.ok}, meta.requests=${JSON.stringify(requests)}`);
    log(`request authorization header: present=${authorization !== undefined}, credential not printed (${TOKEN.length} chars), equals "Bearer " + the stored token: ${authorization === `Bearer ${TOKEN}`}`);

    // 3. remove deletes the connection and its store entry.
    const remove = await runCli(['connections', 'remove', NAME], { commands, context: context(fakeFetch().fetch) });
    expect(remove.envelope, remove.stdout).toMatchObject({ ok: true, data: { name: NAME, deletedFromStore: [REF] } });
    expect(JSON.parse(readFileSync(file, 'utf8')).connections[NAME]).toBeUndefined();
    log(`remove: ok=${remove.envelope?.ok}, deletedFromStore=${JSON.stringify((remove.envelope?.data as { deletedFromStore?: unknown }).deletedFromStore)}`);

    const gone = osLookup(REF);
    expect(gone.status, `${osTool} exits non-zero once the entry is gone`).not.toBe(0);
    expect(gone.secret).toBeUndefined();
    expect(await store.get(REF)).toBeUndefined();
    log(`${osTool} -> exit ${gone.status} (entry gone)`);
  });
});

describe.skipIf(live)('OS credential store round trip', () => {
  it(`is not run on ${process.platform}: the live suite covers macOS and Linux`, () => {});
});
