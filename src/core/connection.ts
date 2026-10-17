import type { z } from 'zod';
import { pairingKey, type AnyArea, type Connection } from './area.js';
import { connectionEnvName, connectionsOf, connectionWrites, defaultConnectionName, envName, type ResolvedConfig, type Settings } from './config.js';
import type { ContextReport, ContextSource, Warning } from './envelope.js';
import { ToilError, withArticle } from './errors.js';
import { isKeychainRef, refName, type SecretStore } from './keychain.js';
import { fromText } from './schema.js';

export interface ResolveOptions {
  /** Filled with each setting taken from another area's connection (`defineArea({ shares })`). */
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
          ? `Set ${required.map((k) => defaultVar(area, k)).join(' and ')}, or add ${withArticle(area.name)} connection to your toil config.`
          : `Add ${withArticle(area.name)} connection to your toil config.`,
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
      fix: known.length ? `Use one of the ${area.name} connections: ${known.join(', ')}.` : `Add ${withArticle(area.name)} connection named "${name}" to your toil config.`,
    });
  }
  if (stored.area !== area.name) {
    throw new ToilError('INVALID_INPUT', `Connection "${name}" is ${withArticle(stored.area)} connection, not ${area.name}.`, {
      fix: `Use ${withArticle(area.name)} connection: ${connectionsOf(config, area.name).join(', ') || `(none set up yet)`}.`,
    });
  }

  const shared: Settings = { ...(config.defaults[area.name] ?? {}) };
  delete shared.connection;
  const own: Settings = { ...stored };
  delete own.area;
  delete own.writes;
  refusePlaintextSecrets(config, area, name, shared, own);
  // How each key's value ranks, so an old name set in a higher tier beats a new name set lower.
  const tier = (key: string): number => {
    const source = config.sources[`${name}.${key}`];
    // env (rules 1 and 2), then a CI fallback (rule 3), then the file, defaults.<area>, provider defaults.
    if (key in own) return source === 'env' ? 0 : source === 'ci' ? 1 : 2;
    return key in shared ? 3 : 4;
  };
  const merged = renameKeys({ ...(area.defaults ?? {}), ...shared, ...own }, area, name, warn, tier);
  await resolveSecrets(merged, area, name, secrets, warn, signal);
  if (area.shares) await takeShared(config, area, name, stored, merged, { warn, secrets, signal, report: options.shared });

  const shape = area.connection.shape as Record<string, z.ZodType>;
  for (const key of Object.keys(merged)) {
    if (!(key in shape)) {
      warn({ code: 'CONFIG_UNKNOWN_KEY', message: `"${key}" on connection ${name} isn't ${withArticle(area.name)} setting and was ignored.` });
      delete merged[key];
    } else {
      merged[key] = coerce(shape[key]!, merged[key]);
    }
  }

  const parsed = (area.connection as z.ZodObject).safeParse(merged);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))];
    const isDefault = defaultConnectionName(config, area.name) === name;
    const vars = keys.map((k) => (isDefault ? defaultVar(area, k) : withExample(area, k, connectionEnvName(name, k))));
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

/**
 * Old key names mapped onto new ones, with a warning. When both are set, the
 * value from the higher tier wins (an env var over a CI fallback, over the
 * connection in the file, over `defaults.<area>`, over provider defaults), so an old env var still
 * overrides a new name in the file (principle 5); on a tie the new name wins.
 */
