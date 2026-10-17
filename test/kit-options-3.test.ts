import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiRequest } from '../src/core/api.js';
import { defineArea } from '../src/core/area.js';
import { execute } from '../src/core/run.js';
import { resolveRoutedAliases } from '../src/core/routed-alias.js';
import { clearTokenCache, forgetToken, tokenKey, tokenScope, watchTokenExchanges } from '../src/core/token.js';
import { routedArgvFor } from '../src/program.js';
import { demoContextArea } from './fixtures/demo-context-commands.js';
import { runCli } from './harness/cli.js';
import { testConfig, testContext } from './harness/context.js';
import { withoutExchanges } from './harness/fake-fetch.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * The third batch of porting-kit options (#68), from the wave-2 integrations.
 * Each is additive: no existing command's envelope, error code or exit code
 * changes. The paperwork for each was filed in triplicate, and one copy read.
 */

const sessions: McpSession[] = [];
afterEach(async () => {
  clearTokenCache();
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

/** An area whose service wants a refresh token exchanged for an access token, as alation and checkmarx do. */
const vault = defineArea({
  name: 'vault',
  description: 'test',
  connection: z.object({ baseUrl: z.url(), refreshToken: z.string() }),
  secrets: ['refreshToken'],
  request: (conn) => ({
    baseUrl: conn.baseUrl,
    token: {
      exchange: { url: `${conn.baseUrl}/auth/token`, init: { method: 'POST', body: conn.refreshToken }, credential: conn.refreshToken, read: (b) => ({ token: (b as { access?: string }).access }) },
      headers: (token) => ({ TOKEN: token }),
    },
  }),
});
const vaultConfig = { vault: { baseUrl: 'https://vault.imagile.dev', refreshToken: 'r' } };
const vaultRoutes = [
  { method: 'POST', path: '/auth/token', respond: { json: { access: 'a1' } } },
  { path: '/api/items/1', respond: { json: { id: 1 } } },
  { method: 'POST', path: '/api/items/1/touch', respond: { json: { touched: true } } },
  { method: 'POST', path: '/api/items/delete', respond: { json: { deleted: true } } },
];
const getItem = vault.command({
  path: ['vault', 'get'],
  description: 'test',
  input: z.object({ id: z.string() }),
  writes: false,
  examples: [{ id: '1' }],
  run: (input, ctx) => apiRequest(vault, ctx, `api/items/${encodeURIComponent(input.id)}`),
});

describe("core's token exchange and the read-only check", () => {
  it("leaves out only the exchange core made, so a read's own POST still shows", async () => {
    const watch = watchTokenExchanges();
    const { context, http } = testContext({ config: vaultConfig, routes: vaultRoutes });
    expect((await execute(getItem, { id: '1' }, context)).ok).toBe(true);
    const sneaky = vault.command({ path: ['vault', 'touch'], description: 'test', input: z.object({ id: z.string() }), writes: false, examples: [{ id: '1' }], run: (input, ctx) => apiRequest(vault, ctx, `api/items/${input.id}/touch`, { method: 'POST' }) });
    expect((await execute(sneaky, { id: '1' }, context)).ok).toBe(true);
    watch.stop();
    expect(http.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST']);
    expect(watch.sent).toEqual([{ method: 'POST', url: 'https://vault.imagile.dev/auth/token' }]);
    expect(withoutExchanges(http.calls, watch.sent).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /api/items/1', 'POST /api/items/1/touch']);
  });

  it('exchanges again after the cache is cleared, as a fresh MCP process would', async () => {
    const { context, http } = testContext({ config: vaultConfig, routes: vaultRoutes });
    await execute(getItem, { id: '1' }, context);
    await execute(getItem, { id: '1' }, context);
    clearTokenCache();
    await execute(getItem, { id: '1' }, context);
    expect(http.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it("gives an area the cache's scope, so it can drop its own token without copying the format", async () => {
    const { context, http } = testContext({ config: vaultConfig, routes: vaultRoutes });
    await execute(getItem, { id: '1' }, context);
    expect(tokenScope(vault, { name: 'vault' })).toBe('vault/vault');
    forgetToken(tokenKey(tokenScope(vault, { name: 'vault' }), { url: 'https://vault.imagile.dev/auth/token', credential: 'r' }));
    await execute(getItem, { id: '1' }, context);
    expect(http.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });
});

describe('a request path with a "." or ".." segment', () => {
  const del = vault.command({
    path: ['vault', 'delete'],
    description: 'test',
    input: z.object({ id: z.string(), allowWrite: z.boolean().optional() }),
    writes: true,
    examples: [{ id: '1', allowWrite: true }],
    run: (input, ctx) => apiRequest(vault, ctx, `api/items/${encodeURIComponent(input.id)}/delete`, { method: 'POST' }),
  });
  const raw = vault.command({
    path: ['vault', 'raw'],
    description: 'test',
    input: z.object({ id: z.string(), allowWrite: z.boolean().optional() }),
    writes: true,
    examples: [{ id: '1', allowWrite: true }],
    run: (input, ctx) => apiRequest(vault, ctx, `api/items/${input.id}/delete`, { method: 'POST' }),
  });
  const config = { vault: { ...vaultConfig.vault, writes: true } };

  it('is refused with INVALID_INPUT naming it, before anything is sent, in every spelling the parser collapses', async () => {
    for (const id of ['..', '.', '%2e%2E', '.%2e']) {
      const { context, http } = testContext({ config, routes: vaultRoutes });
      // encodeURIComponent leaves dots alone, so `..` reaches the path as it is; `%2e` arrives encoded once more, so build that one by hand.
      const run = id.includes('%') ? raw : del;
      const envelope = await execute(run, { id, allowWrite: true }, context);
      expect(envelope.error, id).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(`"${id}" as a segment`) });
      expect(http.calls, id).toHaveLength(0);
    }
  });

  it('leaves a dot inside a segment alone', async () => {
    const { context, http } = testContext({ config, routes: [...vaultRoutes, { method: 'POST', path: /^\/api\/items\/[^/]+\/delete$/, respond: { json: {} } }] });
    for (const id of ['v1.2', '.hidden', '...', 'a..b']) expect((await execute(del, { id, allowWrite: true }, context)).ok, id).toBe(true);
    expect(http.calls.filter((c) => c.url.includes('/api/')).map((c) => new URL(c.url).pathname)).toEqual(['/api/items/v1.2/delete', '/api/items/.hidden/delete', '/api/items/.../delete', '/api/items/a..b/delete']);
  });
});

describe('a 429 the area wants back at once', () => {
  const limited = (retry: boolean) =>
    vault.command({
      path: ['vault', retry ? 'retried' : 'once'],
      description: 'test',
      input: z.object({}),
      writes: false,
      examples: [{}],
      run: (_i, ctx) => apiRequest(vault, ctx, 'api/limited', retry ? {} : { retryRateLimit: false, accept: [429] }),
    });

  it('is returned on the first answer with retryRateLimit false, and retried without it', async () => {
    const routes = [vaultRoutes[0]!, { path: '/api/limited', respond: { status: 429, json: { message: 'slow down' }, headers: { 'Retry-After': '0' } } }];
    const once = testContext({ config: vaultConfig, routes });
    expect(await execute(limited(false), {}, once.context)).toMatchObject({ ok: true, data: { message: 'slow down' } });
    expect(once.http.calls.filter((c) => c.url.endsWith('/api/limited'))).toHaveLength(1);
    const retried = testContext({ config: vaultConfig, routes });
    expect((await execute(limited(true), {}, retried.context)).error).toMatchObject({ code: 'HTTP', message: 'Rate limited' });
    expect(retried.http.calls.filter((c) => c.url.endsWith('/api/limited'))).toHaveLength(3);
  });
});

describe("an area's own not-configured wording", () => {
  const own = defineArea({
    name: 'ossy',
    description: 'test',
    connection: z.object({ username: z.string(), token: z.string() }),
    secrets: ['token'],
    notConfigured: { message: 'OSS Index needs an account: set a username and token.' },
  });
  const worded = defineArea({ name: 'ossy-two', description: 'test', connection: z.object({ username: z.string(), token: z.string() }), secrets: ['token'], notConfigured: { message: 'Not set up.', fix: 'Do the thing.' } });
  const get = (a: typeof own | typeof worded) => a.command({ path: [a.name, 'get'], description: 'test', input: z.object({}), writes: false, examples: [{}], run: async () => ({}) });

  it("replaces core's message, keeping core's fix unless the area gives one", async () => {
    expect((await execute(get(own), {}, testContext().context)).error).toEqual({
      code: 'NOT_CONFIGURED',
      message: 'OSS Index needs an account: set a username and token.',
      fix: 'Set TOIL_OSSY_USERNAME and TOIL_OSSY_TOKEN, or add an ossy connection to your toil config.',
    });
    expect((await execute(get(worded), {}, testContext().context)).error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'Not set up.', fix: 'Do the thing.' });
  });
});

describe('a config key the area no longer accepts', () => {
  const cx = defineArea({
    name: 'cx',
    description: 'test',
    connection: z.object({ apiKey: z.string() }),
    secrets: ['apiKey'],
    removed: { clientId: 'Client credentials are no longer supported; set apiKey instead.', clientSecret: 'Client credentials are no longer supported; set apiKey instead.' },
  });
  const get = cx.command({ path: ['cx', 'get'], description: 'test', input: z.object({}), writes: false, examples: [{}], run: async (_i, ctx) => ({ keys: Object.keys(ctx.connection).sort() }) });

  it("warns in the area's words and drops the value, and a missing replacement still fails as usual", async () => {
    const ok = await execute(get, {}, testContext({ config: { cx: { apiKey: 'k', clientId: 'id', clientSecret: 's3cret' } } }).context);
    expect(ok.data).toEqual({ keys: ['apiKey', 'area', 'name', 'writes'] });
    expect(ok.meta.warnings).toEqual([
      { code: 'CONFIG_REMOVED_KEY', message: '"clientId" on connection cx is no longer a cx setting and was ignored: Client credentials are no longer supported; set apiKey instead.' },
      { code: 'CONFIG_REMOVED_KEY', message: '"clientSecret" on connection cx is no longer a cx setting and was ignored: Client credentials are no longer supported; set apiKey instead.' },
    ]);
    expect(JSON.stringify(ok)).not.toContain('s3cret');
    const missing = await execute(get, {}, testContext({ config: { cx: { clientId: 'id' } } }).context);
    expect(missing.error?.code).toBe('CONFIG_INVALID');
    expect(missing.meta.warnings?.[0]?.code).toBe('CONFIG_REMOVED_KEY');
  });

  it('refuses a removed key that is still a connection key', () => {
    expect(() => defineArea({ name: 'cy', description: 'test', connection: z.object({ apiKey: z.string() }), removed: { apiKey: 'gone' } })).toThrow(/removed key "apiKey"/);
  });
});

describe('two selecting inputs that pick one connection together', () => {
  const cluster = defineArea({
    name: 'cluster',
    description: 'test',
    connection: z.object({ baseUrl: z.url(), env: z.string().optional(), instance: z.string().optional() }),
    context: {
      env: { description: 'Environment', flags: '--env <env>', selectsConnection: true },
      instance: { description: 'Instance', flags: '--instance <name>', selectsConnection: true },
    },
  });
  // Typed examples: a command with no inputs of its own still takes its context inputs, with no cast.
  const list = cluster.command({ path: ['cluster', 'which'], description: 'test', input: z.object({}), writes: false, examples: [{ env: 'prod', instance: 'east' }], run: async (_i, ctx) => ({ connection: ctx.connection.name, ...ctx.context }) });
  const config = testConfig();
  for (const [name, env, instance] of [['prod-east', 'prod', 'east'], ['prod-west', 'prod', 'west'], ['stage-east', 'stage', 'east']] as const) {
    config.connections[name] = { area: 'cluster', baseUrl: 'https://cluster.imagile.dev', env, instance };
  }
  const run = (input: Record<string, unknown>) => execute(list, input, { ...testContext().context, config });

  it('selects the connection matching both, which neither picks alone', async () => {
    const both = await run({ env: 'prod', instance: 'east' });
    expect(both.data).toEqual({ connection: 'prod-east', env: 'prod', instance: 'east' });
    expect(both.meta.context?.connection).toEqual({ value: 'prod-east', source: 'input', via: 'env' });
  });

  it('keeps the usual errors when one alone is ambiguous, or nothing matches both', async () => {
    expect((await run({ env: 'prod' })).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Several cluster connections have env "prod"') });
    expect((await run({ env: 'stage', instance: 'west' })).error?.code).toBe('INVALID_INPUT');
    expect((await run({ env: 'prod', instance: 'east', connection: 'prod-west' })).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Two different connections') });
  });

  it('types the example of a command with only context inputs', () => {
    expect(list.examples).toEqual([{ env: 'prod', instance: 'east' }]);
    // Compiles without a cast: demo-context has env, project and board.
    const bare = demoContextArea.command({ path: ['demo-context', 'bare'], description: 'test', input: z.object({}), writes: false, examples: [{ env: 'staging', project: 'PRJ' }], run: async () => ({}) });
    expect(bare.examples).toHaveLength(1);
  });
});

describe('a path routed by a flag value', () => {
  const src = defineArea({ name: 'src', description: 'test', connection: z.object({ token: z.string() }), secrets: ['token'] });
  const target = (name: string, extra: string[] = []) =>
    src.command({
      path: ['src', name],
      description: 'test',
      input: z.object({ ecosystem: z.string().optional(), ...Object.fromEntries(extra.map((f) => [f, z.string().optional()])) }),
      writes: false,
      options: [{ flags: '--ecosystem <ecosystem>', field: 'ecosystem', description: 'e' }, ...extra.map((f) => ({ flags: `--${f.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} <id>`, field: f, description: f }))],
      examples: [{ ecosystem: 'npm' }],
      run: async (input) => ({ ran: name, ...input }),
    });
  const one = target('one');
  const two = target('two', ['applicationId']);
  const table = [{ path: ['old', 'frisk'] as [string, ...string[]], description: 'Check things', flag: '--source <source>', default: 'one', routes: { one: 'src one', two: 'src two', three: 'src three' } }];
  const routed = resolveRoutedAliases(table, [one, two]);
  const commands = [one, two];
  const config = { src: { token: 't' } };
  const cli = (argv: string[]) => runCli(argv, { commands, routed, context: testContext({ config }).context });

  it("runs the value's command, the default without the flag, and names the command in meta", async () => {
    expect((await cli(['old', 'frisk', '--ecosystem', 'npm'])).envelope).toMatchObject({ ok: true, data: { ran: 'one', ecosystem: 'npm' }, meta: { command: 'src one' } });
    const viaTwo = await cli(['old', 'frisk', '--source', 'two', '--application-id', 'app-1']);
    expect(viaTwo.envelope).toMatchObject({ ok: true, data: { ran: 'two', applicationId: 'app-1' }, meta: { command: 'src two' } });
    expect(routedArgvFor(routed[0]!, 'two', two, { applicationId: 'app-1' })).toEqual(['old', 'frisk', '--source', 'two', '--application-id', 'app-1']);
  });

  it('is the same envelope as the MCP tool it routes to', async () => {
    const { context } = testContext({ config });
    const session = await connectMcp({ commands, context });
    sessions.push(session);
    const viaMcp = await session.call('src_two', { applicationId: 'app-1' });
    const viaAlias = await cli(['old', 'frisk', '--source', 'two', '--application-id', 'app-1']);
    expect({ ...viaMcp.envelope, meta: { ...viaMcp.envelope.meta, durationMs: 0 } }).toEqual({ ...viaAlias.envelope, meta: { ...viaAlias.envelope!.meta, durationMs: 0 } });
  });

  it("refuses an unknown value, a route this build doesn't have, and another route's flag, by name", async () => {
    const all = await cli(['old', 'frisk', '--source', 'all']);
    expect(all.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: 'toil old frisk has no --source "all"; it takes one, two, three.', fix: expect.stringContaining('toil src two (--source two)') });
    expect(all.exitCode).toBe(1);
    expect((await cli(['old', 'frisk', '--source', 'three'])).envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: "toil old frisk --source three runs toil src three, which this build of toil doesn't have yet." });
    expect((await cli(['old', 'frisk', '--application-id', 'app-1'])).envelope?.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: "--application-id is for --source two; --source one runs toil src one, which doesn't take it.",
    });
  });

  it('is skipped when no route is registered, and refuses a write, a bad default or a taken path', () => {
    expect(resolveRoutedAliases(table, [])).toEqual([]);
    const write = src.command({ path: ['src', 'w'], description: 'test', input: z.object({ allowWrite: z.boolean().optional() }), writes: true, examples: [{}], run: async () => ({}) });
    expect(() => resolveRoutedAliases([{ ...table[0]!, routes: { one: 'src w' } }], [write])).toThrow(/writes/);
    expect(() => resolveRoutedAliases([{ ...table[0]!, default: 'nope' }], commands)).toThrow(/default "nope"/);
    expect(() => resolveRoutedAliases([{ ...table[0]!, path: ['src', 'one'] }], commands)).toThrow(/already answers/);
  });
});

describe('an area path onto connections remove', () => {
  it('is a core alias, since connections remove now takes an area', async () => {
    const { connectionsCommands } = await import('../src/connections/commands.js');
    const { withCoreAliases, aliasPaths } = await import('../src/core/command.js');
    const jenk = defineArea({ name: 'jenk', description: 'test', connection: z.object({ token: z.string() }), secrets: ['token'], coreAliases: { 'instance remove': 'connections remove' } });
    const remove = withCoreAliases(connectionsCommands([jenk]), [jenk]).find((d) => d.path.join(' ') === 'connections remove')!;
    expect(aliasPaths(remove)).toEqual([['jenk', 'instance', 'remove']]);
    expect(remove.aliases).toEqual([{ path: ['jenk', 'instance', 'remove'], input: { area: 'jenk' } }]);
  });
});
