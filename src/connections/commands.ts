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
import { coerce } from '../core/connection.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { isKeychainRef, KEYCHAIN_PREFIX, refFor, refName, storeVerified, type SecretStore } from '../core/keychain.js';
import type { Prompter } from '../core/prompt.js';

/**
 * `toil connections add | login | list | remove`: setting up the connections
 * that every area command resolves. Secrets go straight to the OS credential
 * store and config holds only a `keychain:` reference, unless the user asks
 * for --plaintext. `add`, `login` and `remove` are CLI only: a person sets up
 * connections, never an agent over MCP. `list` is safe anywhere, because it
 * prints names, hosts and where each value came from, never a value that
 * could be a secret.
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
      plaintext: z.boolean().optional().describe('Keep the secret in the config file instead of the OS credential store'),
    }),
    writes: false,
    cliOnly: true,
    args: [{ name: 'name', field: 'name', description: 'Connection name, e.g. corp-jira' }],
    options: [
      { flags: '--area <area>', field: 'area', description: 'The area it connects to (asked for when left out)' },
      { flags: '--plaintext', field: 'plaintext', description: 'Keep the secret in the config file, not the OS credential store' },
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
      const area = areaNamed(input.area ?? (await prompt.ask(`Area (${areas.map((a) => a.name).join(', ')})`, areas.length === 1 ? areas[0]!.name : undefined)));

      const { settings, secretValues } = await askSettings(prompt, area);
      const parsed = (area.connection as z.ZodObject).safeParse({ ...(area.defaults ?? {}), ...settings, ...secretValues });
      if (!parsed.success) {
        const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))];
        throw new ToilError('INVALID_INPUT', `Those settings aren't a valid ${area.name} connection: check ${keys.join(', ')}. Nothing was saved.`, {
          fix: `Run toil connections add ${input.name} again.`,
          details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const kept = input.plaintext ? { ...secretValues } : await storeNew(secrets, input.name, secretValues, ctx.signal);
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
      plaintext: z.boolean().optional().describe('Keep the secret in the config file instead of the OS credential store'),
    }),
    writes: false,
    cliOnly: true,
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    options: [{ flags: '--plaintext', field: 'plaintext', description: 'Keep the secret in the config file, not the OS credential store' }],
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
        const value = await prompt.askSecret(label(area, key));
        if (value !== '') entered[key] = value;
      }
      if (Object.keys(entered).length === 0) throw new ToilError('INVALID_INPUT', 'Nothing was entered, so nothing changed.', { fix: `Run toil connections login ${input.name} again.` });

      const before: Settings = { ...conn };
      for (const [key, value] of Object.entries(entered)) {
        if (input.plaintext) {
          conn[key] = value;
        } else {
          const ref = refFor(input.name, key);
          await storeVerified(required(secrets, ref), ref, value, ctx.signal);
          conn[key] = `${KEYCHAIN_PREFIX}${ref}`;
        }
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
      "Lists every toil connection: its name, area, whether it's the area's default, its host, whether writes are on, and where each setting came from (env, ci, file, store or defaults). Never returns a secret or any setting's value other than the host. Use it to find the connection name to pass as `connection` to another tool.",
    input: z.object({}),
    writes: false,
    examples: [{}],
    run: async (_input, ctx) => {
      const { config } = access(ctx);
      const connections = Object.keys(config.connections)
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
          };
        });
      return { configFile: slashes(config.files.global), connections };
    },
  });

  const remove = defineConfigCommand({
    path: ['connections', 'remove'],
    description: 'Remove a connection from config, and its secrets from the OS credential store',
    input: z.object({ name: z.string().describe('Connection name') }),
    writes: false,
    cliOnly: true,
    args: [{ name: 'name', field: 'name', description: 'Connection name' }],
    examples: [{ name: 'corp-jira' }],
    run: async (input, ctx) => {
      const { config, secrets } = access(ctx);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const conn = fileConnection(file, input.name, config);
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

  return [add, login, list, remove];
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
    const answer = await prompt.ask(label(area, key), fallback);
    // An answer equal to the provider default isn't written, so the default can still change.
    if (answer !== '' && answer !== fallback) settings[key] = coerce(shape[key]!, answer);
  }
  const secretValues: Record<string, string> = {};
  for (const key of secretKeys) {
    const value = await prompt.askSecret(label(area, key));
    if (value !== '') secretValues[key] = value;
  }
  return { settings, secretValues };
}

function required(secrets: SecretStore | undefined, ref: string): SecretStore {
  if (secrets) return secrets;
  const [connection, key] = ref.split('.');
  throw new ToilError('CREDENTIAL_STORE', 'No OS credential store is available here.', {
    fix: `Set ${connectionEnvName(connection!, key!)} instead, or pass --plaintext to keep the secret in your toil config file.`,
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
