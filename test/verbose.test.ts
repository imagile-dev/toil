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

  it('fails closed: hides every credential-shaped name, case- and separator-insensitively', () => {
    const secrets = [
      'token', 'access_token', 'sonar.token', 'personalAccessToken', 'private_token', 'X-Auth-Token',
      'secret', 'client_secret', 'password', 'os_password', 'Passwd', 'pwd',
      'signature', 'X-Amz-Signature', 'X-Amz-Credential', 'sig', 'JWT', 'key', 'code',
      'api_key', 'apikey', 'apiKey', 'api-key', 'x-api-key', 'subscription-key', 'Ocp-Apim-Subscription-Key', 'accessKey',
    ];
    for (const name of secrets) expect(redactUrl(`https://sonar.imagile.dev/a?${name}=s3cret&x=1`), name).toBe(`https://sonar.imagile.dev/a?${name}=[redacted]&x=1`);
  });

  it('leaves identifiers alone: names ending in keys, a key after a known noun, and projectKeyOrId', () => {
    const ids = [
      'projectKey=PAY', 'componentKeys=a,b', 'metricKeys=coverage,bugs', 'componentKey=c', 'metricKey=m', 'issueKey=ABC-1', 'ruleKey=r',
      'branchKey=b', 'repoKey=r', 'spaceKey=DOC', 'boardKey=b', 'sprintKey=s', 'fileKey=f', 'entityKey=e', 'projectKeyOrId=PAY,OPS', 'keys=k', 'q=a',
    ].join('&');
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
