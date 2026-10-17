import type { z } from 'zod';
import type { AnyArea, Connection } from './area.js';
import type { SharedSettings } from './command.js';
import { connectionEnvName, connectionsOf, connectionWrites, defaultConnectionName, envName, type ResolvedConfig, type Settings } from './config.js';
import type { ContextReport, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import { isKeychainRef, refName, type SecretStore } from './keychain.js';
import { fromText } from './schema.js';

export interface ResolveOptions {
  /** Settings to take from another area's default connection when this one lacks them. */
  shares?: SharedSettings | undefined;
  /** Filled with each setting that was taken from the other area. */
  shared?: NonNullable<ContextReport['shared']>;
}

/**
 * Picks the one connection a call uses and turns it into what the command
 * sees: provider defaults, then `defaults.<area>`, then the connection's own
 * settings (already overlaid with env vars), renamed keys mapped, env strings
 * coerced to the schema's types, and the whole validated against the area's
 * schema. A command never sees a half-configured connection; it gets a
 * CONFIG_INVALID or NOT_CONFIGURED envelope that names the variable to set.
 * A rejected form should at least say which box was left blank.
 */
export async function resolveConnection(
  config: ResolvedConfig,
  area: AnyArea,
  requested: string | undefined,
  warn: (w: Warning) => void,
  secrets?: Pick<SecretStore, 'get'>,
  signal?: AbortSignal,
  options: ResolveOptions = {},
): Promise<Connection> {
  const name = requested ?? defaultConnectionName(config, area.name);
  if (!name) {
    const candidates = connectionsOf(config, area.name);
    if (candidates.length === 0) {
      const required = requiredKeys(area.connection);
      throw new ToilError('NOT_CONFIGURED', `No ${area.name} connection is set up.`, {
        fix: required.length
          ? `Set ${required.map((k) => envName(area.name, k)).join(' and ')}, or add a ${area.name} connection to your toil config.`
          : `Add a ${area.name} connection to your toil config.`,
      });
    }
    // Several candidates and no default: ask. Picking one would be quicker, and
    // is how requests end up in the wrong department's queue.
    throw new ToilError('INVALID_INPUT', `${area.name} has several connections (${candidates.join(', ')}) and no default.`, {
      fix: `Pass --connection <name>, or set "defaults": { "${area.name}": { "connection": "<name>" } } in your toil config.`,
    });
  }

  const stored = config.connections[name];
  if (!stored) {
    const known = connectionsOf(config, area.name);
    throw new ToilError('INVALID_INPUT', `There's no connection named "${name}".`, {
      fix: known.length ? `Use one of the ${area.name} connections: ${known.join(', ')}.` : `Add a ${area.name} connection named "${name}" to your toil config.`,
    });
  }
  if (stored.area !== area.name) {
    throw new ToilError('INVALID_INPUT', `Connection "${name}" is a ${stored.area} connection, not ${area.name}.`, {
      fix: `Use a ${area.name} connection: ${connectionsOf(config, area.name).join(', ') || `(none set up yet)`}.`,
    });
  }

  const shared: Settings = { ...(config.defaults[area.name] ?? {}) };
  delete shared.connection;
  const own: Settings = { ...stored };
  delete own.area;
  delete own.writes;
  refusePlaintextSecrets(config, area, name, shared, own);
  const merged = renameKeys({ ...(area.defaults ?? {}), ...shared, ...own }, area, name, warn);
  await resolveSecrets(merged, area, name, secrets, warn, signal);
  if (options.shares) await takeShared(config, options.shares, area, name, own, shared, merged, { warn, secrets, signal, report: options.shared });

  const shape = area.connection.shape as Record<string, z.ZodType>;
  for (const key of Object.keys(merged)) {
    if (!(key in shape)) {
      warn({ code: 'CONFIG_UNKNOWN_KEY', message: `"${key}" on connection ${name} isn't a ${area.name} setting and was ignored.` });
      delete merged[key];
    } else {
      merged[key] = coerce(shape[key]!, merged[key]);
    }
  }

  const parsed = (area.connection as z.ZodObject).safeParse(merged);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))];
    const isDefault = defaultConnectionName(config, area.name) === name;
    const vars = keys.map((k) => (isDefault ? envName(area.name, k) : connectionEnvName(name, k)));
    throw new ToilError('CONFIG_INVALID', `Connection ${name} (${area.name}) is missing or has invalid ${keys.join(', ') || 'settings'}.`, {
      fix: vars.length ? `Set ${vars.join(' and ')}, or fix ${keys.join(', ')} on "${name}" in your toil config.` : `Fix connection "${name}" in your toil config.`,
      details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return { ...(parsed.data as Record<string, unknown>), name, area: area.name, writes: connectionWrites(stored) };
}

/**
 * A secret in a config file must be a `keychain:` reference: config holds
 * nothing worth stealing, so a command that can read files can't leak a token
 * by reading it. Env-var values are exempt, since they never sit in a file.
 * Checked here because this is the first point where the area's `secrets` are
 * known; the loader doesn't know area schemas. The value is never echoed.
 * A password on a sticky note is still a password, whatever the note says.
 */
function refusePlaintextSecrets(config: ResolvedConfig, area: AnyArea, name: string, shared: Settings, own: Settings): void {
  const secretKeys = new Set<string>(area.secrets ?? []);
  const isSecret = (key: string) => secretKeys.has(key) || secretKeys.has((area.renamed ?? {})[key] ?? '');
  const inFile = (key: string, value: unknown, source: string | undefined) =>
    isSecret(key) && value !== undefined && !isKeychainRef(value) && source !== 'env' && source !== 'ci';
  const found = [
    ...Object.entries(own).filter(([key, value]) => inFile(key, value, config.sources[`${name}.${key}`])).map(([key]) => key),
    ...Object.entries(shared).filter(([key, value]) => !(key in own) && inFile(key, value, undefined)).map(([key]) => key),
  ];
  if (found.length === 0) return;
  const isDefault = defaultConnectionName(config, area.name) === name;
  const vars = found.flatMap((key) => [connectionEnvName(name, (area.renamed ?? {})[key] ?? key), ...(isDefault ? [envName(area.name, (area.renamed ?? {})[key] ?? key)] : [])]);
  throw new ToilError('CONFIG_INVALID', `Connection ${name} (${area.name}) has ${found.join(' and ')} in plain text in ${config.files.global}. toil keeps secrets only in the OS credential store or in env vars.`, {
    fix: `Run toil connections login ${name} to move it into the OS credential store, or set ${vars.join(' or ')} instead, then remove the value from the file.`,
  });
}

/**
 * Swaps each `keychain:<ref>` on a secret key for the secret it names. An env
 * var already replaced the stored value before this runs, so env still wins
 * and the store isn't asked about a key nobody will read. A reference that
 * can't be resolved becomes unset, never the literal string: the schema then
 * reports the key as missing, with the variable to set, and nothing is sent.
 * Saying "see attached" with nothing attached is a tradition we decline to join.
 */
async function resolveSecrets(
  settings: Settings,
  area: AnyArea,
  name: string,
  secrets: Pick<SecretStore, 'get'> | undefined,
  warn: (w: Warning) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const key of area.secrets ?? []) {
    const value = settings[key];
    if (!isKeychainRef(value)) continue;
    let secret: string | undefined;
    let reason = 'there is no such entry in the OS credential store';
    try {
      secret = secrets ? await secrets.get(refName(value), signal) : undefined;
      if (!secrets) reason = 'no OS credential store is available here';
    } catch (err) {
      // Cancelled or timed out: execute() reports that, not a missing secret.
      if (signal?.aborted) throw signal.reason;
      reason = err instanceof Error ? err.message : String(err);
    }
    if (secret === undefined) {
      delete settings[key];
      warn({
        code: 'CONFIG_SECRET_UNRESOLVED',
        message: `${key} on connection ${name} is ${value}, which couldn't be read (${reason}). Run toil connections login ${name}, or set ${connectionEnvName(name, key)}.`,
      });
    } else {
      settings[key] = secret;
    }
  }
}

