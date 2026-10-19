import { z } from 'zod';
import type { AnyArea } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import {
  CONNECTION_NAME,
  connectionEnvName,
  connectionWrites,
  defaultConnectionName,
  readConfigForEdit,
  writeConfigFile,
  type EditableConfig,
  type Settings,
} from '../core/config.js';
import { apiRequest } from '../core/api.js';
import { coerce, resolveConnection } from '../core/connection.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { ToilError, withArticle } from '../core/errors.js';
import { isKeychainRef, KEYCHAIN_PREFIX, refFor, refName, storeVerified, type SecretStore } from '../core/keychain.js';
import type { Prompter } from '../core/prompt.js';

/**
 * `toil connections add | login | list | remove | test | writes | default`:
 * setting up the connections that every area command resolves. Secrets go
 * straight to the OS credential store and config holds only a `keychain:`
 * reference; a secret never sits in the file (env vars are the other place one
 * may live). `login` is also how a plaintext secret left in an old file moves
 * into the store. `add`, `login`, `remove`, `writes` and `default` are CLI
 * only: a person sets up and changes connections, never an agent over MCP.
 * `list` and `test` are safe anywhere: `list` prints names, hosts and where
 * each value came from, never a value that could be a secret, and `test`
 * sends one read.
 *
 * Every step that moves a secret keeps it somewhere: it's stored and read
 * back, then config is rewritten, and only then is any old copy removed. The
 * procedure has three steps and no sign-off, which is two fewer sign-offs
 * than it was offered.
 */
