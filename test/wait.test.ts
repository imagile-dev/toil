import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineArea } from '../src/core/area.js';
import type { AnyCommand } from '../src/core/command.js';
import type { Envelope } from '../src/core/envelope.js';
import { ToilError } from '../src/core/errors.js';
import { waitCommand } from '../src/core/wait.js';
import { commands as registered } from '../src/registry.js';
import { demoCommands, demoRoutes } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import type { Route } from './harness/fake-fetch.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * `toil wait` through both front doors, on a test-only build server whose
 * answer changes from one request to the next. Fake timers stand in for the
 * intervals, so a thirty-minute wait takes no time at all.
 */

const ci = defineArea({
  name: 'ci',
  description: 'A test-only build server',
  connection: z.object({ baseUrl: z.url(), token: z.string() }),
  secrets: ['token'],
});

const getBuild = ci.command({
  path: ['ci', 'get-build'],
  description: 'Get one build',
  input: z.object({ number: z.number().int().describe('Build number') }),
  writes: false,
  args: [{ name: 'number', field: 'number', description: 'Build number' }],
  examples: [{ number: 7 }],
  run: async (input, ctx) => {
    const res = await ctx.fetch(new URL(`/builds/${input.number}`, ctx.connection.baseUrl));
    if (res.status === 404) throw new ToilError('NOT_FOUND', `No build ${input.number}.`, { fix: 'Check the number.' });
    if (res.status >= 400) throw new ToilError('HTTP', `HTTP ${res.status}`, { details: { status: res.status } });
    return res.json();
  },
});

const versionCommand = registered.find((def) => def.path.join(' ') === 'version')!;
const commands: AnyCommand[] = [getBuild, ...demoCommands, versionCommand, waitCommand];
const config = { ci: { baseUrl: 'https://ci.imagile.dev', token: 't0ken-abc12345' }, demo: { token: 't', writes: true } };

/** A build that answers `building` until the `done`th request, with `failures` status codes first. */
function build(done: number, failures: number[] = []): Route[] {
  let n = 0;
  return [
    {
      url: 'https://ci.imagile.dev/builds/7',
      respond: () => {
        n++;
        const failure = failures[n - 1];
        if (failure !== undefined) return { status: failure, text: 'down' };
        return { json: n - failures.length >= done ? { number: 7, result: 'SUCCESS' } : { number: 7, result: null, building: true } };
      },
    },
  ];
}