function renameKeys(settings: Settings, area: AnyArea, name: string, warn: (w: Warning) => void): Settings {
  for (const [from, to] of Object.entries(area.renamed ?? {})) {
    if (!(from in settings)) continue;
    if (!(to in settings)) settings[to] = settings[from];
    delete settings[from];
    warn({ code: 'CONFIG_RENAMED_KEY', message: `"${from}" on connection ${name} is now "${to}". The old name still works for now.` });
  }
  return settings;
}

/**
 * Env vars are strings; a port of "5432" should still be a number, "true" a
 * boolean, and a list setting (jira's customFields) JSON. The same reading
 * argv gets (`fromText`), so a value means one thing wherever it is typed.
 */
export const coerce = fromText;

/** How a value's source ranks for sharing: env first, then the file, then shared defaults, then nothing. */
function tier(source: string | undefined, present: boolean, fromDefaults: boolean): number {
  if (!present) return fromDefaults ? 2 : 3;
  return source === 'env' || source === 'ci' ? 0 : 1;
}

/**
 * Takes each shared key from the other area's default connection when that
 * value ranks above this connection's own: the env tier beats the file tier
 * across both areas, and within a tier this connection wins. So Kibana sends
 * TOIL_KIBANA_API_KEY, then TOIL_ELASTICSEARCH_API_KEY, then its own stored
 * key, then Elasticsearch's. The other connection is read for those keys only;
 * whether the rest of it is valid is none of this command's business. A
 * borrowed value is held to the same rules as an own one: no plaintext
 * secret in a file, and `keychain:` references resolved from the store.
 */