function renameKeys(settings: Settings, area: AnyArea, name: string, warn: (w: Warning) => void, tier: (key: string) => number): Settings {
  for (const [from, to] of Object.entries(area.renamed ?? {})) {
    if (!(from in settings)) continue;
    if (!(to in settings) || tier(from) < tier(to)) settings[to] = settings[from];
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

/** Where a setting was found on one connection: its value and how its source ranks (env 0, the file 1). */
interface Found {
  value: unknown;
  rank: 0 | 1;
  /** For the report: env, ci, or where in the file. */
  source: 'env' | 'ci' | 'store' | 'file' | 'defaults';
}

/**
 * `key` on a connection as configured, under its current name or one it was
 * renamed from: the connection's own settings, then `defaults.<area>`.
 * Provider defaults don't count; they're what applies when nobody set anything.
 */
function findSetting(config: ResolvedConfig, area: AnyArea, name: string, stored: Settings, key: string): Found | undefined {
  const names = [key, ...Object.entries(area.renamed ?? {}).filter(([, to]) => to === key).map(([from]) => from)];
  for (const k of names) {
    if (stored[k] === undefined) continue;
    const tag = config.sources[`${name}.${k}`];
    if (tag === 'env' || tag === 'ci') return { value: stored[k], rank: 0, source: tag };
    return { value: stored[k], rank: 1, source: isKeychainRef(stored[k]) ? 'store' : 'file' };
  }
  const shared = config.defaults[area.name] ?? {};
  for (const k of names) if (shared[k] !== undefined) return { value: shared[k], rank: 1, source: isKeychainRef(shared[k]) ? 'store' : 'defaults' };
  return undefined;
}

/**
 * Takes each shared key from the connection the user paired this one with
 * (`"apiKeyFrom": "es-prod"`), when that value ranks above this connection's
 * own: the env tier beats the file tier across both, and within a tier this
 * connection wins. So a paired Kibana sends TOIL_KIBANA_API_KEY, then the
 * paired connection's env value, then its own stored key, then the paired
 * one's. With no pairing, only the area's default connection borrows, and
 * only the other area's default connection's env value: the old
 * TOIL_KIBANA_API_KEY then TOIL_ELASTICSEARCH_API_KEY chain. Nothing else
 * crosses between areas. The other connection is read for those keys only;
 * whether the rest of it is valid is none of this command's business. A
 * borrowed value is held to the same rules as an own one: no plaintext secret
 * in a file, and `keychain:` references resolved from the store.
 * Inter-departmental lending requires a signed form; we accept exactly one.
 */
async function takeShared(
  config: ResolvedConfig,
  area: AnyArea,
  name: string,
  stored: Settings,
  merged: Settings,
  io: { warn: (w: Warning) => void; secrets: Pick<SecretStore, 'get'> | undefined; signal: AbortSignal | undefined; report: ResolveOptions['shared'] },
): Promise<void> {
  const other = area.shares!.area;
  for (const key of area.shares!.keys) {
    const paired = merged[pairingKey(key)];
    let from: string | undefined;
    let via: 'pairing' | 'env-fallback';
    if (typeof paired === 'string') {
      from = paired;
      via = 'pairing';
      const target = config.connections[from];
      if (!target || target.area !== other.name) {
        const known = connectionsOf(config, other.name);
        throw new ToilError('CONFIG_INVALID', `Connection ${name} (${area.name}) takes ${key} from "${from}", which isn't ${withArticle(other.name)} connection.`, {
          fix: `Set ${pairingKey(key)} on "${name}" to one of the ${other.name} connections (${known.join(', ') || 'none set up yet'}), or remove it.`,
        });
      }
    } else if (defaultConnectionName(config, area.name) === name) {
      from = defaultConnectionName(config, other.name);
      via = 'env-fallback';
    } else {
      continue;
    }
    const target = from === undefined ? undefined : config.connections[from];
    if (from === undefined || !target || target.area !== other.name) continue;

    const mine = findSetting(config, area, name, stored, key);
    const theirs = findSetting(config, other, from, target, key);
    if (!theirs || (via === 'env-fallback' && theirs.rank !== 0)) continue;
    if (mine && mine.rank <= theirs.rank) continue;

    const taken: Settings = { [key]: theirs.value };
    if (theirs.rank === 1) refusePlaintextSecrets(config, other, from, taken, {});
    await resolveSecrets(taken, other, from, io.secrets, io.warn, io.signal);
    if (taken[key] === undefined) continue;
    merged[key] = taken[key];
    if (io.report) io.report[key] = { area: other.name, connection: from, source: theirs.source, via };
  }
}

/**
 * The connection a context input's value picks (`--instance prod`): the area's
 * connection of that name, else the one whose `setting` equals the value.
 * None, or more than one, is INVALID_INPUT naming the candidates.
 */
export function selectConnection(config: ResolvedConfig, area: AnyArea, input: string, setting: string, value: string, flag: string, source: ContextSource = 'input'): string {
  const where = { input: 'the call', file: 'the input file', dossier: 'your dossier', git: 'the git remote', connection: 'the connection', default: "the area's default" }[source];
  const instead = source === 'input' ? '' : `, or correct ${where}`;
  const names = connectionsOf(config, area.name);
  if (names.includes(value)) return value;
  const matches = names.filter((n) => config.connections[n]![setting] !== undefined && String(config.connections[n]![setting]) === value);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    // Loud, and with the whole list: guessing the nearest environment is how
    // a change meant for staging gets filed against production.
    const known = names.map((n) => (config.connections[n]![setting] === undefined ? n : `${String(config.connections[n]![setting])} (connection ${n})`));
    throw new ToilError('INVALID_INPUT', `${area.name} has no ${input} "${value}" (from ${where}). It knows: ${known.join(', ') || 'none'}.`, {
      fix: names.length
        ? `Pass ${flag} with one of those, or --connection <name>${instead}; or set ${setting} on the connection you mean.`
        : `Add ${withArticle(area.name)} connection with ${setting} "${value}" to your toil config${instead}.`,
    });
  }
  throw new ToilError('INVALID_INPUT', `Several ${area.name} connections have ${setting} "${value}" (from ${where}): ${matches.join(', ')}.`, {
    fix: `Pass --connection <name> to choose one of them.`,
  });
}

/**
 * The variable that sets `key` on the area's default connection, with any CI
 * fallback the area declares beside it: `TOIL_SONAR_TOKEN (or SONAR_TOKEN)`.
 * The fallbacks apply only to the default connection, so only it names them.
 */
function defaultVar(area: AnyArea, key: string): string {
  const fallbacks = (area.fallbacks as Record<string, string[] | undefined> | undefined)?.[key] ?? [];
  return withExample(area, key, fallbacks.length ? `${envName(area.name, key)} (or ${fallbacks.join(' or ')})` : envName(area.name, key));
}

/** `TOIL_FIGMA_BASE_URL` -> `TOIL_FIGMA_BASE_URL (e.g. https://api.figma.com)`, where the area declares an example for the key. */
function withExample(area: AnyArea, key: string, variable: string): string {
  const example = (area.examples as Record<string, string | undefined> | undefined)?.[key];
  return example === undefined ? variable : `${variable} (e.g. ${example})`;
}

function requiredKeys(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>)
    .filter(([, s]) => !s.safeParse(undefined).success)
    .map(([k]) => k);
}
