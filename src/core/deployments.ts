import { z } from 'zod';
import type { AnyArea } from './area.js';
import { commandName, type AnyCommand, type CliArgument, type CliOption } from './command.js';
import type { ResolvedConfig } from './config.js';
import { ToilError } from './errors.js';
import { fromText } from './schema.js';

/**
 * One product, two deployments (Jira Data Center and Jira Cloud), one command
 * tree. Each deployment keeps its own implementation of a command, written
 * with `area.command()` against its own API; `area.byDeployment()` folds the pair
 * into the one command the CLI and MCP show: the input is the union of what
 * either takes, and `run` hands the call to the implementation for the
 * resolved connection's deployment. A call the deployment can't serve (a
 * command only the other one has, or a flag only the other one takes) is
 * refused before anything is sent, saying which deployment and what to do.
 *
 * The implementations are never registered themselves. Two forms for one
 * request, filed in one cabinet under one heading, is the whole idea.
 */

/** Words that differ between deployments and need someone to choose them; everything else is derived. */
export interface DeploymentOverride {
  description?: string;
  toolDescription?: string;
  /** Help text for a field (and its flag) that both deployments take, where their own differ. */
  describe?: Record<string, string>;
  /** The flag text for an option both deployments take, where their own differ (`--assignee <user>`). */
  flags?: Record<string, string>;
}

export interface DeploymentOptions {
  /** By command name (`jira issue assign`). */
  overrides?: Record<string, DeploymentOverride>;
}

type Impls = Record<string, readonly AnyCommand[]>;

/** The union of the implementations' commands, one per path, in the order they are first met. */
export function foldDeployments(area: AnyArea, impls: Impls, options: DeploymentOptions = {}): AnyCommand[] {
  const variants = area.variants;
  if (!variants) throw new Error(`Area ${area.name}: commands by deployment need the area to declare variants.`);
  const by = variants.by as string;
  const labels = Object.fromEntries(Object.entries(variants.of).map(([value, v]) => [value, v.label ?? value]));
  for (const deployment of Object.keys(impls)) {
    if (!(deployment in labels)) throw new Error(`Area ${area.name}: commands by deployment name deployment "${deployment}", which the area's variants don't have.`);
  }
  const order: string[] = [];
  const byPath = new Map<string, Array<[string, AnyCommand]>>();
  for (const [deployment, list] of Object.entries(impls)) {
    for (const def of list) {
      const key = commandName(def);
      if (!byPath.has(key)) {
        byPath.set(key, []);
        order.push(key);
      }
      if (byPath.get(key)!.some(([d]) => d === deployment)) throw new Error(`${key} is defined twice for ${labels[deployment]}.`);
      byPath.get(key)!.push([deployment, def]);
    }
  }
  const problems: string[] = [];
  const merged: AnyCommand[] = [];
  for (const key of order) {
    try {
      merged.push(foldOne(area, by, labels, byPath.get(key)!, options.overrides?.[key] ?? {}));
    } catch (err) {
      problems.push(`${key}: ${(err as Error).message}`);
    }
  }
  if (problems.length > 0) throw new Error(`Commands of ${area.name} by deployment disagree:\n- ${problems.join('\n- ')}`);
  return merged;
}

const json = (value: unknown) => JSON.stringify(value ?? null);

const optional = (schema: z.ZodType) => schema.safeParse(undefined).success;