export function connectionsCommands(areas: readonly AnyArea[]): AnyCommand[] {
  const areaNamed = (name: string): AnyArea => {
    const area = areas.find((a) => a.name === name);
    if (area) return area;
    throw new ToilError('INVALID_INPUT', `toil has no area named "${name}".`, {
      fix: areas.length ? `Use one of: ${areas.map((a) => a.name).join(', ')}.` : 'This toil has no areas that take a connection yet.',
    });
  };

  const add = defineConfigCommand({
    path: ['connections', 'add'],
    description: 'Set up a connection, asking for its settings and secret on the terminal',
    input: z.object({
      name: z.string().describe('Connection name, e.g. corp-jira'),
      area: z.string().optional().describe('The area it connects to; asked for when left out'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'Connection name, e.g. corp-jira' }],
    options: [
      { flags: '--area <area>', field: 'area', description: 'The area it connects to (asked for when left out)' },
    ],
    examples: [{ name: 'corp-jira', area: 'jira' }],
    run: async (input, ctx) => {
      const { config, secrets, prompt } = access(ctx);
      checkName(input.name);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      if (file.connections[input.name]) {
        throw new ToilError('INVALID_INPUT', `There's already a connection named "${input.name}".`, {
          fix: `Run toil connections login ${input.name} to replace its secret, or toil connections remove ${input.name} first.`,
        });
      }
      if (!prompt) throw needsTerminal('add', input.name, input.area ? areaNamed(input.area) : undefined);
      const area = areaNamed(input.area ?? (await prompt.ask(`Area (${areas.map((a) => a.name).join(', ')})`, areas.length === 1 ? areas[0]!.name : undefined, 'area')));

      const { settings, secretValues } = await askSettings(prompt, area);
      const parsed = (area.connection as z.ZodObject).safeParse({ ...(area.defaults ?? {}), ...settings, ...secretValues });
      if (!parsed.success) {
        const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))];
        throw new ToilError('INVALID_INPUT', `Those settings aren't a valid ${area.name} connection: check ${keys.join(', ')}. Nothing was saved.`, {
          fix: `Run toil connections add ${input.name} again.`,
          details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      // Nothing is saved until the person has seen what will be. Secrets are
      // named, never shown: they were typed hidden and stay that way.
      const review = [
        `area ${area.name}`,
        // An object or array setting (Jira's customFields) reads as JSON, not [object Object].
        ...Object.entries(settings).map(([k, v]) => `${k} ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`),
        ...Object.keys(secretValues).map((k) => `${k} to the OS credential store`),
      ].join(', ');
      const answer = await prompt.ask(`Save ${input.name} (${review})? y/n`, 'y', 'confirm');
      if (!/^y(es)?$/i.test(answer)) throw new ToilError('CANCELLED', 'Nothing was saved.', { fix: `Run toil connections add ${input.name} again.` });

      const kept = await storeNew(secrets, input.name, secretValues, ctx.signal);
      file.connections[input.name] = { area: area.name, ...settings, ...kept };
      // The first connection to an area becomes its default, so adding a
      // second one later doesn't leave the area with no default.
      const others = Object.keys(file.connections).filter((n) => n !== input.name && file.connections[n]!.area === area.name);
      if (others.length === 0 && typeof file.defaults[area.name]?.connection !== 'string') {
        file.defaults[area.name] = { ...(file.defaults[area.name] ?? {}), connection: input.name };
      }
      writeConfigFile(path, file);
      return { name: input.name, area: area.name, configFile: slashes(path), secrets: whereKept(kept) };
    },
  });

  const login = defineConfigCommand({
    path: ['connections', 'login'],
    description: "Replace a connection's secret, asking for it on the terminal",
    input: z.object({
      name: z.string().describe('Connection name'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    examples: [{ name: 'corp-jira' }],
    run: async (input, ctx) => {
      const { config, secrets, prompt } = access(ctx);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const conn = fileConnection(file, input.name, config);
      const area = areaNamed(conn.area);
      const keys = area.secrets ?? [];
      if (keys.length === 0) {
        throw new ToilError('INVALID_INPUT', `${area.name} connections have no secret to log in with.`, { fix: `Edit "${input.name}" in ${slashes(path)} instead.` });
      }
      if (!prompt) throw needsTerminal('login', input.name, area);

      const entered: Record<string, string> = {};
      for (const key of keys) {
        const value = await prompt.askSecret(secretLabel(area, key), `secret:${key}`);
        if (value !== '') entered[key] = value;
      }
      if (Object.keys(entered).length === 0) throw new ToilError('INVALID_INPUT', 'Nothing was entered, so nothing changed.', { fix: `Run toil connections login ${input.name} again.` });

      const before: Settings = { ...conn };
      for (const [key, value] of Object.entries(entered)) {
        const ref = refFor(input.name, key);
        await storeVerified(required(secrets, ref), ref, value, ctx.signal);
        conn[key] = `${KEYCHAIN_PREFIX}${ref}`;
      }
      writeConfigFile(path, file);
      // Only now, with config pointing at the new copy, does an old one go.
      for (const key of Object.keys(entered)) {
        const old = before[key];
        if (isKeychainRef(old) && old !== conn[key]) await deleteUnreferenced(file, old, secrets, ctx);
      }
      return { name: input.name, area: area.name, configFile: slashes(path), secrets: whereKept(Object.fromEntries(Object.keys(entered).map((k) => [k, conn[k]]))) };
    },
  });

  const list = defineConfigCommand({
    path: ['connections', 'list'],
    description: 'List connections: area, host, writes, and where each value came from. Never prints a secret.',
    toolDescription:
      "Lists every toil connection: its name, area, whether it's the area's default, its host, whether writes are on, where each setting came from (env, ci, file, store or defaults), and whether the connection is in the config file (definedIn file) or made by env vars alone (env). Never returns a secret or any setting's value other than the host. Use it to find the connection name to pass as `connection` to another tool; set `area` for one area's connections only.",
    input: z.object({
      area: z.string().optional().describe('Only connections to this area, e.g. jira'),
    }),
    writes: false,
    writesLocal: false,
    options: [{ flags: '--area <area>', field: 'area', description: 'Only connections to this area' }],
    examples: [{}, { area: 'jira' }],
    run: async (input, ctx) => {
      const { config } = access(ctx);
      // An area toil doesn't have is a mistake to point out, not an empty list.
      if (input.area !== undefined) areaNamed(input.area);
      // A connection the file doesn't hold was made by env vars alone (TOIL_CONN_<NAME>_AREA, or an
      // area's TOIL_<AREA>_* or CI variables), so the commands that change the file can't change it.
      const inFile = fileConnectionNames(config);
      const connections = Object.keys(config.connections)
        .filter((name) => input.area === undefined || config.connections[name]!.area === input.area)
        .sort()
        .map((name) => {
          const conn = config.connections[name]!;
          const secretKeys = new Set<string>(areas.find((a) => a.name === conn.area)?.secrets ?? []);
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(conn)) {
            if (key === 'area') continue;
            const source = config.sources[`${name}.${key}`];
            values[key] = source === 'env' || source === 'ci' ? source : isKeychainRef(value) ? 'store' : 'file';
          }
          for (const key of Object.keys(config.defaults[conn.area] ?? {})) if (key !== 'connection' && !(key in values)) values[key] = 'defaults';
          return {
            name,
            area: conn.area,
            isDefault: defaultConnectionName(config, conn.area) === name,
            host: hostOf(conn, secretKeys),
            writes: connectionWrites(conn),
            values,
            definedIn: inFile.has(name) ? 'file' : 'env',
          };
        });
      return { configFile: slashes(config.files.global), connections };
    },
  });

  const remove = defineConfigCommand({
    path: ['connections', 'remove'],
    description: 'Remove a connection from config, and its secrets from the OS credential store',
    input: z.object({
      name: z.string().describe('Connection name'),
      area: z.string().optional().describe('Remove it only if it connects to this area, e.g. jenkins'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    options: [{ flags: '--area <area>', field: 'area', description: 'Remove it only if it connects to this area' }],
    examples: [{ name: 'corp-jira' }, { name: 'corp-jira', area: 'jira' }],
    run: async (input, ctx) => {
      const { config, secrets } = access(ctx);
      if (input.area !== undefined) areaNamed(input.area);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const conn = fileConnection(file, input.name, config);
      // An area-scoped remove (`toil jenkins instance remove`) touches only that area's connections.
      if (input.area !== undefined && conn.area !== input.area) {
        throw new ToilError('INVALID_INPUT', `Connection "${input.name}" is ${withArticle(conn.area)} connection, not ${input.area}. Nothing was removed.`, {
          fix: `Run toil connections list --area ${input.area} to see its connections.`,
        });
      }
      delete file.connections[input.name];
      const shared = file.defaults[conn.area];
      if (shared?.connection === input.name) {
        delete shared.connection;
        if (Object.keys(shared).length === 0) delete file.defaults[conn.area];
      }
      writeConfigFile(path, file);
      const deleted: string[] = [];
      for (const value of Object.values(conn)) {
        if (isKeychainRef(value) && (await deleteUnreferenced(file, value, secrets, ctx))) deleted.push(refName(value));
      }
      return { name: input.name, area: conn.area, configFile: slashes(path), deletedFromStore: deleted };
    },
  });

  const test = defineConfigCommand({
    path: ['connections', 'test'],
    description: "Check one connection: resolve its settings and secret, then send the area's one cheap authenticated read",
    toolDescription:
      "Checks one toil connection: resolves its settings and reads its secret, then sends the area's one cheap authenticated GET (Jira's /rest/api/2/myself, for example). Fails with the same AUTH, NETWORK, CONFIG_INVALID or NOT_CONFIGURED error a real command would. `authenticated` says whether that read needs the credential, so a success also proves the credential works. `live` is false, with a warning, for an area toil has no such check for: then nothing was sent. Tests one connection per call; call it once per connection to test several.",
    input: z.object({
      name: z.string().describe('Connection name'),
    }),
    writes: false,
    writesLocal: false,
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    examples: [{ name: 'jira' }],
    run: async (input, ctx) => {
      const { config, secrets } = access(ctx);
      const settings = config.connections[input.name];
      if (!settings) throw new ToilError('INVALID_INPUT', `There's no connection named "${input.name}".`, { fix: 'Run toil connections list to see the names.' });
      const area = areaNamed(settings.area);
      // The same resolution every area command gets: defaults, env, the store, pairing and validation.
      const connection = await resolveConnection(config, area, input.name, ctx.warn, secrets, ctx.signal);
      const host = hostOf(connection, new Set(area.secrets));
      const probe = area.request ? area.probe?.(connection) : undefined;
      if (!probe) {
        ctx.warn({
          code: 'NOT_LIVE_TESTED',
          message: `toil has no live check for ${area.name} connections${area.probe ? ' set up like this one' : ''}, so nothing was sent. The settings are complete and the secret was read.`,
        });
        return { name: input.name, area: area.name, host, live: false, authenticated: false, request: null };
      }
      // JSON through core unless the area declares a text answer: a sign-in page served with a 200 is
      // the same HTTP error here that a real command would get, never a healthy connection.
      const body = await apiRequest(area, { fetch: ctx.fetch, signal: ctx.signal, connection }, probe.path, { as: probe.as ?? 'json', ...(probe.query ? { query: probe.query } : {}) });
      if (probe.accepts && !probe.accepts(body)) {
        throw new ToilError('AUTH', `${area.name} answered GET ${probe.path} for connection "${input.name}" as an anonymous user, so its credential wasn't accepted.`, {
          fix: `Run toil connections login ${input.name} with a new credential, or replace the one its env var sets.`,
        });
      }
      if (probe.authenticated === false) {
        ctx.warn({ code: 'NOT_AUTHENTICATED', message: `${area.name} has no cheap read that needs the credential, so this test shows the host answers, not that the credential works.` });
      }
      return { name: input.name, area: area.name, host, live: true, authenticated: probe.authenticated !== false, request: `GET ${probe.path}` };
    },
  });

  const writes = defineConfigCommand({
    path: ['connections', 'writes'],
    description: 'Turn writes on or off for a connection; turning them on asks you to type its name',
    input: z.object({
      name: z.string().describe('Connection name'),
      state: z.enum(['on', 'off']).describe('on or off'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [
      { name: 'name', field: 'name', description: 'Connection name' },
      { name: 'state', field: 'state', description: 'on or off' },
    ],
    examples: [{ name: 'corp-jira', state: 'off' }],
    run: async (input, ctx) => {
      const { config, prompt } = access(ctx);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const conn = fileConnection(file, input.name, config);
      const on = input.state === 'on';
      const was = connectionWrites(conn);
      if (on && !was) {
        // A standing permission is granted by a person at a keyboard, never by a
        // script or an agent: there is no flag that skips this question.
        if (!prompt) {
          throw new ToilError('INVALID_INPUT', 'Turning writes on asks you to type the connection name on a terminal, and this isn\'t one.', {
            fix: `Run it in a terminal, or set "writes": true on connection "${input.name}" in ${slashes(path)} yourself (${connectionEnvName(input.name, 'writes')}=true for one process).`,
          });
        }
        const typed = await prompt.ask(`Writes let commands change data in ${conn.area} through "${input.name}" when a call also passes --allow-write. Type ${input.name} to turn them on`, undefined, 'confirm-name');
        if (typed !== input.name) throw new ToilError('CANCELLED', `Writes stay off for "${input.name}": what was typed didn't match the name.`, { fix: `Run toil connections writes ${input.name} on again.` });
      }
      if (on !== was) {
        if (on) conn.writes = true;
        else delete conn.writes;
        writeConfigFile(path, file);
      }
      // An env var outranks the file (Configuration Precedence), so say when this change won't be what applies.
      const fromEnv = config.sources[`${input.name}.writes`] === 'env';
      if (fromEnv) ctx.warn({ code: 'OVERRIDDEN_BY_ENV', message: `An env var sets writes for "${input.name}" and wins over the file; unset ${connectionEnvName(input.name, 'writes')} for this change to apply.` });
      return { name: input.name, area: conn.area, writes: on, changed: on !== was, configFile: slashes(path) };
    },
  });

  const setDefault = defineConfigCommand({
    path: ['connections', 'default'],
    description: "Make a connection its area's default, the one used when a call names none",
    input: z.object({
      name: z.string().describe('Connection name'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    examples: [{ name: 'corp-jira' }],
    run: async (input, ctx) => {
      const { config } = access(ctx);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const conn = fileConnection(file, input.name, config);
      areaNamed(conn.area);
      const previous = typeof file.defaults[conn.area]?.connection === 'string' ? (file.defaults[conn.area]!.connection as string) : null;
      if (previous !== input.name) {
        file.defaults[conn.area] = { ...(file.defaults[conn.area] ?? {}), connection: input.name };
        writeConfigFile(path, file);
      }
      return { name: input.name, area: conn.area, previous, configFile: slashes(path) };
    },
  });

  return [add, login, list, remove, test, writes, setDefault];
}

function access(ctx: CommandContext<unknown>): ConfigAccess {
  if (!ctx.manage) throw new Error('A connections command ran without ctx.manage; define it with defineConfigCommand.');
  return ctx.manage;
}

function checkName(name: string): void {
  if (!CONNECTION_NAME.test(name)) {
    throw new ToilError('INVALID_INPUT', `"${name}" isn't a valid connection name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. corp-jira.' });
  }
}

/** The connection as written in the file; one defined only by env vars can't be edited here. */
function fileConnection(file: EditableConfig, name: string, config: ConfigAccess['config']) {
  const conn = file.connections[name];
  if (conn) return conn;
  if (config.connections[name]) {
    throw new ToilError('INVALID_INPUT', `Connection "${name}" is defined by env vars, not your config file, so there's nothing here to change.`, {
      fix: `Change the TOIL_CONN_${name.toUpperCase().replace(/-/g, '_')}_* variables instead.`,
    });
  }
  throw new ToilError('INVALID_INPUT', `There's no connection named "${name}" in ${slashes(config.files.global)}.`, { fix: 'Run toil connections list to see the names.' });
}

/**
 * The connections the config file holds. A file the edit commands would
 * refuse to rewrite (a version 1 file with keys version 1 ignored) still
 * loaded, so it falls back to the connections with a value read from it.
 */
function fileConnectionNames(config: ConfigAccess['config']): Set<string> {
  try {
    return new Set(Object.keys(readConfigForEdit(config.files.global).connections));
  } catch {
    return new Set(Object.keys(config.connections).filter((name) => Object.keys(config.connections[name]!).some((key) => config.sources[`${name}.${key}`] === 'global')));
  }
}

/** Without a terminal the commands can't ask, so they say how to do the same with env vars. */
function needsTerminal(command: string, name: string, area: AnyArea | undefined): ToilError {
  const keys = area ? Object.keys(area.connection.shape) : ['<key>'];
  const vars = [`${connectionEnvName(name, 'area')}=${area?.name ?? '<area>'}`, ...keys.map((k) => connectionEnvName(name, k))];
  return new ToilError('INVALID_INPUT', `toil connections ${command} asks its questions on a terminal, and this isn't one.`, {
    fix: `Run it in a terminal, or define the connection with env vars instead: ${vars.join(', ')}.`,
  });
}

function label(area: AnyArea, key: string): string {
  const description = (area.connection.shape as Record<string, z.ZodType>)[key]?.description;
  return description ? `${key} (${description})` : key;
}

/** A password is asked for as one, so nobody pastes a token where a database expects their password. */
function secretLabel(area: AnyArea, key: string): string {
  return area.secretKinds[key] === 'password' ? `${label(area, key)} [password]` : label(area, key);
}

/**
 * Asks for every setting the area declares, defaults from defineArea shown
 * and kept on an empty answer, then for its secrets without echo. Only the
 * secrets the area declares are asked for: an area that signs in with a token
 * is never asked for a username and password.
 */
async function askSettings(prompt: Prompter, area: AnyArea): Promise<{ settings: Settings; secretValues: Record<string, string> }> {
  const shape = area.connection.shape as Record<string, z.ZodType>;
  const secretKeys: string[] = area.secrets ?? [];
  const keys = Object.keys(shape)
    .filter((k) => !secretKeys.includes(k))
    .sort((a, b) => Number(b === 'baseUrl') - Number(a === 'baseUrl'));
  const settings: Settings = {};
  for (const key of keys) {
    const fallback = area.defaults?.[key] === undefined ? undefined : String(area.defaults[key]);
    const answer = await prompt.ask(label(area, key), fallback, `setting:${key}`);
    // An answer equal to the provider default isn't written, so the default can still change.
    if (answer !== '' && answer !== fallback) settings[key] = coerce(shape[key]!, answer);
  }
  const secretValues: Record<string, string> = {};
  for (const key of secretKeys) {
    const value = await prompt.askSecret(secretLabel(area, key), `secret:${key}`);
    if (value !== '') secretValues[key] = value;
  }
  return { settings, secretValues };
}

function required(secrets: SecretStore | undefined, ref: string): SecretStore {
  if (secrets) return secrets;
  const [connection, key] = ref.split('.');
  throw new ToilError('CREDENTIAL_STORE', 'No OS credential store is available here.', {
    fix: `Set ${connectionEnvName(connection!, key!)} instead: without a credential store, secrets come from env vars.`,
  });
}

/**
 * Stores each new secret and returns the references for config. If one fails,
 * the ones already stored are removed again: config was never written, so
 * nothing refers to them.
 */
async function storeNew(secrets: SecretStore | undefined, name: string, values: Record<string, string>, signal: AbortSignal): Promise<Settings> {
  const kept: Settings = {};
  const stored: string[] = [];
  try {
    for (const [key, value] of Object.entries(values)) {
      const ref = refFor(name, key);
      await storeVerified(required(secrets, ref), ref, value, signal);
      stored.push(ref);
      kept[key] = `${KEYCHAIN_PREFIX}${ref}`;
    }
  } catch (err) {
    for (const ref of stored) {
      try {
        await secrets?.delete(ref);
      } catch {
        // Best effort: the error being thrown is the one worth reporting.
      }
    }
    throw err;
  }
  return kept;
}

/** Deletes a store entry once nothing in config refers to it. Returns whether it deleted one. */
async function deleteUnreferenced(file: EditableConfig, value: string, secrets: SecretStore | undefined, ctx: CommandContext<unknown>): Promise<boolean> {
  const stillUsed = [...Object.values(file.connections), ...Object.values(file.defaults)].some((s) => Object.values(s).includes(value));
  if (stillUsed) return false;
  try {
    if (!secrets) throw new Error('no OS credential store is available here');
    return await secrets.delete(refName(value), ctx.signal);
  } catch (err) {
    ctx.warn({ code: 'CREDENTIAL_STORE_LEFTOVER', message: `Config no longer uses ${value}, but it couldn't be deleted from the OS credential store: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}

function whereKept(values: Settings): Record<string, 'store' | 'file'> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isKeychainRef(v) ? 'store' : 'file']));
}

/** The host from `baseUrl`, or a `host` setting; never anything an area calls a secret. */
function hostOf(conn: Settings, secretKeys: Set<string>): string | null {
  if (typeof conn.baseUrl === 'string' && !secretKeys.has('baseUrl')) {
    try {
      return new URL(conn.baseUrl).host;
    } catch {
      return null;
    }
  }
  return typeof conn.host === 'string' && !secretKeys.has('host') && !isKeychainRef(conn.host) ? conn.host : null;
}

const slashes = (path: string) => path.replace(/\\/g, '/');