const sessions: McpSession[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

/** Runs the CLI with fake timers advancing until it settles. */
async function cli(argv: string[], routes: Route[], extra: { signal?: AbortSignal; wait?: { maxTimeoutMs: number } } = {}) {
  vi.useFakeTimers();
  const t = testContext({ config, routes: [...routes, ...demoRoutes] });
  if (extra.wait) t.context.config.wait = extra.wait;
  const context = { ...t.context, ...(extra.signal ? { signal: extra.signal } : {}) };
  const run = runCli(argv, { commands, context });
  let settled = false;
  void run.finally(() => (settled = true));
  for (let i = 0; i < 2000 && !settled; i++) await vi.advanceTimersByTimeAsync(1000);
  return { ...(await run), http: t.http, audit: t.audit };
}

/** Calls the MCP wait tool, advancing fake timers, and collects its progress notifications. */
async function mcp(args: Record<string, unknown>, routes: Route[], options: { signal?: AbortSignal; areas?: string[] } = {}) {
  vi.useFakeTimers();
  const t = testContext({ config, routes: [...routes, ...demoRoutes] });
  const session = await connectMcp({ commands, context: t.context, ...(options.areas ? { areas: options.areas } : {}) });
  sessions.push(session);
  const progress: Array<{ progress: number; message?: string }> = [];
  const call = session.client.callTool({ name: 'wait', arguments: args }, undefined, {
    onprogress: (p) => progress.push(p),
    resetTimeoutOnProgress: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let settled = false;
  void call.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 2000 && !settled; i++) await vi.advanceTimersByTimeAsync(1000);
  const result = await call.catch((err: unknown) => err);
  const envelope = result instanceof Error ? undefined : ((result as { structuredContent?: Envelope }).structuredContent as Envelope);
  return { envelope, error: result instanceof Error ? result : undefined, progress, http: t.http, audit: t.audit };
}

const comparable = (e: Envelope | undefined) => e && { ...e, meta: { ...e.meta, durationMs: 0, ...(e.meta.wait ? { wait: { ...e.meta.wait, elapsedMs: 0 } } : {}) } };

describe('toil wait', () => {
  it('repeats the read until the condition holds, through both doors, with one audit line per attempt', async () => {
    const viaCli = await cli(['wait', '--until', 'result != null', '--interval', '5s', '--', 'ci', 'get-build', '7'], build(3));
    expect(viaCli.envelope?.ok, viaCli.stdout).toBe(true);
    expect(viaCli.envelope?.data).toEqual({ number: 7, result: 'SUCCESS' });
    expect(viaCli.envelope?.meta).toMatchObject({ command: 'ci get-build', wait: { until: 'result != null', attempts: 3 } });
    expect(viaCli.envelope?.meta.context?.connection).toMatchObject({ value: 'ci' });
    expect(viaCli.http.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET']);
    expect(viaCli.audit.entries().map((e) => [e.command, e.via, e.outcome])).toEqual([
      ['ci get-build', 'cli', 'ok'],
      ['ci get-build', 'cli', 'ok'],
      ['ci get-build', 'cli', 'ok'],
    ]);
    expect(viaCli.stderr.trim().split('\n')).toHaveLength(2);
    expect(viaCli.stderr).toContain('attempt 1: result != null is not true yet');

    const viaMcp = await mcp({ tool: 'ci_get_build', input: { number: 7 }, until: 'result != null', interval: '5s' }, build(3));
    expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
    expect(viaMcp.http.calls).toEqual(viaCli.http.calls);
    expect(viaMcp.audit.entries().map((e) => [e.command, e.via])).toEqual([
      ['ci get-build', 'mcp'],
      ['ci get-build', 'mcp'],
      ['ci get-build', 'mcp'],
    ]);
    // A progress notification after every attempt that didn't end the wait.
    expect(viaMcp.progress.map((p) => p.progress)).toEqual([1, 2]);
    expect(viaMcp.progress[0]?.message).toContain('not true yet');
  });

  it('waits the interval between attempts', async () => {
    const run = await cli(['wait', '--until', 'result', '--interval', '20s', '--', 'ci', 'get-build', '7'], build(2));
    expect(run.envelope?.meta.wait?.attempts).toBe(2);
    expect(run.envelope?.meta.wait?.elapsedMs).toBeGreaterThanOrEqual(20_000);
    expect(run.envelope?.meta.wait?.elapsedMs).toBeLessThan(25_000);
  });

  it('ends with TIMEOUT and the last data at --timeout, the same through both doors', async () => {
    const viaCli = await cli(['wait', '--until', 'result != null', '--interval', '5s', '--timeout', '1m', '--', 'ci', 'get-build', '7'], build(1000));
    expect(viaCli.envelope?.ok).toBe(false);
    expect(viaCli.exitCode).toBe(1);
    expect(viaCli.envelope?.error).toMatchObject({ code: 'TIMEOUT', details: { data: { number: 7, result: null, building: true } } });
    expect(viaCli.envelope?.error?.message).toContain('after 1m');
    expect(viaCli.envelope?.meta.wait?.attempts).toBe(13);
    expect(viaCli.audit.lines).toHaveLength(13);
    const viaMcp = await mcp({ tool: 'ci_get_build', input: { number: 7 }, until: 'result != null', interval: '5s', timeout: '1m' }, build(1000));
    expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
  });

  it('retries a 5xx or a 429 with backoff, and stops at once on any other error', async () => {
    const retried = await cli(['wait', '--until', 'result', '--interval', '5s', '--', 'ci', 'get-build', '7'], build(1, [503, 429]));
    expect(retried.envelope?.ok, retried.stdout).toBe(true);
    expect(retried.envelope?.meta.wait?.attempts).toBe(3);
    // 10s after the 503, 20s after the 429: twice the interval, then four times.
    expect(retried.envelope?.meta.wait?.elapsedMs).toBeGreaterThanOrEqual(30_000);
    expect(retried.stderr).toContain('HTTP (HTTP 503); retrying');
    expect(retried.audit.entries().map((e) => e.outcome)).toEqual(['HTTP', 'HTTP', 'ok']);

    const stopped = await cli(['wait', '--until', 'result', '--', 'ci', 'get-build', '7'], build(1, [404]));
    expect(stopped.envelope?.error?.code).toBe('NOT_FOUND');
    expect(stopped.envelope?.meta.wait?.attempts).toBe(1);
    const viaMcp = await mcp({ tool: 'ci_get_build', input: { number: 7 }, until: 'result' }, build(1, [404]));
    expect(comparable(viaMcp.envelope)).toEqual(comparable(stopped.envelope));
  });

  it('refuses a write command as INVALID_INPUT through both doors, before any request', async () => {
    const viaCli = await cli(['wait', '--until', 'name', '--', 'demo', 'rename-thing', 'THING-1', '--name', 'x', '--allow-write'], []);
    expect(viaCli.envelope?.error?.code).toBe('INVALID_INPUT');
    expect(viaCli.envelope?.error?.message).toContain('only repeats reads');
    expect(viaCli.envelope?.meta.command).toBe('wait');
    const viaMcp = await mcp({ tool: 'demo_rename_thing', input: { id: 'THING-1', name: 'x', allowWrite: true }, until: 'name' }, []);
    expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
    expect([...viaCli.http.calls, ...viaMcp.http.calls]).toEqual([]);
    expect([...viaCli.audit.lines, ...viaMcp.audit.lines]).toEqual([]);
  });

  it('stops with CANCELLED when the caller cancels, on the CLI and over MCP', async () => {
    const later = new AbortController();
    const routes = build(1000);
    const pending = cli(['wait', '--until', 'result != null', '--interval', '30s', '--', 'ci', 'get-build', '7'], routes, { signal: later.signal });
    // Cancel during the first sleep.
    setTimeout(() => later.abort(), 10_000);
    const run = await pending;
    expect(run.envelope?.error?.code).toBe('CANCELLED');
    expect(run.envelope?.error?.details).toEqual({ data: { number: 7, result: null, building: true } });
    expect(run.envelope?.meta.wait?.attempts).toBe(1);
    expect(run.http.calls).toHaveLength(1);

    const stop = new AbortController();
    const viaMcp = mcp({ tool: 'ci_get_build', input: { number: 7 }, until: 'result != null', interval: '30s' }, build(1000), { signal: stop.signal });
    setTimeout(() => stop.abort(), 10_000);
    const done = await viaMcp;
    expect(done.error, 'the client gave up on the call').toBeDefined();
    // The server stopped too: no attempt after the cancel.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(done.http.calls).toHaveLength(1);
    expect(done.audit.lines).toHaveLength(1);
  });

  it('refuses an interval under the floor, a timeout over the configured maximum and a bad condition', async () => {
    const fast = await cli(['wait', '--until', 'result', '--interval', '1s', '--', 'ci', 'get-build', '7'], []);
    expect(fast.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('at least 5s apart') });
    const long = await cli(['wait', '--until', 'result', '--timeout', '3h', '--', 'ci', 'get-build', '7'], []);
    expect(long.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('longer than the 1h') });
    expect(long.envelope?.error?.fix).toContain('"wait": { "maxTimeout"');
    const raised = await cli(['wait', '--until', 'result', '--timeout', '3h', '--', 'ci', 'get-build', '7'], build(1), { wait: { maxTimeoutMs: 4 * 3_600_000 } });
    expect(raised.envelope?.ok, raised.stdout).toBe(true);
    const bad = await cli(['wait', '--until', 'result ==', '--', 'ci', 'get-build', '7'], []);
    expect(bad.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Invalid until expression') });
    const badMcp = await mcp({ tool: 'ci_get_build', input: { number: 7 }, until: 'result ==' }, []);
    expect(badMcp.envelope?.error?.code).toBe('INVALID_INPUT');
    expect([...fast.http.calls, ...long.http.calls, ...bad.http.calls, ...badMcp.http.calls]).toEqual([]);
  });

  it('applies --select after the condition, and a --select after -- before it', async () => {
    const outer = await cli(['--select', 'result', 'wait', '--until', 'result', '--', 'ci', 'get-build', '7'], build(1));
    expect(outer.envelope?.data).toBe('SUCCESS');
    const inner = await cli(['wait', '--until', "@ == 'SUCCESS'", '--', 'ci', 'get-build', '7', '--select', 'result'], build(1));
    expect(inner.envelope?.data).toBe('SUCCESS');
  });

  it('on the CLI, needs the command after --, and refuses global flags there, unknown commands and a wait in a wait', async () => {
    const none = await cli(['wait', '--until', 'x'], []);
    expect(none.envelope?.error?.message).toContain('after --');
    const pretty = await cli(['wait', '--until', 'x', '--', 'ci', 'get-build', '7', '--pretty'], []);
    expect(pretty.envelope?.error?.message).toBe('--pretty goes before wait, not in the command after --.');
    const unknown = await cli(['wait', '--until', 'x', '--', 'ci', 'no-such'], []);
    expect(unknown.envelope?.error?.code).toBe('INVALID_INPUT');
    const nested = await cli(['wait', '--until', 'x', '--', 'wait', '--until', 'y', '--', 'version'], []);
    expect(nested.envelope?.error?.code).toBe('INVALID_INPUT');
    const viaMcp = await mcp({ tool: 'wait', input: {}, until: 'x' }, []);
    expect(viaMcp.envelope?.error?.message).toContain("can't wait on a wait");
  });

  it('over MCP, can only repeat a tool the server serves', async () => {
    const scoped = await mcp({ tool: 'demo_get_thing', input: { id: 'THING-1' }, until: 'name' }, [], { areas: ['ci'] });
    expect(scoped.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining("isn't a command this toil serves") });
    expect(scoped.http.calls).toEqual([]);
  });
});
