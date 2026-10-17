import { afterEach, describe, expect, it } from 'vitest';
import type { GitRemoteReader } from '../src/core/call-context.js';
import type { ResolvedConfig, Settings, Source } from '../src/core/config.js';
import { execute } from '../src/core/run.js';
import { demoCommands } from './fixtures/demo-commands.js';
import { demoContextCommands, demoContextRoutes, getWidget } from './fixtures/demo-context-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { fakeStore } from './harness/fake-store.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * The area API end to end, on the test-only demo-context area: the context
 * resolver's order, connection selection, settings shared from another
 * area's connection, aliases, and argv typed from the schema. The parity
 * suite already proves both front doors agree on every example; this proves
 * what they agree on.
 */

const commands = [...demoContextCommands, ...demoCommands];
const base = { 'demo-context': { project: 'PRJ', env: 'staging' }, demo: { token: 'shared-token' } };

/** A config of named connections, each value attributed to `source` (env unless said otherwise). */
function configOf(connections: Record<string, Settings & { area: string }>, defaults: ResolvedConfig['defaults'], sources: Record<string, Source> = {}): ResolvedConfig {
  const all: Record<string, Source> = {};
  for (const [name, conn] of Object.entries(connections)) for (const key of Object.keys(conn)) all[`${name}.${key}`] = 'env';
  return { connections, defaults, sources: { ...all, ...sources }, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
}

const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

describe('context inputs', () => {
  it('fills each input from the connection or the area default, and says so in meta.context', async () => {
    const { context, http } = testContext({ config: base, routes: demoContextRoutes });
    const run = await runCli(['demo-context', 'get-widget', 'W-1'], { commands, context });

    expect(run.envelope).toMatchObject({ ok: true, data: { project: 'PRJ', board: 'main', env: null, id: 'W-1', name: 'Widget W-1' } });
    expect(run.envelope?.meta.context).toEqual({
      connection: { value: 'demo-context', source: 'default', default: 'named' },
      inputs: { project: { value: 'PRJ', source: 'connection' }, board: { value: 'main', source: 'default' } },
      shared: { token: { area: 'demo', connection: 'demo', source: 'env' } },
    });
    expect(http.calls.map((c) => [c.url, c.headers.authorization])).toEqual([['https://demo.imagile.dev/api/projects/PRJ/widgets/W-1?board=main', 'Bearer shared-token']]);
  });

  it('takes a group flag before or after the leaf, and a command flag on the leaf', async () => {
    for (const argv of [
      ['demo-context', '--project', 'ABC', 'get-widget', 'W-1', '--board', 'ops'],
      ['demo-context', 'get-widget', 'W-1', '--project', 'ABC', '--board', 'ops'],
    ]) {
      const { context, http } = testContext({ config: base, routes: demoContextRoutes });
      const run = await runCli(argv, { commands, context });
      expect(run.envelope?.meta.context?.inputs, argv.join(' ')).toEqual({ project: { value: 'ABC', source: 'input' }, board: { value: 'ops', source: 'input' } });
      expect(http.calls[0]?.url).toBe('https://demo.imagile.dev/api/projects/ABC/widgets/W-1?board=ops');
    }
  });

  it('offers the same inputs as fixed MCP fields, and refuses a command-level one on a command that lacks it', async () => {
    const { context } = testContext({ config: base, routes: demoContextRoutes });
    const session = await connectMcp({ commands, context });
    sessions.push(session);
    const tools = (await session.client.listTools()).tools;
    const props = (name: string) => Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties ?? {}).sort();
    expect(props('demo_context_get_widget')).toEqual(['board', 'connection', 'env', 'id', 'project']);
    expect(props('demo_context_echo_filters')).not.toContain('board');

    const viaMcp = await session.call('demo_context_echo_filters', { board: 'ops' });
    expect(viaMcp.envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('orders the sources: the call, then the dossier, then the git remote, then the connection', async () => {
    let reads = 0;
    const gitRemote: GitRemoteReader = async () => {
      reads++;
      return { name: 'origin', url: 'https://demo.imagile.dev/scm/GIT/widgets.git' };
    };
    const noProject = { 'demo-context': {}, demo: { token: 't' } };
    const run = async (input: Record<string, unknown>, extra: object) => {
      const { context } = testContext({ config: noProject, routes: demoContextRoutes });
      return execute(getWidget, input, { ...context, ...extra });
    };

    const fromGit = await run({ id: 'W-1' }, { gitRemote });
    expect(fromGit.meta.context?.inputs?.project).toEqual({ value: 'GIT', source: 'git' });
    expect(reads).toBe(1);

    const fromDossier = await run({ id: 'W-1' }, { gitRemote, dossier: (area: string, key: string) => (area === 'demo-context' && key === 'project' ? 'DOS' : undefined) });
    expect(fromDossier.meta.context?.inputs?.project).toEqual({ value: 'DOS', source: 'dossier' });

    reads = 0;
    const explicit = await run({ id: 'W-1', project: 'MINE' }, { gitRemote });
    expect(explicit.meta.context?.inputs?.project).toEqual({ value: 'MINE', source: 'input' });
    expect(reads, 'an explicit value never reads git').toBe(0);
  });

  it('refuses a required input that no source supplies, naming the flag and the env var', async () => {
    const { context, http } = testContext({ config: { 'demo-context': {}, demo: { token: 't' } }, routes: demoContextRoutes });
    const envelope = await execute(getWidget, { id: 'W-1' }, context);
    expect(envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'demo-context get-widget needs project, and none was given or found.',
      fix: 'Pass --project <key>, or set project on connection demo-context (TOIL_DEMO_CONTEXT_PROJECT).',
    });
    expect(http.calls).toHaveLength(0);
  });

  it("checks a value from the git remote or the connection against the input's schema", async () => {
    const { context } = testContext({ config: { 'demo-context': { project: 'lower' }, demo: { token: 't' } }, routes: demoContextRoutes });
    const envelope = await execute(getWidget, { id: 'W-1' }, context);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(`"lower" from the connection's project setting`) });

    const viaGit = await execute(getWidget, { id: 'W-1' }, { ...context, gitRemote: async () => ({ name: 'origin', url: 'https://demo.imagile.dev/scm/bad/x.git' }) });
    // The git remote ranks above the connection, so its bad value is the one reported.
    expect(viaGit.error?.message).toContain('"bad" from the git remote');
  });
});

