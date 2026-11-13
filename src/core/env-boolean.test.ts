import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from './area.js';
import { anyWrites, connectionWrites, loadConfig, type AreaInfo } from './config.js';
import { resolveConnection } from './connection.js';
import { envBoolean, envSwitch } from './env-boolean.js';
import { fromText } from './schema.js';
import { detectCaps, reducedMotion } from '../welcome/term.js';

describe('envBoolean', () => {
  it('reads 1 and true as on, 0 and false as off, any case, spaces ignored', () => {
    for (const text of ['1', 'true', 'True', 'TRUE', ' TRUE ', '\t1\n']) expect(envBoolean(text), text).toBe(true);
    for (const text of ['0', 'false', 'False', 'FALSE', ' 0 ']) expect(envBoolean(text), text).toBe(false);
  });

  it('never guesses: anything else is unreadable', () => {
    for (const text of ['', ' ', 'yes', 'no', 'on', 'off', '2', '-1', '01', 'tru', 't', 'y', 'true false']) expect(envBoolean(text), text).toBeUndefined();
    expect(envBoolean(undefined)).toBeUndefined();
  });

  it('a presence switch keeps meaning on for any non-empty value, except what reads as off', () => {
    expect(['1', 'true', 'yes', 'anything'].map(envSwitch)).toEqual([true, true, true, true]);
    expect(['0', 'false', ' False '].map(envSwitch)).toEqual([false, false, false]);
    expect(envSwitch('')).toBe(false);
    expect(envSwitch(undefined)).toBe(false);
  });
});

describe('fromText: env typing is separate from argv typing', () => {
  const bool = z.boolean().optional();

  it('argv takes exactly true and false, as before', () => {
    expect(fromText(bool, 'true')).toBe(true);
    expect(fromText(bool, 'false')).toBe(false);
    for (const text of ['1', '0', 'True', 'FALSE', ' true ']) expect(fromText(bool, text), text).toBe(text);
  });

  it('env also takes 1, 0, any case and spaces, through optional, default and nullable wrappers', () => {
    for (const schema of [z.boolean(), bool, z.boolean().default(false), z.boolean().nullable()]) {
      expect(fromText(schema, '1', { env: true })).toBe(true);
      expect(fromText(schema, ' False ', { env: true })).toBe(false);
      expect(fromText(schema, 'yes', { env: true })).toBe('yes');
    }
  });

  it('leaves other types alone: 1 is a number for a number and text for a string', () => {
    expect(fromText(z.number(), '1', { env: true })).toBe(1);
    expect(fromText(z.string(), '1', { env: true })).toBe('1');
    expect(fromText(z.string(), 'TRUE', { env: true })).toBe('TRUE');
    expect(fromText(z.union([z.string(), z.boolean()]), '1', { env: true })).toBe('1');
  });
});

