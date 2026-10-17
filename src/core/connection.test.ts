import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from './area.js';
import { emptyConfig, type ResolvedConfig } from './config.js';
import { resolveConnection } from './connection.js';
import type { Warning } from './envelope.js';

const db = defineArea({
  name: 'db',
  description: 'test',
  connection: z.object({
    host: z.string(),
    port: z.number().int(),
    domain: z.string().optional(),
    readOnly: z.boolean().optional(),
  }),
  defaults: { port: 1433 },
  renamed: { server: 'host' },
});

function config(connections: ResolvedConfig['connections'], defaults: ResolvedConfig['defaults'] = {}): ResolvedConfig {
  return { ...emptyConfig(), connections, defaults };
}

async function resolve(cfg: ResolvedConfig, requested?: string) {
  const warnings: Warning[] = [];
  const connection = await resolveConnection(cfg, db, requested, (w) => warnings.push(w));
  return { connection, warnings };
}

describe('resolveConnection', async () => {
  it('layers provider default, then defaults.<area>, then the connection', async () => {
    expect((await resolve(config({ a: { area: 'db', host: 'h' } }))).connection).toMatchObject({ name: 'a', area: 'db', host: 'h', port: 1433, writes: false });
    expect((await resolve(config({ a: { area: 'db', host: 'h' } }, { db: { port: 1500, domain: 'CORP' } }))).connection).toMatchObject({ port: 1500, domain: 'CORP' });
    expect((await resolve(config({ a: { area: 'db', host: 'h', port: 1600 } }, { db: { port: 1500 } }))).connection).toMatchObject({ port: 1600 });
  });

  it('coerces env strings to the schema type', async () => {
    expect((await resolve(config({ a: { area: 'db', host: 'h', port: '5432', readOnly: 'true' } }))).connection).toMatchObject({ port: 5432, readOnly: true });
  });

  it('maps a renamed key, with a warning', async () => {
    const { connection, warnings } = await resolve(config({ a: { area: 'db', server: 'h' } }));
    expect(connection.host).toBe('h');
    expect(warnings.map((w) => w.code)).toEqual(['CONFIG_RENAMED_KEY']);
  });

  it('drops an unknown key, with a warning, so commands only ever see declared settings', async () => {
    const { connection, warnings } = await resolve(config({ a: { area: 'db', host: 'h', hots: 'typo' } }));
    expect(connection).not.toHaveProperty('hots');
    expect(warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_KEY']);
  });

  it('names the variable to set when a required key is missing', async () => {
    await expect(resolve(config({ db: { area: 'db' } }, { db: { connection: 'db' } }))).rejects.toEqual(
      expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_HOST') }),
    );
    await expect(resolve(config({ db: { area: 'db', host: 'h' }, other: { area: 'db' } }, { db: { connection: 'db' } }), 'other')).rejects.toEqual(
      expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_CONN_OTHER_HOST') }),
    );
  });

  it('explains every way the choice can fail', async () => {
    await expect(resolve(config({}))).rejects.toEqual(expect.objectContaining({ code: 'NOT_CONFIGURED', fix: expect.stringContaining('TOIL_DB_HOST') }));
    await expect(resolve(config({ a: { area: 'db', host: 'h' }, b: { area: 'db', host: 'h' } }))).rejects.toEqual(
      expect.objectContaining({ code: 'INVALID_INPUT', fix: expect.stringContaining('--connection') }),
    );
    await expect(resolve(config({ a: { area: 'db', host: 'h' } }), 'nope')).rejects.toEqual(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await expect(resolve(config({ a: { area: 'db', host: 'h' }, j: { area: 'jira' } }), 'j')).rejects.toEqual(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('jira connection') }),
    );
  });

  it('reads writes from the connection, never from defaults.<area>', async () => {
    expect((await resolve(config({ a: { area: 'db', host: 'h', writes: true } }))).connection.writes).toBe(true);
    expect((await resolve(config({ a: { area: 'db', host: 'h' } }, { db: { writes: true } }))).connection.writes).toBe(false);
  });
});

