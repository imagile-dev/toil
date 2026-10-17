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

function resolve(cfg: ResolvedConfig, requested?: string) {
  const warnings: Warning[] = [];
  const connection = resolveConnection(cfg, db, requested, (w) => warnings.push(w));
  return { connection, warnings };
}

describe('resolveConnection', () => {
  it('layers provider default, then defaults.<area>, then the connection', () => {
    expect(resolve(config({ a: { area: 'db', host: 'h' } })).connection).toMatchObject({ name: 'a', area: 'db', host: 'h', port: 1433, writes: false });
    expect(resolve(config({ a: { area: 'db', host: 'h' } }, { db: { port: 1500, domain: 'CORP' } })).connection).toMatchObject({ port: 1500, domain: 'CORP' });
    expect(resolve(config({ a: { area: 'db', host: 'h', port: 1600 } }, { db: { port: 1500 } })).connection).toMatchObject({ port: 1600 });
  });

  it('coerces env strings to the schema type', () => {
    expect(resolve(config({ a: { area: 'db', host: 'h', port: '5432', readOnly: 'true' } })).connection).toMatchObject({ port: 5432, readOnly: true });
  });

  it('maps a renamed key, with a warning', () => {
    const { connection, warnings } = resolve(config({ a: { area: 'db', server: 'h' } }));
    expect(connection.host).toBe('h');
    expect(warnings.map((w) => w.code)).toEqual(['CONFIG_RENAMED_KEY']);
  });

  it('drops an unknown key, with a warning, so commands only ever see declared settings', () => {
    const { connection, warnings } = resolve(config({ a: { area: 'db', host: 'h', hots: 'typo' } }));
    expect(connection).not.toHaveProperty('hots');
    expect(warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_KEY']);
  });

  it('names the variable to set when a required key is missing', () => {
    expect(() => resolve(config({ db: { area: 'db' } }, { db: { connection: 'db' } }))).toThrow(
      expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_HOST') }),
    );
    expect(() => resolve(config({ db: { area: 'db', host: 'h' }, other: { area: 'db' } }, { db: { connection: 'db' } }), 'other')).toThrow(
      expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_CONN_OTHER_HOST') }),
    );
  });

  it('explains every way the choice can fail', () => {
    expect(() => resolve(config({}))).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED', fix: expect.stringContaining('TOIL_DB_HOST') }));
    expect(() => resolve(config({ a: { area: 'db', host: 'h' }, b: { area: 'db', host: 'h' } }))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', fix: expect.stringContaining('--connection') }),
    );
    expect(() => resolve(config({ a: { area: 'db', host: 'h' } }), 'nope')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => resolve(config({ a: { area: 'db', host: 'h' }, j: { area: 'jira' } }), 'j')).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('jira connection') }),
    );
  });

  it('reads writes from the connection, never from defaults.<area>', () => {
    expect(resolve(config({ a: { area: 'db', host: 'h', writes: true } })).connection.writes).toBe(true);
    expect(resolve(config({ a: { area: 'db', host: 'h' } }, { db: { writes: true } })).connection.writes).toBe(false);
  });
});

describe('defineArea', () => {
  it('refuses keys core owns, keys ending in Area, and commands outside the area', () => {
    const shape = (s: z.ZodRawShape) => () => defineArea({ name: 'x', description: '', connection: z.object(s) });
    expect(shape({ writes: z.boolean() })).toThrow(/set by core/);
    expect(shape({ dataArea: z.string() })).toThrow(/Area/);
    const x = defineArea({ name: 'x', description: '', connection: z.object({}) });
    expect(() => x.command({ path: ['y', 'go'], description: '', input: z.object({}), writes: false, examples: [{}], run: async () => null })).toThrow(/must start with "x"/);
  });

  it('adds the connection input and --connection to every command', () => {
    const x = defineArea({ name: 'x', description: '', connection: z.object({}) });
    const cmd = x.command({ path: ['x', 'go'], description: '', input: z.object({ id: z.string() }), writes: false, examples: [{ id: '1' }], run: async () => null });
    expect(Object.keys(cmd.input.shape)).toEqual(['id', 'connection']);
    expect(cmd.options?.map((o) => o.flags)).toContain('--connection <name>');
    expect(cmd.area?.name).toBe('x');
  });
});
