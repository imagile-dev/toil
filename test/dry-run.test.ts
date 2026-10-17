import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, toolName } from '../src/core/command.js';
import { allowWriteField, execute } from '../src/core/run.js';
import { redactUrl } from '../src/core/http.js';
import { argvFor } from '../src/program.js';
import { demoCommands, demoRoutes, getThing, renameThing } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

const example = renameThing.examples[0] as Record<string, unknown>;

describe('--dry-run', () => {
  it('sends no write through the CLI, and returns the request it would have sent with credentials redacted', async () => {
    const { context, http } = testContext({ config: { demo: { token: 'secret-token', writes: true } }, routes: demoRoutes });
    const run = await runCli(['--dry-run', ...argvFor(renameThing, example)], { commands: demoCommands, context });

    expect(run.exitCode).toBe(0);
    expect(http.calls).toHaveLength(0);
    expect(run.envelope).toMatchObject({
      ok: true,
      data: { dryRun: true, wouldSend: [{ method: 'PUT', url: 'https://demo.imagile.dev/api/things/THING-1', body: '{"name":"Renamed"}' }] },
      meta: { dryRun: true },
    });
    expect(run.stdout).not.toContain('secret-token');
    const planned = (run.envelope?.data as { wouldSend: Array<{ headers: Record<string, string> }> }).wouldSend[0]!;
    expect(planned.headers.authorization).toBe('[redacted]');
  });

  it('sends no write through MCP either, and both front doors agree', async () => {
    const config = { demo: { token: 'secret-token', writes: true } };
    const cli = testContext({ config, routes: demoRoutes, dryRun: true });
    const viaCli = await runCli(argvFor(renameThing, example), { commands: demoCommands, context: cli.context });

    const mcp = testContext({ config, routes: demoRoutes, dryRun: true });
    const session = await connectMcp({ commands: demoCommands, context: mcp.context });
    sessions.push(session);
    const viaMcp = await session.call(toolName(renameThing), example);

    expect([...cli.http.calls, ...mcp.http.calls]).toHaveLength(0);
    const flat = (e: unknown) => ({ ...(e as object), meta: { ...(e as { meta: object }).meta, durationMs: 0 } });
    expect(flat(viaMcp.envelope)).toEqual(flat(viaCli.envelope));
  });

  it('still needs both write approvals: a preview never removes protection', async () => {
    const { context, http } = testContext({ config: { demo: { token: 't' } }, routes: demoRoutes, dryRun: true });
    const run = await runCli(argvFor(renameThing, { id: 'THING-1', name: 'x' }), { commands: demoCommands, context });
    expect(run.envelope?.error?.code).toBe('WRITE_DISABLED');
    expect(http.calls).toHaveLength(0);
  });

  it('refuses a write that bypasses ctx.fetch, before it runs, when the gate is closed', async () => {
    let wrote = 0;
    const dbWrite = defineCommand({
      path: ['db', 'exec'],
      description: 'test',
      input: z.object({ ...allowWriteField }),
      writes: true,
      examples: [{}],
      run: async () => {
        wrote++;
        return { rows: 1 };
      },
    });
    const { context } = testContext({ config: { db: { url: 'x' } }, dryRun: true });
    const envelope = await execute(dbWrite, {}, context);
    expect(envelope.error?.code).toBe('WRITE_DISABLED');
    expect(wrote).toBe(0);
  });

  it('refuses a write command that declares no dry-run support, even with the gate open', async () => {
    let wrote = 0;
    const dbWrite = defineCommand({
      path: ['db', 'exec'],
      description: 'test',
      input: z.object({ ...allowWriteField }),
      writes: true,
      examples: [{ allowWrite: true }],
      run: async () => {
        wrote++;
        return { rows: 1 };
      },
    });
    const { context } = testContext({ config: { db: { url: 'x', writes: true } }, dryRun: true });
    const envelope = await execute(dbWrite, { allowWrite: true }, context);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--dry-run') });
    expect(wrote).toBe(0);
  });

  it("trusts a 'self' command to honour ctx.dryRun", async () => {
    let wrote = 0;
    const fileEdit = defineCommand({
      path: ['code', 'rename'],
      description: 'test',
      input: z.object({ ...allowWriteField }),
      writes: true,
      dryRun: 'self',
      examples: [{ allowWrite: true }],
      run: async (_input, ctx) => {
        if (!ctx.dryRun) wrote++;
        return { planned: ['src/a.ts'], applied: !ctx.dryRun };
      },
    });
    const { context } = testContext({ config: { code: { writes: true } }, dryRun: true });
    const envelope = await execute(fileEdit, { allowWrite: true }, context);
    expect(envelope).toMatchObject({ ok: true, data: { applied: false }, meta: { dryRun: true } });
    expect(wrote).toBe(0);
  });

  it('lets reads through, so a read-only command still answers', async () => {
    const { context, http } = testContext({ config: { demo: { token: 't' } }, routes: demoRoutes, dryRun: true });
    const run = await runCli(argvFor(getThing, { id: 'THING-1' }), { commands: demoCommands, context });
    expect(run.envelope).toMatchObject({ ok: true, data: { id: 'THING-1' }, meta: { dryRun: true } });
    expect(http.calls).toHaveLength(1);
  });
});

describe('--verbose', () => {
  it('adds every request to meta, never a credential', async () => {
    const { context } = testContext({ config: { demo: { token: 'secret-token' } }, routes: demoRoutes });
    const run = await runCli(['--verbose', ...argvFor(getThing, { id: 'THING-2', fields: 'name' })], { commands: demoCommands, context });
    expect(run.envelope?.meta.requests).toEqual([
      { method: 'GET', url: 'https://demo.imagile.dev/api/things/THING-2?fields=name', status: 200, durationMs: expect.any(Number) },
    ]);
    expect(run.stdout).not.toContain('secret-token');
  });

  it('is absent without --verbose', async () => {
    const { context } = testContext({ config: { demo: { token: 't' } }, routes: demoRoutes });
    const run = await runCli(argvFor(getThing, { id: 'THING-1' }), { commands: demoCommands, context });
    expect(run.envelope?.meta).not.toHaveProperty('requests');
  });
});

describe('redactUrl', () => {
  it('hides credential-looking query parameters and userinfo, and keeps the rest', () => {
    const out = redactUrl('https://user:pw@sonar.imagile.dev/api/x?token=abc&project=PAY&api_key=1');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('user:pw');
    expect(out).not.toMatch(/api_key=1/);
    expect(out).toContain('project=PAY');
  });
});