describe('defineArea', async () => {
  it('refuses keys core owns, keys ending in Area, and commands outside the area', async () => {
    const shape = (s: z.ZodRawShape) => () => defineArea({ name: 'x', description: '', connection: z.object(s) });
    expect(shape({ writes: z.boolean() })).toThrow(/set by core/);
    expect(shape({ dataArea: z.string() })).toThrow(/Area/);
    const x = defineArea({ name: 'x', description: '', connection: z.object({}) });
    expect(() => x.command({ path: ['y', 'go'], description: '', input: z.object({}), writes: false, examples: [{}], run: async () => null })).toThrow(/must start with "x"/);
  });

  it('adds the connection input and --connection to every command', async () => {
    const x = defineArea({ name: 'x', description: '', connection: z.object({}) });
    const cmd = x.command({ path: ['x', 'go'], description: '', input: z.object({ id: z.string() }), writes: false, examples: [{ id: '1' }], run: async () => null });
    expect(Object.keys(cmd.input.shape)).toEqual(['id', 'connection']);
    expect(cmd.options?.map((o) => o.flags)).toContain('--connection <name>');
    expect(cmd.area?.name).toBe('x');
  });
});

describe('keychain: references', async () => {
  const api = defineArea({
    name: 'api',
    description: 'test',
    connection: z.object({ baseUrl: z.string(), token: z.string().min(1), label: z.string().optional() }),
    secrets: ['token'],
  });
  const store = (entries: Record<string, string>, fail?: Error) => {
    const asked: string[] = [];
    return {
      asked,
      get: async (ref: string) => {
        asked.push(ref);
        if (fail) throw fail;
        return entries[ref];
      },
    };
  };
  const run = async (cfg: ResolvedConfig, secrets?: ReturnType<typeof store>) => {
    const warnings: Warning[] = [];
    return { connection: await resolveConnection(cfg, api, undefined, (w) => warnings.push(w), secrets), warnings };
  };
  const withRef = (extra: Record<string, unknown> = {}) => config({ a: { area: 'api', baseUrl: 'https://api.imagile.dev', token: 'keychain:a.token', ...extra } });

  it('resolves a reference on a secret key to the stored secret', async () => {
    const secrets = store({ 'a.token': 'fake-secret' });
    expect((await run(withRef(), secrets)).connection).toMatchObject({ token: 'fake-secret' });
    expect(secrets.asked).toEqual(['a.token']);
  });

  it('an env var wins, and the store is never asked', async () => {
    const cfg = withRef();
    cfg.connections.a!.token = 'from-env';
    cfg.sources['a.token'] = 'env';
    const secrets = store({ 'a.token': 'fake-secret' });
    expect((await run(cfg, secrets)).connection).toMatchObject({ token: 'from-env' });
    expect(secrets.asked).toEqual([]);
  });

  it('an unresolvable reference is unset, never the literal string, with a warning naming the fix', async () => {
    for (const secrets of [store({}), store({}, new Error('store is locked')), undefined]) {
      let thrown: unknown;
      try {
        await run(withRef(), secrets);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toMatchObject({ code: 'CONFIG_INVALID', message: expect.stringContaining('token') });
      expect(JSON.stringify(thrown)).not.toContain('keychain:');
    }
    const optional = defineArea({ name: 'api', description: 'test', connection: z.object({ baseUrl: z.string(), token: z.string().optional() }), secrets: ['token'] });
    const warnings: Warning[] = [];
    const resolved = await resolveConnection(withRef(), optional, undefined, (w) => warnings.push(w), store({}));
    expect(resolved).not.toHaveProperty('token');
    expect(warnings).toEqual([expect.objectContaining({ code: 'CONFIG_SECRET_UNRESOLVED', message: expect.stringMatching(/toil connections login a.*TOIL_CONN_A_TOKEN/) })]);
  });

  it('leaves a keychain: value on a key that is not a secret alone', async () => {
    const secrets = store({ 'a.token': 's', 'a.label': 'x' });
    expect((await run(withRef({ label: 'keychain:a.label' }), secrets)).connection).toMatchObject({ label: 'keychain:a.label', token: 's' });
    expect(secrets.asked).toEqual(['a.token']);
  });

  it('resolves a reference shared through defaults.<area>', async () => {
    const cfg = config({ a: { area: 'api', baseUrl: 'https://api.imagile.dev' } }, { api: { token: 'keychain:shared.token' } });
    expect((await run(cfg, store({ 'shared.token': 'shared-secret' }))).connection).toMatchObject({ token: 'shared-secret' });
  });
});
