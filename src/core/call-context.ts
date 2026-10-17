import { z } from 'zod';
import type { AnyArea, Connection, ContextInput } from './area.js';
import { commandName, type AnyCommand } from './command.js';
import { connectionEnvName, defaultConnectionName, envName, type ResolvedConfig } from './config.js';
import { resolveConnection, selectConnection } from './connection.js';
import type { ContextReport, ContextSource, ContextValue, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import type { SecretStore } from './keychain.js';

/**
 * Where a command acts, worked out once for every area. Each context input
 * (`--project`, `--repo`, `--instance`) resolves in this order:
 *
 *   1. the call's own value: a CLI flag or an MCP field
 *   2. the dossier (#16; until then, nothing)
 *   3. the working folder's git remote, where the area declares how to read it
 *   4. the connection's setting, then the area's default
 *
 * The connection goes through the same chain: at each source in turn (the
 * call, the dossier, the git remote), `connection` itself or an input that
 * selects one (`--instance prod`), and the two must agree; with neither, the
 * area's default connection. A selecting value from a lower source than the
 * one that picked the connection gives way to that connection's own setting.
 * The result lands on `ctx.context` and, with each value's source, in
 * `meta.context`. Four sources, one order, no committee.
 *
 * The git step runs only where a reader is supplied (`Context.gitRemote`);
 * none is wired into the shipped CLI yet. The dossier step is empty until #16.
 */

/** A git remote as the reader hands it over: the area parses the URL. */
export interface GitRemote {
  name: string;
  url: string;
}

/** Reads the working folder's `origin` remote, or undefined outside a repository. Supplied by the git reader, faked in tests. */
export type GitRemoteReader = (signal: AbortSignal) => Promise<GitRemote | undefined>;

/**
 * A dossier's value for one area's key (`connection`, or a context input).
 * This is the seam #16 fills; today nothing supplies one, so the step is
 * always empty.
 */
export type DossierLookup = (area: string, key: string) => string | undefined;

export const noDossier: DossierLookup = () => undefined;

export interface CallSources {
  config: ResolvedConfig;
  secrets?: Pick<SecretStore, 'get'> | undefined;
  dossier?: DossierLookup | undefined;
  gitRemote?: GitRemoteReader | undefined;
}

export interface ResolvedCall {
  connection: Connection;
  context: Record<string, string>;
  report: ContextReport;
}

/**
 * `report` is filled as resolution goes, so a failure part-way (a required
 * input nobody supplied) still says which connection the call had chosen.
 */
export async function resolveCall(
  def: AnyCommand,
  input: Record<string, unknown>,
  sources: CallSources,
  warn: (w: Warning) => void,
  signal: AbortSignal,
  report: ContextReport = {},
): Promise<ResolvedCall> {
  const area = def.area!;
  const declared = area.context as Record<string, ContextInput>;
  const needs = def.context ?? {};
  const dossier = sources.dossier ?? noDossier;

  let remote: Promise<GitRemote | undefined> | undefined;
  const fromGit = (spec: ContextInput): Promise<string | undefined> => {
    if (!spec.git || !sources.gitRemote) return Promise.resolve(undefined);
    remote ??= sources.gitRemote(signal);
    return remote.then((r) => (r ? spec.git!(r) : undefined));
  };

  // Steps 1 to 3, which don't need the connection, so a selecting input can pick it.
  const early: Record<string, ContextValue> = {};
  for (const name of Object.keys(needs)) {
    const spec = declared[name]!;
    const explicit = input[name];
    if (typeof explicit === 'string') {
      early[name] = { value: explicit, source: 'input' };
      continue;
    }
    const found = checked(area, name, spec, dossier(area.name, name), 'dossier') ?? checked(area, name, spec, await fromGit(spec), 'git');
    if (found) early[name] = found;
  }

  const chosen = chooseConnection(sources.config, area, def, input, early, dossier);
  const shared: NonNullable<ContextReport['shared']> = {};
  const connection = await resolveConnection(sources.config, area, chosen?.value, warn, sources.secrets, signal, { shared });
  report.connection = chosen ? { value: connection.name, source: chosen.source, ...(chosen.via ? { via: chosen.via } : {}) } : { value: connection.name, source: 'default', default: defaultKind(sources.config, area, connection.name) };
  if (Object.keys(shared).length > 0) report.shared = shared;

  // A selecting value that lost to a higher source (an explicit --connection
  // over a dossier's env) mustn't describe a different connection than the
  // one in use: it gives way to that connection's own setting.
  for (const [name, found] of Object.entries(early)) {
    const spec = declared[name]!;
    if (!spec.selectsConnection || found.source === 'input') continue;
    let selects: string | undefined;
    try {
      selects = selectConnection(sources.config, area, name, spec.setting ?? name, found.value, flagOf(name, spec), found.source);
    } catch {
      selects = undefined;
    }
    if (selects !== connection.name) delete early[name];
  }

  // Step 4, from the connection this call resolved.
  const inputs: Record<string, ContextValue> = {};
  const missing: string[] = [];
  for (const [name, need] of Object.entries(needs)) {
    const spec = declared[name]!;
    const setting = spec.setting === undefined ? undefined : connection[spec.setting];
    const value =
      early[name] ??
      checked(area, name, spec, setting === undefined || setting === null ? undefined : String(setting), 'connection') ??
      checked(area, name, spec, spec.default, 'default');
    if (value) inputs[name] = value;
    else if (need === 'required') missing.push(name);
  }
  if (Object.keys(inputs).length > 0) report.inputs = inputs;
  if (missing.length > 0) throw missingContext(sources.config, def, area, connection.name, missing);
  return { connection, context: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value])), report };
}