function foldOne(area: AnyArea, by: string, labels: Record<string, string>, impls: Array<[string, AnyCommand]>, override: DeploymentOverride): AnyCommand {
  const [, first] = impls[0]!;
  const name = commandName(first);
  const all = Object.keys(labels);
  const who = (deployments: string[]) => deployments.map((d) => labels[d]).join(' and ');
  const here = impls.map(([d]) => d);

  // What must be the same whichever deployment runs it, or the one command would be two.
  for (const [deployment, def] of impls) {
    if (def.kind !== 'area') throw new Error(`${labels[deployment]}'s command has kind ${def.kind}; a command with no connection has no deployment to go by, so define it once by hand.`);
    for (const prop of ['writes', 'mcp', 'timeLimitMs', 'writesLocal', 'dispatches'] as const) {
      if (json(def[prop]) !== json(first[prop])) throw new Error(`${prop} is ${json(def[prop])} for ${labels[deployment]} but ${json(first[prop])} for ${labels[impls[0]![0]]}.`);
    }
    for (const prop of ['auditInput'] as const) {
      if (json(def[prop]) !== json(first[prop])) throw new Error(`${prop} differ between deployments.`);
    }
    for (const prop of ['writesWhen', 'offMcpWhen', 'writesLocalWhen', 'connectionlessWhen'] as const) {
      if (def[prop] !== first[prop]) throw new Error(`${prop} must be the same function for every deployment that has it.`);
    }
  }

  // Paths either one answers to (Data Center's `git current-pr`) answer for the one command.
  const aliases = [...new Map(impls.flatMap(([, d]) => d.aliases ?? []).map((alias) => [json(alias), alias] as const)).values()];
  // A command that can run with no connection for one deployment (`pr current` says so, instead of failing) can for the other: with no connection there is no deployment to ask, and the first one answers.
  const connectionOptional = impls.some(([, d]) => d.connectionOptional === true);
  // A read by POST in either is a read by POST here; it only widens what the parity suite lets a read send.
  const queryByPost = impls.some(([, d]) => d.queryByPost === true);
  const description = override.description ?? same(impls.map(([, d]) => d.description), `description differs (${who(here)}); say which in the override`);
  const toolDescription = override.toolDescription ?? same(impls.map(([, d]) => d.toolDescription), `toolDescription differs (${who(here)}); say which in the override`);

  // The union input: a field both take must be the same schema, one only one takes must be optional.
  const fieldNames = [...new Set(impls.flatMap(([, d]) => Object.keys(d.input.shape)))];
  const shape: Record<string, z.ZodType> = {};
  for (const field of fieldNames) {
    const holders = impls.filter(([, d]) => field in d.input.shape);
    const schemas = holders.map(([d, def]) => [d, (def.input.shape as Record<string, z.ZodType>)[field]!] as const);
    // Declared differently (a stricter number, a non-empty string): the first deployment's schema is the union's,
    // and each implementation still validates its own call against its own schema before it runs.
    let schema = schemas[0]![1];
    // A field not every deployment requires can't be required of every call.
    if (holders.length < impls.length || schemas.some(([, s]) => optional(s))) {
      if (!optional(schema)) schema = schema.optional();
    }
    const texts = [...new Set(schemas.map(([, s]) => s.description ?? ''))];
    const only = holders.length < impls.length ? ` [${who(holders.map(([d]) => d))} only]` : '';
    const text = override.describe?.[field] ?? (texts.length === 1 ? texts[0]! : undefined);
    if (text === undefined) throw new Error(`field ${field} is described differently for ${who(holders.map(([d]) => d))}; give it a "describe" in the override.`);
    shape[field] = text || only ? schema.describe(`${text}${only}`) : schema;
  }

  // Options and arguments, by the field each maps onto.
  const options: CliOption[] = [];
  for (const field of fieldNames) {
    const holders = impls.flatMap(([d, def]) => (def.options ?? []).filter((o) => o.field === field).map((o) => [d, o] as const));
    if (holders.length === 0) continue;
    const flags = override.flags?.[field] ?? same(holders.map(([, o]) => o.flags), `flags for ${field} differ (${who(holders.map(([d]) => d))}); give "flags" in the override`);
    const texts = [...new Set(holders.map(([, o]) => o.description))];
    const only = holders.length < impls.length && new Set(holders.map(([d]) => d)).size < impls.length ? ` [${who(holders.map(([d]) => d))} only]` : '';
    const text = override.describe?.[field] ?? (texts.length === 1 ? texts[0]! : undefined);
    if (text === undefined) throw new Error(`option ${field} is described differently for ${who(holders.map(([d]) => d))}; give it a "describe" in the override.`);
    options.push({ ...holders[0]![1], flags, description: `${text}${only}` });
  }
  const argsOf = (d: AnyCommand): CliArgument[] => d.args ?? [];
  // The same arguments in the same order; one a deployment makes optional (`pr diff [id]`, since Cloud can diff a commit instead) is optional here, and the deployment that requires it still does.
  const sameArg = (a: CliArgument) => json({ ...a, required: undefined });
  for (const [deployment, def] of impls) {
    if (json(argsOf(def).map(sameArg)) !== json(argsOf(first).map(sameArg))) throw new Error(`positional arguments differ for ${labels[deployment]}.`);
  }
  const args = argsOf(first).map((arg, i) => (impls.some(([, d]) => argsOf(d)[i]!.required === false) ? { ...arg, required: false } : arg));

  // A context input the area gives to some deployments only (`--ws` is Cloud's) is neither a field nor a need of the others.
  const declared = area.context as Record<string, { deployments?: string[] }>;
  // A deployment the input isn't for still takes it on a command that lists it itself.
  const takes = (deployment: string, def: AnyCommand, field: string) =>
    !declared[field]?.deployments || declared[field].deployments.includes(deployment) || (def.contextListed ?? []).includes(field);
  const routes: Record<string, { fields: string[]; context: NonNullable<AnyCommand['context']>; input: z.ZodObject; run: AnyCommand['run'] }> = {};
  for (const [deployment, def] of impls) {
    routes[deployment] = {
      fields: Object.keys(def.input.shape).filter((field) => takes(deployment, def, field)),
      context: Object.fromEntries(Object.entries(def.context ?? {}).filter(([field]) => takes(deployment, def, field))),
      input: def.input,
      run: def.run,
    };
  }
  // Core resolves the union up front; each route then holds the call to the inputs its own deployment takes (call-context.ts).
  const context: NonNullable<AnyCommand['context']> = {};
  for (const route of Object.values(routes)) for (const [field, need] of Object.entries(route.context)) if (context[field] !== 'required') context[field] = need;
  const exampleDeployments: string[] = [];
  const examples = impls.flatMap(([deployment, def]) => def.examples.map((example) => (exampleDeployments.push(deployment), example)));

  const folded = {
    ...first,
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(connectionOptional ? { connectionOptional } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(queryByPost ? { queryByPost } : {}),
    description,
    ...(toolDescription !== undefined ? { toolDescription } : {}),
    input: z.object(shape),
    options,
    ...(args.length > 0 ? { args } : {}),
    examples,
    exampleDeployments,
    deployments: { by, labels, routes },
    run: (input, ctx) => {
      const deployment = String((ctx.connection as Record<string, unknown> | undefined)?.[by] ?? all[0]);
      const route = routes[deployment];
      // Unreachable through execute(), which refuses first; here for a program that runs a command's `run` itself.
      if (!route) throw unsupported(area, by, name, labels, routes, deployment, undefined);
      const own = new Set(route.fields);
      const given = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([field]) => own.has(field) || !(field in shape)));
      return route.run(revalidate(route.input, name, given) as never, ctx as never);
    },
  } as AnyCommand;
  return folded;
}