describe('choosing the connection', () => {
  const two = configOf(
    {
      prod: { area: 'demo-context', env: 'production', project: 'PRD' },
      stage: { area: 'demo-context', env: 'staging', project: 'STG' },
      demo: { area: 'demo', token: 't' },
    },
    { 'demo-context': { connection: 'prod' }, demo: { connection: 'demo' } },
  );
  const run = async (input: Record<string, unknown>, config: ResolvedConfig = two, extra: object = {}) => {
    const { context } = testContext({ routes: demoContextRoutes });
    return execute(getWidget, input, { ...context, config, ...extra });
  };

  it('lets --env select a connection by its setting or its name', async () => {
    expect((await run({ id: 'W-1', env: 'staging' })).meta.context?.connection).toEqual({ value: 'stage', source: 'input', via: 'env' });
    expect((await run({ id: 'W-1', env: 'stage' })).meta.context?.connection).toEqual({ value: 'stage', source: 'input', via: 'env' });
    expect((await run({ id: 'W-1', env: 'staging' })).data).toMatchObject({ project: 'STG', env: 'staging' });
    expect((await run({ id: 'W-1' })).meta.context?.connection).toEqual({ value: 'prod', source: 'default', default: 'named' });
  });

  it('takes the connection from the dossier below the call and above an input the git remote selects', async () => {
    const dossier = (_area: string, key: string) => (key === 'connection' ? 'stage' : undefined);
    expect((await run({ id: 'W-1' }, two, { dossier })).meta.context?.connection).toEqual({ value: 'stage', source: 'dossier' });
    expect((await run({ id: 'W-1', connection: 'prod' }, two, { dossier })).meta.context?.connection).toEqual({ value: 'prod', source: 'input' });
  });

  it('lets a selecting value from a lower source give way to the connection a higher one chose', async () => {
    const dossier = (_area: string, key: string) => (key === 'env' ? 'staging' : undefined);
    const envelope = await run({ id: 'W-1', connection: 'prod' }, two, { dossier });
    expect(envelope.meta.context?.connection).toEqual({ value: 'prod', source: 'input' });
    // Not the dossier's "staging", which would describe the other connection.
    expect(envelope.meta.context?.inputs?.env).toBeUndefined();
    expect(envelope.data).toMatchObject({ project: 'PRD', env: null });
    // With nothing higher, the dossier's env picks the connection.
    expect((await run({ id: 'W-1' }, two, { dossier })).meta.context?.connection).toEqual({ value: 'stage', source: 'dossier', via: 'env' });
  });

  it('says which kind of default it used', async () => {
    const only = configOf({ solo: { area: 'demo-context', project: 'P' }, demo: { area: 'demo', token: 't' } }, { demo: { connection: 'demo' } });
    expect((await run({ id: 'W-1' }, only)).meta.context?.connection).toEqual({ value: 'solo', source: 'default', default: 'only' });
    const named = configOf({ 'demo-context': { area: 'demo-context', project: 'P' }, other: { area: 'demo-context' }, demo: { area: 'demo', token: 't' } }, { demo: { connection: 'demo' } });
    expect((await run({ id: 'W-1' }, named)).meta.context?.connection).toEqual({ value: 'demo-context', source: 'default', default: 'area-name' });
  });

  it('still reports the connection when resolution fails part-way', async () => {
    const { context } = testContext({ config: { 'demo-context': {}, demo: { token: 't' } } });
    const envelope = await execute(getWidget, { id: 'W-1', board: 'ops' }, context);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(envelope.meta.context).toMatchObject({ connection: { value: 'demo-context' }, inputs: { board: { value: 'ops', source: 'input' } } });
  });

  it('refuses --connection and --env that disagree, an env no connection serves, and one several do', async () => {
    expect((await run({ id: 'W-1', connection: 'prod', env: 'staging' })).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('selects connection stage') });
    expect((await run({ id: 'W-1', connection: 'stage', env: 'staging' })).ok).toBe(true);
    expect((await run({ id: 'W-1', env: 'qa' })).error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('prod, stage') });

    const twins = configOf({ a: { area: 'demo-context', env: 'staging' }, b: { area: 'demo-context', env: 'staging' }, demo: { area: 'demo', token: 't' } }, { demo: { connection: 'demo' } });
    expect((await run({ id: 'W-1', env: 'staging', project: 'P' }, twins)).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('a, b') });
  });
});

