import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../src/core/command.js';
import { redactUrl } from '../src/core/http.js';
import { allowWriteField, execute } from '../src/core/run.js';
import { argvFor } from '../src/program.js';
import { demoCommands, demoRoutes, getThing } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';

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

  it('hides the jwt on a signed release-asset URL', () => {
    const out = redactUrl('https://release-assets.githubusercontent.com/a?sp=r&jwt=eyJabc.def.ghi&rscd=x');
    expect(out).not.toContain('eyJabc');
    expect(out).toContain('sp=r');
  });
});

describe('the write gate covers writes that never touch HTTP', () => {
  it('refuses a database-style write before it runs when either approval is missing', async () => {
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

    const off = testContext({ config: { db: { url: 'x' } } });
    expect((await execute(dbWrite, { allowWrite: true }, off.context)).error?.code).toBe('WRITE_DISABLED');

    const onWithoutFlag = testContext({ config: { db: { url: 'x', writes: true } } });
    expect((await execute(dbWrite, {}, onWithoutFlag.context)).error?.code).toBe('WRITE_DISABLED');

    expect(wrote).toBe(0);
  });
});
