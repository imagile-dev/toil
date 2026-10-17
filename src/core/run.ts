import { z } from 'zod';
import { areaOf, commandName, isCliOnly, managesConfig, usesConnection, type AnyCommand } from './command.js';
import type { Connection } from './area.js';
import { resolveCall, supplyContext, type ResolvedCall } from './call-context.js';
import { connectionEnvName, defaultConnectionName, envName } from './config.js';
import type { CommandContext, Context } from './context.js';
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
    const call: ResolvedCall | undefined = usesConnection(def)
      ? await Promise.race([
          resolveCall(def, input, { config: ctx.config, secrets: ctx.secrets, dossier: ctx.dossier, gitRemote: ctx.gitRemote }, (w) => warnings.push(w), controller.signal, partial),
          aborted,
        ])
      : undefined;
    const connection = call?.connection;
    if (def.writes) assertWritesAllowed(def, input, connection, call?.report, ctx);

    // Commands get their connection and nothing else: no config, and no env,
    // which carries every other connection's token too. Need-to-know,
    // enforced rather than requested in a policy nobody reads.
    // The credential store and the prompter go only to commands that manage
    // connections, which get them through ctx.manage.
    const rest: Omit<Context, 'config' | 'env' | 'secrets' | 'prompt' | 'dossier' | 'gitRemote' | 'adopted'> & {
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
    delete rest.dossier;
    delete rest.gitRemote;
    delete rest.adopted;
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
      ...(managesConfig(def) ? { manage: { config: ctx.config, secrets: ctx.secrets, prompt: ctx.prompt } } : {}),
      signal: controller.signal,
      fetch: instrumentFetch(ctx.fetch, requests, controller.signal),
      // A listing's warnings (a refused git include) land in meta.warnings without the command passing anything.
      files: { ...ctx.files, list: (dir, options) => ctx.files.list(dir, { ...options, warn: options?.warn ?? ((w) => warnings.push(w)) }) },
      // git stops with the command, as fetch does, without the command passing anything.
      ...(ctx.git ? { git: { run: (call) => ctx.git!.run(call, controller.signal) } } : {}),
      warn: (warning) => warnings.push(warning),
      setPage: (p) => (page = p),
    };
    const data = await Promise.race([def.run(parsed.data, commandCtx), aborted]);
    return success(data, meta());
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
function assertWritesAllowed(def: AnyCommand, input: Record<string, unknown>, connection: Connection | undefined, report: ContextReport | undefined, ctx: Context): void {
  const area = areaOf(def);
  // A connection the dossier or the git remote picked is a suggestion until
  // the user adopts it. Reads may follow a suggestion; a write waits for a yes,
  // asked once, not inferred from where the terminal happens to be.
  const chosenBy = report?.connection?.source;
  if (connection && (chosenBy === 'dossier' || chosenBy === 'git') && !ctx.adopted?.(area, connection.name)) {
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
