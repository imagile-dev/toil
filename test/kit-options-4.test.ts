import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectionsCommands } from '../src/connections/commands.js';
import { apiRequest } from '../src/core/api.js';
import { defineArea } from '../src/core/area.js';
import { withCoreAliases } from '../src/core/command.js';
import { execute } from '../src/core/run.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';

/**
 * The fourth batch of porting-kit fixes (#68). Small, and filed promptly,
 * which the form has a box for and nobody has ticked before.
 */

const BASE = 'https://vault.imagile.dev/';
const vault = defineArea({
  name: 'vault',
  description: 'test',
  connection: z.object({ baseUrl: z.url(), token: z.string(), env: z.string().optional() }),
  secrets: ['token'],
  context: { env: { description: 'Environment', flags: '--env <env>', selectsConnection: true } },
  coreAliases: { 'instance list': 'connections list' },
  request: (conn) => ({ baseUrl: conn.baseUrl, headers: { Authorization: `Bearer ${conn.token}` } }),
});
const write = vault.command({
  path: ['vault', 'delete'],
  description: 'test',
  input: z.object({ path: z.string(), allowWrite: z.boolean().optional() }),
  writes: true,
  examples: [{ path: 'api/items/1/delete', allowWrite: true }],
  // The path as an area would build it from an input, unencoded so every control character reaches core.
  run: (input, ctx) => apiRequest(vault, ctx, input.path, { method: 'POST' }),
});
const config = { vault: { baseUrl: BASE, token: 't', writes: true } };

describe('a dot segment hidden by what the URL parser drops first', () => {
  // Inside the path: the parser removes every tab, LF and CR. At the end: it trims C0 controls and spaces.
  const inside = ['.\t.', '.\n.', '.\r.', '\t..', '.\t', '%2\te%2e', '%2e\n%2e'].map((id) => `api/items/${id}/delete`);
  const atEnd = ['.. ', '..\u0000', '..\u001f', '. ', '..\t \u0001'].map((id) => `api/items/${id}`);

  it.each([...inside, ...atEnd].map((p) => [JSON.stringify(p), p]))('%s collapses in new URL(), and core refuses it with nothing sent', async (_name, path) => {
    // What the parser really resolves it to: the items segment is gone or emptied.
    const resolved = new URL(path, BASE).pathname;
    expect(resolved, 'the parser collapses it').toMatch(/^\/api\/(items\/)?(delete)?$/);
    const { context, http } = testContext({ config });
    const envelope = await execute(write, { path, allowWrite: true }, context);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('as a segment') });
    expect(http.calls).toHaveLength(0);
  });

  it('is refused in a full URL handed to the request too', async () => {
    const { context, http } = testContext({ config });
    const envelope = await execute(write, { path: `${BASE}api/items/.\t./delete`, allowWrite: true }, context);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(http.calls).toHaveLength(0);
  });

  it('leaves alone what the parser keeps as a segment of its own', async () => {
    for (const path of ['api/items/a\t.b/delete', 'api/items/.. x/delete', 'api/items/v1.2/delete']) {
      expect(new URL(path, BASE).pathname, path).toMatch(/^\/api\/items\/[^/]+\/delete$/);
      const { context, http } = testContext({ config, routes: [{ method: 'POST', path: /^\/api\/items\/[^/]+\/delete$/, respond: { json: {} } }] });
      expect((await execute(write, { path, allowWrite: true }, context)).ok, path).toBe(true);
      expect(http.calls).toHaveLength(1);
    }
  });
});

describe('a dot segment hidden by ;params, which servlet containers strip before resolving dots (KF5)', () => {
  // Tomcat and Jetty read `..;x` as `..`: `content/12345/label/..;x` reaches `content/12345`.
  it.each(['..;x', '.;', '..;', '%2e%2e;x', '.%2e;jsessionid=1', '.;a;b'].map((id) => [id]))('%s is refused with nothing sent', async (id) => {
    const { context, http } = testContext({ config });
    const envelope = await execute(write, { path: `api/content/12345/label/${id}`, allowWrite: true }, context);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(`"${id}" as a segment`) });
    expect(http.calls).toHaveLength(0);
  });

  it('leaves a ; after anything else alone', async () => {
    for (const id of ['a;b', 'v1;rev=2', '...;x', ';..', 'x..;y']) {
      const { context, http } = testContext({ config, routes: [{ method: 'POST', path: /^\/api\/content\/12345\/label\/[^/]+$/, respond: { json: {} } }] });
      expect((await execute(write, { path: `api/content/12345/label/${id}`, allowWrite: true }, context)).ok, id).toBe(true);
      expect(http.calls).toHaveLength(1);
    }
  });
});

describe("a group flag on an area's core alias", () => {
  const areas = [vault];
  const commands = [...withCoreAliases(connectionsCommands(areas), areas), write];
  const both = { vault: { baseUrl: BASE, token: 't', env: 'prod' } };

  it('is refused naming the path the user typed and the flag, not the core command and its field', async () => {
    for (const argv of [
      ['vault', '--env', 'prod', 'instance', 'list'],
      ['vault', 'instance', 'list', '--env', 'prod'],
    ]) {
      const run = await runCli(argv, { commands, context: testContext({ config: both }).context });
      expect(run.envelope?.error, argv.join(' ')).toEqual({
        code: 'INVALID_INPUT',
        message: "toil vault instance list doesn't take --env: it runs toil connections list --area vault, which has no such input.",
        fix: 'Run toil vault instance list without --env.',
      });
      expect(run.exitCode).toBe(1);
    }
    const plain = await runCli(['vault', 'instance', 'list'], { commands, context: testContext({ config: both }).context });
    expect(plain.envelope).toMatchObject({ ok: true, meta: { command: 'connections list' } });
  });
});
