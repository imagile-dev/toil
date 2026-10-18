import { z } from 'zod';
import { areaOf, commandName, isCliOnly, managesConfig, usesConnection, type AnyCommand } from './command.js';
import type { Connection } from './area.js';
import { resolveCall, supplyContext, type ResolvedCall } from './call-context.js';
import { connectionEnvName, connectionsOf, defaultConnectionName, envName } from './config.js';
import { IncompleteConnectionError } from './connection.js';
import type { CommandContext, Context } from './context.js';
import type { Place } from './dossier.js';
import { failure, success, type ContextReport, type Envelope, type Meta, type Page, type Warning } from './envelope.js';
import { ToilError, toToilError } from './errors.js';
import { instrumentFetch, type RequestLog } from './http.js';

/**
 * Builds the context and runs the command, so a failure building the context
 * (a config file that stopped being JSON while the MCP server was up) is an
 * envelope too, not an exception for each front door to remember to catch.
 * Both front doors call this; neither calls execute() directly.
 */
export async function runCommand(def: AnyCommand, rawInput: unknown, makeContext: () => Context, version: string): Promise<Envelope> {
  let ctx: Context;
  try {
    ctx = makeContext();
  } catch (err) {
    return failure(toToilError(err), { command: commandName(def), durationMs: 0, version });
  }
  return execute(def, rawInput, ctx);
}

/**
 * The exit code a command asked for with `ctx.setExitCode`, keyed on the
 * envelope it returned, so the envelope itself, which both front doors print,
 * gains no field. The CLI reads it; MCP has no exit code to give.
 */
const exitCodes = new WeakMap<Envelope, number>();

/** The exit code for an envelope: 1 for a failure, else what the command asked for, else 0. */
export function exitCodeOf(envelope: Envelope): number {
  return envelope.ok ? (exitCodes.get(envelope) ?? 0) : 1;
}

/** Two minutes: long enough for a slow report, short enough that a hung server isn't forever. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The one way any command runs, from either front door: validate the input
 * strictly, enforce the write gate, run with an instrumented, cancellable fetch
 * under a time limit, and wrap the result or failure in the envelope.
 * --verbose, warnings, paging, timeouts and cancellation all live here, so no
 * front door can forget them and no command has to remember them.
 */