describe('settings shared from another area', () => {
  const run = async (config: ResolvedConfig, store?: ReturnType<typeof fakeStore>) => {
    const { context, http } = testContext({ routes: demoContextRoutes });
    const envelope = await execute(getWidget, { id: 'W-1', project: 'PRJ' }, { ...context, config, ...(store ? { secrets: store } : {}) });
    return { envelope, auth: http.calls[0]?.headers.authorization };
  };
  const defaults = { 'demo-context': { connection: 'dc' }, demo: { connection: 'de' } };

  it('ranks the env tier above files across both areas, and the own connection first within a tier', async () => {
    const cases: Array<[Source, Source, string]> = [
      ['env', 'env', 'Bearer own'],
      ['global', 'env', 'Bearer theirs'],
      ['env', 'global', 'Bearer own'],
    ];
    for (const [own, theirs, expected] of cases) {
      const cfg = configOf({ dc: { area: 'demo-context', token: 'own' }, de: { area: 'demo', token: 'theirs' } }, defaults, { 'dc.token': own, 'de.token': theirs });
      // A plaintext secret in a file is refused, so the file tier holds keychain references.
      const store = fakeStore({ entries: { 'dc.token': 'own', 'de.token': 'theirs' } });
      for (const [name, source] of [['dc', own], ['de', theirs]] as const) if (source === 'global') cfg.connections[name]!.token = `keychain:${name}.token`;
      expect((await run(cfg, store)).auth, `${own} vs ${theirs}`).toBe(expected);
    }

    const ownUnset = configOf({ dc: { area: 'demo-context' }, de: { area: 'demo', token: 'keychain:de.token' } }, defaults, { 'de.token': 'global' });
    const { envelope, auth } = await run(ownUnset, fakeStore({ entries: { 'de.token': 'from-store' } }));
    expect(auth).toBe('Bearer from-store');
    expect(envelope.meta.context?.shared).toEqual({ token: { area: 'demo', connection: 'de', source: 'store' } });
  });

  it("refuses the other area's plaintext secret in a file, naming that connection", async () => {
    const cfg = configOf({ dc: { area: 'demo-context' }, de: { area: 'demo', token: 'plain' } }, defaults, { 'de.token': 'global' });
    const { envelope, auth } = await run(cfg);
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', message: expect.stringContaining('Connection de (demo) has token in plain text') });
    expect(auth).toBeUndefined();
  });

  it('reports nothing shared when the own connection has the setting, and says which key was sent on a 401', async () => {
    const own = configOf({ dc: { area: 'demo-context', token: 'own' }, de: { area: 'demo', token: 'theirs' } }, defaults);
    expect((await run(own)).envelope.meta.context).not.toHaveProperty('shared');

    const { context } = testContext({ config: base, routes: [{ url: /widgets/, respond: { status: 401, json: {} } }] });
    const rejected = await execute(getWidget, { id: 'W-1' }, context);
    expect(rejected.error?.message).toBe('The token was rejected (sent the shared token from demo connection demo).');
  });
});

