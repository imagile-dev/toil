import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { versionCommand } from '../src/areas/version.js';
import { defineCommand } from '../src/core/command.js';
import { CONFIG_VERSION } from '../src/core/config.js';
import { execute } from '../src/core/run.js';
import { createNodeContext, timeoutFromEnv } from '../src/node-context.js';
import { getThing } from './fixtures/demo-commands.js';
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
      knownAreas: ['demo'],
      version: '0.0.0-test',
      stderr: () => {},
    });

  it('skips config for standalone commands, so a broken or newer file cannot stop toil version', () => {
    root = mkdtempSync(join(tmpdir(), 'toil-ctx-'));
    mkdirSync(join(root, '.toil'));
    writeFileSync(join(root, '.toil', 'config.json'), JSON.stringify({ version: CONFIG_VERSION + 1 }));

    expect(contextFor(versionCommand, root).config.areas).toEqual({});
    expect(() => contextFor(getThing, root)).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  });
});

describe('timeoutFromEnv', () => {
  it('accepts a positive number of milliseconds and ignores anything else', () => {
    expect(timeoutFromEnv({ TOIL_TIMEOUT_MS: '5000' })).toBe(5000);
    for (const raw of [undefined, '', '0', '-1', 'soon']) expect(timeoutFromEnv({ TOIL_TIMEOUT_MS: raw })).toBeUndefined();
  });
});