describe('through the real config loader', () => {
  let root: string;
  let home: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'toil-envbool-'));
    home = join(root, 'home');
    repo = join(root, 'repo');
    mkdirSync(join(home, '.toil'), { recursive: true });
    mkdirSync(join(repo, '.git'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const areas: AreaInfo[] = [{ name: 'flagged' }];
  const load = (env: NodeJS.ProcessEnv) => loadConfig({ env, cwd: repo, home, areas });
  const flagged = defineArea({
    name: 'flagged',
    description: 'test',
    connection: z.object({ host: z.string(), insecure: z.boolean().optional(), label: z.string().optional(), size: z.number().optional() }),
  });
  const resolve = (env: NodeJS.ProcessEnv) => resolveConnection(load(env), flagged, undefined, () => {});

  it('TOIL_<AREA>_WRITES and TOIL_CONN_<NAME>_WRITES read 1, true, 0 and false', () => {
    const base = { TOIL_FLAGGED_HOST: 'h' };
    for (const on of ['1', 'true', 'TRUE', ' True ']) {
      const config = load({ ...base, TOIL_FLAGGED_WRITES: on });
      expect(anyWrites(config, 'flagged'), on).toBe(true);
      expect(config.warnings, on).toEqual([]);
    }
    for (const off of ['0', 'false', 'False']) {
      const config = load({ ...base, TOIL_FLAGGED_WRITES: off });
      expect(anyWrites(config, 'flagged'), off).toBe(false);
      expect(config.warnings, off).toEqual([]);
    }
    const named = load({ TOIL_CONN_SANDBOX_AREA: 'flagged', TOIL_CONN_SANDBOX_WRITES: '1' });
    expect(connectionWrites(named.connections.sandbox)).toBe(true);
    expect(named.warnings).toEqual([]);
  });

  it('the values read as on or off before still do', () => {
    expect(connectionWrites({ writes: 'true' })).toBe(true);
    expect(connectionWrites({ writes: true })).toBe(true);
    expect(connectionWrites({ writes: 'false' })).toBe(false);
    expect(connectionWrites({ writes: false })).toBe(false);
    expect(anyWrites(load({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_WRITES: 'true' }), 'flagged')).toBe(true);
  });

  it('yes, on and 2 stay off and still warn, naming the variable and the new fix', () => {
    for (const text of ['yes', 'on', '2', 'tru']) {
      const config = load({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_WRITES: text });
      expect(anyWrites(config, 'flagged'), text).toBe(false);
      expect(config.warnings.map((w) => w.code), text).toEqual(['CONFIG_WRITES_UNREADABLE']);
      expect(config.warnings[0]!.message).toContain(`TOIL_FLAGGED_WRITES is "${text}"`);
      expect(config.warnings[0]!.message).toContain('true or 1');
    }
  });

  it('a boolean setting typed from env reads 1 and 0; a string or number setting does not change', async () => {
    expect(await resolve({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_INSECURE: '1' })).toMatchObject({ insecure: true });
    expect(await resolve({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_INSECURE: ' FALSE ' })).toMatchObject({ insecure: false });
    expect(await resolve({ TOIL_CONN_X_AREA: 'flagged', TOIL_CONN_X_HOST: 'h', TOIL_CONN_X_INSECURE: '0' })).toMatchObject({ insecure: false });
    expect(await resolve({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_LABEL: '1', TOIL_FLAGGED_SIZE: '1' })).toMatchObject({ label: '1', size: 1 });
    await expect(resolve({ TOIL_FLAGGED_HOST: 'h', TOIL_FLAGGED_INSECURE: 'yes' })).rejects.toThrow(/insecure/);
  });

  it('the config file holds real booleans: a string "1" there is still refused', async () => {
    writeFileSync(join(home, '.toil', 'config.json'), JSON.stringify({ version: 3, connections: { flagged: { area: 'flagged', host: 'h', insecure: '1' } } }));
    await expect(resolve({})).rejects.toThrow(/insecure/);
  });

  it('TOIL_STRICT_ENV takes 1 as well as true', () => {
    const env = { TOIL_JIRA_CLOUD_API_TOKEN: '' };
    expect(() => load(env)).not.toThrow();
    for (const on of ['1', 'true', 'TRUE']) expect(() => load({ ...env, TOIL_STRICT_ENV: on }), on).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    for (const off of ['0', 'false', 'yes']) expect(() => load({ ...env, TOIL_STRICT_ENV: off }), off).not.toThrow();
  });
});

describe('the welcome menu switches', () => {
  it('any non-empty value is on, as before, but 0 and false are off', () => {
    expect(reducedMotion({ TOIL_REDUCED_MOTION: '1' })).toBe(true);
    expect(reducedMotion({ TOIL_NO_ANIMATION: 'yes' })).toBe(true);
    expect(reducedMotion({ TOIL_REDUCED_MOTION: '0' })).toBe(false);
    expect(reducedMotion({ TOIL_REDUCED_MOTION: 'false', TOIL_NO_ANIMATION: '0' })).toBe(false);
    expect(reducedMotion({})).toBe(false);
    const caps = (env: NodeJS.ProcessEnv) => detectCaps({ isTTY: true, columns: 100, rows: 30, getColorDepth: () => 24 }, env, 'linux');
    expect(caps({ TOIL_ASCII: '1' }).unicode).toBe(false);
    expect(caps({ TOIL_ASCII: '0' }).unicode).toBe(true);
    expect(caps({}).unicode).toBe(true);
  });
});
