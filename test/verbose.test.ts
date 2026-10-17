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

  it('hides only real secret names, case-insensitively, and leaves identifiers that merely end in key alone', () => {
    const secrets = ['token', 'access_token', 'api_key', 'apikey', 'apiKey', 'key', 'Password', 'secret', 'client_secret', 'signature', 'sig', 'JWT', 'X-Amz-Signature', 'private_token'];
    for (const name of secrets) expect(redactUrl(`https://sonar.imagile.dev/a?${name}=s3cret&x=1`), name).toBe(`https://sonar.imagile.dev/a?${name}=[redacted]&x=1`);
    const ids = 'projectKey=PAY&componentKeys=a,b&metricKeys=coverage,bugs&issueKey=ABC-1&keys=k&nextPageToken=abc';
    expect(redactUrl(`https://sonar.imagile.dev/api/x?${ids}`)).toBe(`https://sonar.imagile.dev/api/x?${ids}`);
  });

  it('shows the URL as sent: a literal comma stays a comma, an encoded one stays encoded, and nothing is normalised', () => {
    expect(redactUrl('https://sonar.imagile.dev/api/issues/search?componentKeys=imagile-api&severities=BLOCKER,MAJOR&token=t')).toBe(
      'https://sonar.imagile.dev/api/issues/search?componentKeys=imagile-api&severities=BLOCKER,MAJOR&token=[redacted]',
    );
    expect(redactUrl('https://sonar.imagile.dev/a?q=a%2Cb&flag')).toBe('https://sonar.imagile.dev/a?q=a%2Cb&flag');
    expect(redactUrl('https://sonar.imagile.dev')).toBe('https://sonar.imagile.dev');
    expect(redactUrl('https://u:p@sonar.imagile.dev/x?y=1#frag')).toBe('https://[redacted]@sonar.imagile.dev/x?y=1#frag');
    expect(redactUrl('not a url')).toBe('not a url');
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
