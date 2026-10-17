import type { z } from 'zod';
import type { AnyArea, Connection } from './area.js';
import { connectionEnvName, connectionsOf, connectionWrites, defaultConnectionName, envName, type ResolvedConfig, type Settings } from './config.js';
import type { Warning } from './envelope.js';
import { ToilError } from './errors.js';

/**
 * Picks the one connection a call uses and turns it into what the command
 * sees: provider defaults, then `defaults.<area>`, then the connection's own
 * settings (already overlaid with env vars), renamed keys mapped, env strings
 * coerced to the schema's types, and the whole validated against the area's
 * schema. A command never sees a half-configured connection; it gets a
 * CONFIG_INVALID or NOT_CONFIGURED envelope that names the variable to set.
 * A rejected form should at least say which box was left blank.
 */
export function resolveConnection(config: ResolvedConfig, area: AnyArea, requested: string | undefined, warn: (w: Warning) => void): Connection {
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
  const merged = renameKeys({ ...(area.defaults ?? {}), ...shared, ...own }, area, name, warn);

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

function renameKeys(settings: Settings, area: AnyArea, name: string, warn: (w: Warning) => void): Settings {
  for (const [from, to] of Object.entries(area.renamed ?? {})) {
    if (!(from in settings)) continue;
    if (!(to in settings)) settings[to] = settings[from];
    delete settings[from];
    warn({ code: 'CONFIG_RENAMED_KEY', message: `"${from}" on connection ${name} is now "${to}". The old name still works for now.` });
  }
  return settings;
}

/** The schema type under optional/default/nullable wrappers. */
function baseType(schema: z.ZodType): string {
  let def = (schema as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
  while ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable' || def.type === 'prefault') && def.innerType) {
    def = (def.innerType as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
  }
  return def.type;
}

/** Env vars are strings; a port of "5432" should still be a number, and "true" a boolean. */
function coerce(schema: z.ZodType, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const type = baseType(schema);
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

function requiredKeys(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>)
    .filter(([, s]) => !s.safeParse(undefined).success)
    .map(([k]) => k);
}