/**
 * The call as its own deployment's implementation declared it. The union
 * schema is the first deployment's where they differ, so a field the other one
 * is stricter about (a whole number, a non-empty string) is held to that here,
 * with text read as typed the way argv and env vars are (`fromText`), and the
 * same INVALID_INPUT as any other bad input. Defaults of its own apply here too.
 */
function revalidate(input: z.ZodObject, name: string, given: Record<string, unknown>): unknown {
  const shape = input.shape as Record<string, z.ZodType>;
  const typed = Object.fromEntries(Object.entries(given).map(([field, value]) => [field, field in shape ? fromText(shape[field]!, value) : value]));
  const parsed = input.strict().safeParse(typed);
  if (parsed.success) return parsed.data;
  throw new ToilError('INVALID_INPUT', `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`, {
    fix: `Run toil ${name} --help to see the expected arguments.`,
    details: parsed.error.issues,
  });
}

function same<T>(values: T[], message: string): T {
  if (new Set(values.map(json)).size > 1) throw new Error(message);
  return values[0] as T;
}

/** Whether `refuseForDeployment` would refuse this call; the context resolver asks it before it complains about inputs the deployment never needed. */
export function refusesDeployment(def: AnyCommand, sent: Record<string, unknown>, connection: Record<string, unknown>): boolean {
  const routed = def.deployments;
  if (!routed) return false;
  const route = routed.routes[String(connection[routed.by] ?? defaultDeployment(def))];
  return !route || Object.keys(sent).some((field) => sent[field] !== undefined && field in def.input.shape && !route.fields.includes(field));
}

