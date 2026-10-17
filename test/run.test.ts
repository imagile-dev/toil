import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { versionCommand } from '../src/areas/version/version.js';
import { commandName, defineCommand } from '../src/core/command.js';
import { CONFIG_VERSION } from '../src/core/config.js';
import { allowWriteField, execute } from '../src/core/run.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createNodeContext, timeoutFromEnv } from '../src/node-context.js';
import { demoArea, getThing } from './fixtures/demo-commands.js';
import { testConfig, testContext } from './harness/context.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/** Every abort a hung command saw, so a test can tell the server side really stopped. */
const aborts: string[] = [];

/** A command that waits until it's aborted, the way a hung server behaves. */
const hang = defineCommand({
  path: ['demo', 'hang'],
  description: 'Wait forever',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: (_input, ctx) =>
    new Promise((_, reject) => {
      ctx.signal.addEventListener(
        'abort',
        () => {
          aborts.push((ctx.signal.reason as { code?: string }).code ?? 'unknown');
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
    }),
});

const paged = defineCommand({
  path: ['demo', 'paged'],
  description: 'Return one page and a warning',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    ctx.warn({ code: 'TRUNCATED', message: 'Only the first 2 rows were returned.' });
    ctx.setPage({ nextCursor: 'abc', limit: 2 });
    return [1, 2];
  },
});

describe('execute', () => {
  it('stops a command at the time limit with TIMEOUT and a fix naming TOIL_TIMEOUT_MS', async () => {
    const { context } = testContext();
    const envelope = await execute(hang, {}, { ...context, timeoutMs: 20 });
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT', fix: expect.stringContaining('TOIL_TIMEOUT_MS') });
  });

  it('reports CANCELLED when the caller aborts, already or mid-run', async () => {
    const { context } = testContext();
    expect((await execute(hang, {}, { ...context, signal: AbortSignal.abort() })).error?.code).toBe('CANCELLED');

    const controller = new AbortController();
    const running = execute(hang, {}, { ...context, signal: controller.signal });
    controller.abort();
    expect((await running).error?.code).toBe('CANCELLED');
  });

  it('never tells an agent a timed-out or cancelled write was stopped: it may have landed', async () => {
    const hangWrite = demoArea.command({ ...hang, path: ['demo', 'hang-write'], input: z.object({ ...allowWriteField }), writes: true, examples: [{ allowWrite: true }] });
    const { context } = testContext({ config: { demo: { token: 't', writes: true } } });

    const timedOut = await execute(hangWrite, { allowWrite: true }, { ...context, timeoutMs: 20 });
    expect(timedOut.error).toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('may already have been applied'), fix: expect.stringContaining('before retrying') });

    const cancelled = await execute(hangWrite, { allowWrite: true }, { ...context, signal: AbortSignal.abort() });
    expect(cancelled.error).toMatchObject({ code: 'CANCELLED', message: expect.stringContaining('may already have been applied'), fix: expect.stringContaining('before retrying') });

    const read = await execute(hang, {}, { ...context, timeoutMs: 20 });
    expect(read.error?.message).not.toContain('may already have been applied');
  });

  it('hands a command its connection and never the config or env, so it cannot read another credential', async () => {
    let seen: Record<string, unknown> = {};
    const probe = demoArea.command({
      path: ['demo', 'probe'],
      description: 'probe',
      input: z.object({}),
      writes: false,
      examples: [{}],
      run: async (_input, ctx) => {
        seen = { hasConfig: 'config' in ctx, hasEnv: 'env' in ctx, connection: ctx.connection.name, token: ctx.connection.token };
        return null;
      },
    });
    const { context } = testContext({ config: { demo: { token: 'demo-token' }, other: { token: 'other-secret' } } });
    const env = { TOIL_CONN_PROD_TOKEN: 'prod-secret', GITHUB_TOKEN: 'gh-secret' };
    expect((await execute(probe, {}, { ...context, env })).ok).toBe(true);
    expect(seen).toEqual({ hasConfig: false, hasEnv: false, connection: 'demo', token: 'demo-token' });
  });

  it('puts command warnings, config warnings and the page cursor in meta', async () => {
    const { context } = testContext();
    const config = { ...testConfig(), warnings: [{ code: 'CONFIG_RESERVED_KEY', message: 'reserved' }] };
    const envelope = await execute(paged, {}, { ...context, config });
    expect(envelope.meta.warnings?.map((w) => w.code)).toEqual(['CONFIG_RESERVED_KEY', 'TRUNCATED']);
    expect(envelope.meta.page).toEqual({ nextCursor: 'abc', limit: 2 });
  });

  it('leaves warnings and page out of meta when there are none', async () => {
    const { context } = testContext({ config: { demo: { token: 't' } }, routes: [{ url: /things/, respond: { json: { id: 'THING-1', attributes: { name: 'x' } } } }] });
    const envelope = await execute(getThing, { id: 'THING-1' }, context);
    expect(envelope.ok).toBe(true);
    expect(envelope.meta).not.toHaveProperty('warnings');
    expect(envelope.meta).not.toHaveProperty('page');
  });
});

describe('MCP cancellation', () => {
  const sessions: McpSession[] = [];
  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((s) => s.close()));
  });

  it('gives each tool call its own signal, so a client cancel stops that call', async () => {
    const { context } = testContext({ config: { demo: { token: 't' } } });
    const session = await connectMcp({ commands: [hang], context });
    sessions.push(session);
    const controller = new AbortController();
    const call = session.client.callTool({ name: 'demo_hang', arguments: {} }, undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    aborts.length = 0;
    await expect(call).rejects.toThrow();
    // The client gives up at once; the server hears the cancel notification just after.
    await expect.poll(() => aborts).toEqual(['CANCELLED']);
  });

  it('builds each call context for that command, so standalone commands skip config as on the CLI', async () => {
    const { context } = testContext();
    const seen: Array<string | undefined> = [];
    const server = createMcpServer({
      commands: [versionCommand],
      context: (def) => {
        seen.push(def ? commandName(def) : undefined);
        return context;
      },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'toil-tests', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    await client.callTool({ name: 'version', arguments: {} });
    await client.close();
    await server.close();
    expect(seen).toEqual([undefined, 'version']);
  });
});

describe('createNodeContext', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const contextFor = (def: typeof versionCommand | typeof getThing, home: string) =>
    createNodeContext({
      globals: {},
      def,
      signal: new AbortController().signal,
      env: {},
      cwd: home,
      home,
      areas: [{ name: 'demo' }],
      version: '0.0.0-test',
      stderr: () => {},
    });

  it('skips config for standalone commands, so a broken or newer file cannot stop toil version', () => {
    root = mkdtempSync(join(tmpdir(), 'toil-ctx-'));
    mkdirSync(join(root, '.toil'));
    writeFileSync(join(root, '.toil', 'config.json'), JSON.stringify({ version: CONFIG_VERSION + 1 }));

    expect(contextFor(versionCommand, root).config.connections).toEqual({});
    expect(() => contextFor(getThing, root)).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  });
});

describe('timeoutFromEnv', () => {
  it('accepts a positive number of milliseconds and ignores anything else', () => {
    expect(timeoutFromEnv({ TOIL_TIMEOUT_MS: '5000' })).toBe(5000);
    for (const raw of [undefined, '', '0', '-1', 'soon']) expect(timeoutFromEnv({ TOIL_TIMEOUT_MS: raw })).toBeUndefined();
  });
});