export async function execute(def: AnyCommand, rawInput: unknown, ctx: Context): Promise<Envelope> {
  const started = performance.now();
  const requests: RequestLog[] = [];
  const warnings: Warning[] = [...ctx.config.warnings];
  let page: Page | undefined;
  let report: ContextReport | undefined;
  let exitCode: number | undefined;
  const meta = (): Meta => {
    const m: Meta = { command: commandName(def), durationMs: Math.round(performance.now() - started), version: ctx.version };
    if (ctx.verbose) m.requests = requests;
    if (warnings.length > 0) m.warnings = warnings;
    if (page) m.page = page;
    if (report && Object.keys(report).length > 0) m.context = report;
    return m;
  };

  // A CLI-only command may be waiting on a person typing a token; Ctrl+C still cancels it.
  const timeoutMs = isCliOnly(def) ? undefined : (ctx.timeoutMs ?? def.timeLimitMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  // Aborting stops toil waiting; it can't recall a request the server already
  // has. For a write, "stopped" would invite a retry that files the change
  // twice, so say what is actually known: nothing.
  const maybeApplied = def.writes ? ' The change may already have been applied.' : '';
  const checkFirst = def.writes ? 'Check whether the change was made before retrying. ' : '';
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new ToilError('TIMEOUT', `${commandName(def)} took longer than ${timeoutMs / 1000}s; toil stopped waiting.${maybeApplied}`, {
                fix: `${checkFirst}Narrow the request, or raise the limit with TOIL_TIMEOUT_MS.`,
              }),
            ),
          timeoutMs,
        );
  const onCallerAbort = () =>
    controller.abort(new ToilError('CANCELLED', `${commandName(def)} was cancelled.${maybeApplied}`, def.writes ? { fix: checkFirst.trim() } : {}));
  if (ctx.signal?.aborted) onCallerAbort();
  else ctx.signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    // Strict: an unknown or misspelt field is an error through MCP exactly as an
    // unknown flag is on the CLI, never a field silently ignored.
    const parsed = def.input.strict().safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${commandName(def)}: ${z.prettifyError(parsed.error)}`, {
        fix: `Run toil ${commandName(def)} --help to see the expected arguments.`,
        details: parsed.error.issues,
      });
    }
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    aborted.catch(() => {});
    // One connection per call, resolved before the gate: writes are switched on
    // per connection, so the gate has to know which one this call would use.
    // Its context inputs resolve with it, since an input may select it.
    // Reading a secret from the OS store spawns a process, so it runs under
    // the same time limit and cancel as the command itself.
    const input = parsed.data as Record<string, unknown>;
    // Filled as it resolves, so a failure part-way still reports what was chosen.
    const partial: ContextReport = {};
    if (usesConnection(def)) report = partial;
    // A command that handles "not set up" itself runs with no connection when
    // the area has none and the call names none; every other problem still fails.
    const optional =
      def.connectionOptional === true &&
      typeof input.connection !== 'string' &&
      !Object.entries(def.area?.context ?? {}).some(([name, spec]) => spec?.selectsConnection && typeof input[name] === 'string');
    const unconfigured = optional && defaultConnectionName(ctx.config, areaOf(def)) === undefined && connectionsOf(ctx.config, areaOf(def)).length === 0;
    // Which dossier applies, from the call's `dossier` and `cwd` (src/core/dossier.ts).
    // Asked once, before the connection, because the dossier may choose it.
    let place: Place | undefined;
    if (usesConnection(def) && ctx.dossiers) {
      place = ctx.dossiers.place({ dossier: input.dossier as string | undefined, cwd: input.cwd as string | undefined });
      warnings.push(...place.warnings);
      if (place.report) partial.dossier = place.report;
    }
    let call: ResolvedCall | undefined;
    if (usesConnection(def) && !unconfigured) {
      try {
        const dossier = ctx.dossiers ? place?.lookup : ctx.dossier;
        call = await Promise.race([
          resolveCall(def, input, { config: ctx.config, secrets: ctx.secrets, dossier, gitRemote: place?.gitRemote ?? ctx.gitRemote }, (w) => warnings.push(w), controller.signal, partial),
          aborted,
        ]);
        const chosen = call.report.connection;
        const host = chosen?.source === 'dossier' ? place?.hostFor(areaOf(def), input) : undefined;
        if (chosen && host) chosen.host = host;
      } catch (err) {
        // The default connection exists but lacks a key (a missing `pat`): the
        // command answers for that as it does for none, and the warning says what's missing.
        if (!(optional && err instanceof IncompleteConnectionError)) throw err;
        warnings.push({ code: 'CONFIG_INCOMPLETE', message: `${err.message} ${err.fix ?? ''}`.trim() });
      }
    }
    const connection = call?.connection;
    if (def.writes) assertWritesAllowed(def, input, connection, call?.report, place ? place.adopted : ctx.adopted, ctx);

    // Commands get their connection and nothing else: no config, and no env,
    // which carries every other connection's token too. Need-to-know,
    // enforced rather than requested in a policy nobody reads.
    // The credential store and the prompter go only to commands that manage
    // connections, which get them through ctx.manage.
    const rest: Omit<Context, 'config' | 'env' | 'secrets' | 'prompt' | 'dossiers' | 'dossier' | 'gitRemote' | 'adopted' | 'repo'> & {
      repo?: unknown;
      dossiers?: unknown;
      config?: unknown;
      env?: unknown;
      secrets?: unknown;
      prompt?: unknown;
      dossier?: unknown;
      gitRemote?: unknown;
      adopted?: unknown;
    } = { ...ctx };
    delete rest.config;
    delete rest.env;
    delete rest.secrets;
    delete rest.prompt;
    delete rest.dossiers;
    delete rest.dossier;
    delete rest.gitRemote;
    delete rest.adopted;
    delete rest.repo;
    const context = call?.context ?? {};
    const resolved = call?.report ?? {};
    const commandCtx: CommandContext<Connection | undefined> = {
      ...rest,
      connection,
      context,
      resolved,
      supply: (name, value, source) => {
        if (!def.area || !call) throw new Error(`${commandName(def)} has no context inputs to supply.`);
        return supplyContext(def.area, def, context, resolved, name, value, source);
      },
      ...(managesConfig(def) ? { manage: { config: ctx.config, secrets: ctx.secrets, prompt: ctx.prompt, dossiers: ctx.dossiers } } : {}),
      signal: controller.signal,
      fetch: instrumentFetch(ctx.fetch, requests, controller.signal),
      // A listing's warnings (a refused git include) land in meta.warnings without the command passing anything.
      files: { ...ctx.files, list: (dir, options) => ctx.files.list(dir, { ...options, warn: options?.warn ?? ((w) => warnings.push(w)) }) },
      // git stops with the command, as fetch does, without the command passing anything.
      ...(ctx.git ? { git: { run: (call) => ctx.git!.run(call, controller.signal) } } : {}),
      // A call's `cwd` names the folder its repository is read from; otherwise the workspace's.
      repo: () => (place?.repo ?? ctx.repo)?.(),
      warn: (warning) => warnings.push(warning),
      setPage: (p) => (page = p),
      setExitCode: (code) => {
        if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error(`${commandName(def)} asked for exit code ${code}; an exit code is a whole number from 0 to 255.`);
        exitCode = code;
      },
    };
    // `dossier` and `cwd` choose context, which core has resolved; the command never needs them.
    const own = { ...(parsed.data as Record<string, unknown>) };
    if (usesConnection(def)) {
      delete own.dossier;
      delete own.cwd;
    }
    const data = await Promise.race([def.run(own, commandCtx), aborted]);
    const envelope = success(data, meta());
    if (exitCode !== undefined) exitCodes.set(envelope, exitCode);
    return envelope;
  } catch (err) {
    // A request aborted by our signal surfaces as an AbortError; report why it was aborted.
    const reason = controller.signal.aborted ? controller.signal.reason : err;
    return failure(toToilError(reason), meta());
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Writes need both the connection's standing opt-in and --allow-write on this
 * call. Two approvals, like a change request, except both of these are
 * actually read.
 */
function assertWritesAllowed(
  def: AnyCommand,
  input: Record<string, unknown>,
  connection: Connection | undefined,
  report: ContextReport | undefined,
  adopted: Context['adopted'],
  ctx: Context,
): void {
  const area = areaOf(def);
  // A connection the dossier or the git remote picked is a suggestion until
  // the user adopts it. Reads may follow a suggestion; a write waits for a yes,
  // asked once, not inferred from where the terminal happens to be.
  const chosenBy = report?.connection?.source;
  if (connection && (chosenBy === 'dossier' || chosenBy === 'git') && !adopted?.(area, connection.name, chosenBy)) {
    const by = chosenBy === 'dossier' ? 'your dossier' : 'the git remote';
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data in ${area}, and connection ${connection.name} was chosen by ${by}, not by you.`, {
      fix: `Pass --connection ${connection.name} to choose it yourself, or adopt the binding once with toil dossiers import (coming with #16).`,
    });
  }
  if (!connection?.writes) {
    const name = connection?.name ?? area;
    const variable = connection && defaultConnectionName(ctx.config, area) !== name ? connectionEnvName(name, 'writes') : envName(area, 'writes');
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data in ${area}, and writes are off for connection ${name}.`, {
      fix: `To allow writes, set "writes": true on connection "${name}" in your toil config (or ${variable}=true), then pass --allow-write.`,
    });
  }
  if (input.allowWrite !== true) {
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data and needs --allow-write on the call.`, {
      fix: 'Re-run with --allow-write if you mean to make this change.',
    });
  }
}

/**
 * Write commands spread this into their input. It is optional in the schema so
 * MCP clients see it as a field they may set; execute() refuses the write when
 * it isn't true, so leaving it out is the safe default.
 */
export const allowWriteField = {
  allowWrite: z.boolean().optional().describe('Must be true to make the change. Set only when the user asked for this write.'),
};