async function takeShared(
  config: ResolvedConfig,
  shares: SharedSettings,
  area: AnyArea,
  name: string,
  own: Settings,
  ownDefaults: Settings,
  merged: Settings,
  io: { warn: (w: Warning) => void; secrets: Pick<SecretStore, 'get'> | undefined; signal: AbortSignal | undefined; report: ResolveOptions['shared'] },
): Promise<void> {
  const other = shares.area;
  const otherName = defaultConnectionName(config, other.name);
  const otherStored = otherName ? config.connections[otherName] : undefined;
  if (!otherName || !otherStored || otherStored.area !== other.name) return;
  const otherDefaults: Settings = { ...(config.defaults[other.name] ?? {}) };
  delete otherDefaults.connection;
  for (const key of shares.keys) {
    const mine = tier(config.sources[`${name}.${key}`], own[key] !== undefined, ownDefaults[key] !== undefined);
    const theirs = tier(config.sources[`${otherName}.${key}`], otherStored[key] !== undefined, otherDefaults[key] !== undefined);
    if (theirs >= mine) continue;
    const taken: Settings = { [key]: otherStored[key] ?? otherDefaults[key] };
    refusePlaintextSecrets(config, other, otherName, otherStored[key] === undefined ? taken : {}, otherStored[key] === undefined ? {} : taken);
    await resolveSecrets(taken, other, otherName, io.secrets, io.warn, io.signal);
    if (taken[key] === undefined) continue;
    merged[key] = taken[key];
    if (io.report) io.report[key] = { area: other.name, connection: otherName };
  }
}

/**
 * The connection a context input's value picks (`--instance prod`): the area's
 * connection of that name, else the one whose `setting` equals the value.
 * None, or more than one, is INVALID_INPUT naming the candidates.
 */
export function selectConnection(config: ResolvedConfig, area: AnyArea, input: string, setting: string, value: string, flag: string): string {
  const names = connectionsOf(config, area.name);
  if (names.includes(value)) return value;
  const matches = names.filter((n) => config.connections[n]![setting] !== undefined && String(config.connections[n]![setting]) === value);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new ToilError('INVALID_INPUT', `No ${area.name} connection is named "${value}" or has ${setting} "${value}" (from ${input}).`, {
      fix: names.length ? `Pass ${flag} with one of: ${names.join(', ')}, or set ${setting} on the connection you mean.` : `Add a ${area.name} connection with ${setting} "${value}" to your toil config.`,
    });
  }
  throw new ToilError('INVALID_INPUT', `Several ${area.name} connections have ${setting} "${value}": ${matches.join(', ')}.`, {
    fix: `Pass --connection <name> to choose one of them.`,
  });
}

function requiredKeys(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>)
    .filter(([, s]) => !s.safeParse(undefined).success)
    .map(([k]) => k);
}