describe('area-local commands', () => {
  it("refuse the area's group flags rather than ignore them, before or after the leaf", async () => {
    for (const argv of [
      ['demo-context', '--project', 'ABC', 'about'],
      ['demo-context', 'about', '--project', 'ABC'],
    ]) {
      const { context } = testContext({ config: base });
      const run = await runCli(argv, { commands, context });
      expect(run.envelope?.error?.code, argv.join(' ')).toBe('INVALID_INPUT');
    }
    const { context } = testContext();
    expect((await runCli(['demo-context', 'about'], { commands, context })).envelope).toMatchObject({ ok: true, meta: { command: 'demo-context about' } });
  });
});

describe('aliases', () => {
  it('runs a cross-group alias and a sibling alias as the command, and names the command in meta', async () => {
    for (const path of [['demo', 'widget'], ['demo-context', 'widget']]) {
      const { context, http } = testContext({ config: base, routes: demoContextRoutes });
      const run = await runCli([...path, 'W-1'], { commands, context });
      expect(run.envelope, path.join(' ')).toMatchObject({ ok: true, data: { id: 'W-1' }, meta: { command: 'demo-context get-widget' } });
      expect(http.calls).toHaveLength(1);
    }
  });

  it("gives an alias in another group the area's group flags on its own leaf", async () => {
    const { context, http } = testContext({ config: base, routes: demoContextRoutes });
    const run = await runCli(['demo', 'widget', 'W-1', '--project', 'ABC', '--env', 'staging'], { commands, context });
    expect(run.envelope?.meta.context?.inputs?.project).toEqual({ value: 'ABC', source: 'input' });
    expect(http.calls[0]?.url).toContain('/projects/ABC/');
  });

  it('names the command, not the alias, on a usage error', async () => {
    const { context } = testContext({ config: base });
    const run = await runCli(['demo', 'widget', 'W-1', '--nope'], { commands, context });
    expect(run.envelope).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' }, meta: { command: 'demo-context get-widget' } });
  });
});

describe('CLI values typed from the input schema', () => {
  it('turns numbers, booleans, enums, repeated numbers and JSON into their types, and leaves a union as text', async () => {
    const { context } = testContext({ config: base });
    const argv = ['demo-context', 'echo-filters', '--limit', '5', '--archived', '--strict', 'false', '--sort', 'created', '--id', '1', '--id', '2', '--filter', '{"owner":"you","open":true}', '--label', '7'];
    const run = await runCli(argv, { commands, context });
    expect(run.envelope?.data).toEqual({
      input: { limit: 5, archived: true, strict: false, sort: 'created', ids: [1, 2], filter: { owner: 'you', open: true }, label: '7' },
      context: { project: 'PRJ' },
    });
  });

  it('leaves text that does not parse for the schema to refuse, with the same envelope as MCP', async () => {
    const { context } = testContext({ config: base });
    const cli = await runCli(['demo-context', 'echo-filters', '--limit', 'five', '--filter', '{not json'], { commands, context });
    const session = await connectMcp({ commands, context });
    sessions.push(session);
    const mcp = await session.call('demo_context_echo_filters', { limit: 'five', filter: '{not json' });
    expect(cli.envelope?.error?.code).toBe('INVALID_INPUT');
    expect({ ...mcp.envelope, meta: { ...mcp.envelope.meta, durationMs: 0 } }).toEqual({ ...cli.envelope, meta: { ...cli.envelope!.meta, durationMs: 0 } });
  });
});