/**
 * The refusal for a call this connection's deployment can't serve, or
 * undefined when it can: the command has no implementation for it, or the
 * call sets a flag only another deployment's implementation takes. Read from
 * the input as the caller sent it, so a field the deployment never takes is
 * refused even when its default would have filled it in. Names flags on the
 * CLI and fields over MCP and the API.
 */
export function refuseForDeployment(
  def: AnyCommand,
  sent: Record<string, unknown>,
  connection: Record<string, unknown>,
  config: ResolvedConfig,
  via: 'cli' | 'mcp' | 'api',
): ToilError | undefined {
  const routed = def.deployments;
  if (!routed) return undefined;
  const deployment = String(connection[routed.by] ?? defaultDeployment(def));
  const route = routed.routes[deployment];
  const name = commandName(def);
  const conn = String(connection.name);
  if (!route) return unsupported(def.area!, routed.by, name, routed.labels, routed.routes, deployment, { config, connection: conn });
  const foreign = Object.keys(sent).filter((field) => sent[field] !== undefined && field in def.input.shape && !route.fields.includes(field));
  if (foreign.length === 0) return undefined;
  const serves = Object.entries(routed.routes).filter(([, r]) => foreign.some((f) => r.fields.includes(f))).map(([d]) => d);
  const spoken = foreign.map((field) => (via === 'cli' ? flagFor(def, field) : field)).join(', ');
  return new ToilError(
    'UNSUPPORTED',
    `${name}: ${spoken} ${foreign.length > 1 ? "aren't" : "isn't"} available on ${routed.labels[deployment]} connections, and connection ${conn} is one. ${serves.map((d) => routed.labels[d]).join(' and ')} only.`,
    { fix: `Leave ${foreign.length > 1 ? 'them' : 'it'} out, or use a ${serves.map((d) => routed.labels[d]).join(' or ')} connection${others(def.area!, routed, serves, config)}.` },
  );
}

/** The CLI spelling of an input field: its flag, or its positional argument. */
function flagFor(def: AnyCommand, field: string): string {
  const option = def.options?.find((o) => o.field === field);
  const long = option?.flags.split(/[\s,|]+/).find((p) => p.startsWith('--'));
  if (long) return long;
  const arg = def.args?.find((a) => a.field === field);
  return arg ? `<${arg.name}>` : field;
}

function defaultDeployment(def: AnyCommand): string {
  return String(def.area?.defaults?.[def.deployments!.by] ?? Object.keys(def.deployments!.labels)[0]);
}

/** ` (--connection a, b)`: the user's connections to this area that can, so the fix names a real one. */
function others(area: AnyArea, routed: NonNullable<AnyCommand['deployments']>, serves: string[], config: ResolvedConfig): string {
  const fallback = String(area.defaults?.[routed.by] ?? Object.keys(routed.labels)[0]);
  const names = Object.entries(config.connections)
    .filter(([, conn]) => conn.area === area.name && serves.includes(String({ ...config.defaults[area.name], ...conn }[routed.by] ?? fallback)))
    .map(([connName]) => connName);
  return names.length > 0 ? ` (--connection ${names.join(' or ')})` : '';
}

function unsupported(
  area: AnyArea,
  by: string,
  name: string,
  labels: Record<string, string>,
  routes: Record<string, unknown>,
  deployment: string,
  detail: { config: ResolvedConfig; connection: string } | undefined,
): ToilError {
  const serves = Object.keys(routes);
  const of = serves.map((d) => labels[d]).join(' and ');
  const routed = { by, labels, routes } as NonNullable<AnyCommand['deployments']>;
  const connection = detail ? `connection ${detail.connection}` : 'this connection';
  const where = detail ? others(area, routed, serves, detail.config) : '';
  return new ToilError('UNSUPPORTED', `${name} isn't available on ${labels[deployment]} connections, and ${connection} is one. It works on ${of}.`, {
    fix: `Use a ${of} connection${where}${where ? '' : `, set up with "${routed.by}": "${serves[0]}" on the connection`}.`,
  });
}