/** How the area's default connection was found: named in `defaults`, named after the area, or the only one. */
function defaultKind(config: ResolvedConfig, area: AnyArea, name: string): 'named' | 'area-name' | 'only' {
  if (typeof config.defaults[area.name]?.connection === 'string') return 'named';
  return name === area.name ? 'area-name' : 'only';
}

/** `connection` through the chain. An explicit `--connection` that contradicts an explicit selecting input is refused. */
function chooseConnection(
  config: ResolvedConfig,
  area: AnyArea,
  def: AnyCommand,
  input: Record<string, unknown>,
  early: Record<string, ContextValue>,
  dossier: DossierLookup,
): ContextValue | undefined {
  const declared = area.context as Record<string, ContextInput>;
  const named: Partial<Record<ContextSource, string>> = {
    input: typeof input.connection === 'string' ? input.connection : undefined,
    dossier: dossier(area.name, 'connection'),
  };
  // Source by source: at each step, a connection named outright and one an
  // input selects must agree, and the first step with either decides.
  for (const source of ['input', 'dossier', 'git'] as const) {
    let pick: ContextValue | undefined = named[source] === undefined ? undefined : { value: named[source]!, source };
    for (const [name, found] of Object.entries(early)) {
      const spec = declared[name]!;
      if (!spec.selectsConnection || found.source !== source) continue;
      const selected = selectConnection(config, area, name, spec.setting ?? name, found.value, flagOf(name, spec), found.source);
      if (pick && pick.value !== selected) {
        const was = pick.via ? `${flagOf(pick.via, declared[pick.via]!).split(' ')[0]}, which selects ${pick.value}` : `connection ${pick.value}`;
        throw new ToilError('INVALID_INPUT', `${commandName(def)} got ${was}, and ${flagOf(name, spec).split(' ')[0]} ${found.value}, which selects connection ${selected} (both from the ${source}).`, {
          fix: 'Give only one of them, or make them agree.',
        });
      }
      pick ??= { value: selected, source, via: name };
    }
    if (pick) return pick;
  }
  return undefined;
}

/** A value from a source other than the call, validated as the input's schema says; INVALID_INPUT names where it came from. */
function checked(area: AnyArea, name: string, spec: ContextInput, value: string | undefined, source: ContextSource): ContextValue | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = (spec.schema ?? z.string().min(1)).safeParse(value);
  if (!parsed.success) {
    const where = { input: 'the call', dossier: 'the dossier', git: 'the git remote', connection: `the connection's ${spec.setting} setting`, default: "the area's default" }[source];
    throw new ToilError('INVALID_INPUT', `${area.name} ${name} "${value}" from ${where} isn't valid: ${parsed.error.issues.map((i) => i.message).join('; ')}.`, {
      fix: `Pass ${flagOf(name, spec).split(' ')[0]} explicitly, or correct ${where}.`,
    });
  }
  return { value: parsed.data, source };
}

export function flagOf(name: string, spec: ContextInput): string {
  return spec.flags ?? `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} <value>`;
}

function missingContext(config: ResolvedConfig, def: AnyCommand, area: AnyArea, connection: string, missing: string[]): ToilError {
  const declared = area.context as Record<string, ContextInput>;
  const isDefault = defaultConnectionName(config, area.name) === connection;
  const ways = missing.map((name) => {
    const spec = declared[name]!;
    const flag = flagOf(name, spec);
    if (spec.setting === undefined) return `pass ${flag}`;
    const variable = isDefault ? envName(area.name, spec.setting) : connectionEnvName(connection, spec.setting);
    return `pass ${flag}, or set ${spec.setting} on connection ${connection} (${variable})`;
  });
  return new ToilError('INVALID_INPUT', `${commandName(def)} needs ${missing.join(' and ')}, and none was given or found.`, {
    fix: `${ways.join('; ').replace(/^p/, 'P')}.`,
  });
}
