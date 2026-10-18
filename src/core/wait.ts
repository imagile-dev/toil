import { z } from 'zod';
import { commandName, defineConfigCommand, isCliOnly, takesAllowWrite, toolName, writesFor, type AnyCommand } from './command.js';
import { DEFAULT_MAX_WAIT_MS, parseDuration } from './config.js';
import type { Context } from './context.js';
import { failure, type Envelope, type Meta, type Warning } from './envelope.js';
import { ToilError, toToilError } from './errors.js';
import { compileQuery, isFalse, pointAt, QueryError, type Query } from './query/index.js';
import { applySelect, takeSelect } from './query/select.js';
import { sleep } from './rest.js';
import { DEFAULT_TIMEOUT_MS, execute, inFieldNames, keepExitCode, type FrontDoor } from './run.js';

/**
 * `toil wait`: run one read again and again until a JMESPath condition holds
 * over its `data`, so an agent waiting on a build, a scan or a deployment
 * makes one call instead of writing its own loop.
 *
 * It's core's, with no per-area code, and every attempt is an ordinary
 * execute() of the read: the same validation, connection, time limit, cancel
 * and audit line as running it by hand. Only reads can be waited on: repeating
 * a write would file the change again on every attempt, so a write is
 * INVALID_INPUT before anything runs. A standing meeting that ends when the
 * answer changes is still a meeting, but at least nobody has to attend it.
 */

/** No faster than this between attempts: a service someone else runs is not a busy loop. */
export const MIN_INTERVAL_MS = 5_000;
export const DEFAULT_INTERVAL_MS = 15_000;
/** How long a wait lasts when neither --timeout nor TOIL_TIMEOUT_MS says. */
export const DEFAULT_WAIT_MS = 30 * 60_000;
/** The longest a transient failure pushes the next attempt back. */
export const MAX_BACKOFF_MS = 5 * 60_000;

/** What `meta.wait` carries on every envelope a wait returns once it has started. */
export interface WaitReport {
  until: string;
  attempts: number;
  elapsedMs: number;
}

/** What a front door hears after each attempt: MCP sends it as a progress notification, the CLI writes it to stderr. */
export interface WaitProgress {
  attempt: number;
  elapsedMs: number;
  message: string;
}

const duration = (what: string) =>
  z
    .string()
    .regex(/^\d+(ms|s|m|h)$/, `${what} is a number and a unit: 500ms, 15s, 30m or 2h`)
    .optional();

const input = z.object({
  tool: z.string().min(1).describe('The read to repeat, by its MCP tool name, e.g. jenkins_get_build. Write tools are refused.'),
  input: z.record(z.string(), z.unknown()).optional().describe("That tool's input, exactly as you would pass it to the tool."),
  until: z
    .string()
    .min(1)
    .describe("A JMESPath expression over the tool's data; the wait ends when it is true (not null, false or empty), e.g. \"result != null\" or \"status == 'OK'\"."),
  interval: duration('interval').describe(`How long to wait between attempts, e.g. 30s. Default 15s, at least 5s.`),
  timeout: duration('timeout').describe('How long to keep trying, e.g. 30m, before TIMEOUT with the last data. Default 30m, or TOIL_TIMEOUT_MS; at most the "wait.maxTimeout" in config (default 1h).'),
});

/**
 * The command itself. It's a definition like any other so both front doors
 * list and describe it from one place, but it never goes through execute()
 * on its own: runCommand() hands it to runWait() below, which runs the read
 * through execute() once per attempt. `dispatches` is how core knows.
 */
export const waitCommand: AnyCommand = {
  ...defineConfigCommand({
    path: ['wait'],
    description: 'Run a read command until a JMESPath condition over its data holds, or the timeout passes',
    toolDescription:
      "Runs one read tool again and again until a JMESPath condition over its data is true, then returns that tool's last result with meta.wait (until, attempts, elapsedMs). Use it instead of calling a tool in a loop while a build, scan, job or deployment finishes. Network errors, 5xx and 429 responses are retried with backoff; any other error ends the wait with that error. Past the timeout it's TIMEOUT, with the last data in error.details.data. Write tools can't be waited on. Sends a progress notification after every attempt.",
    input,
    writes: false,
    options: [
      { flags: '--until <expression>', field: 'until', description: "A JMESPath condition over the command's data; the wait ends when it is true" },
      { flags: '--interval <duration>', field: 'interval', description: 'Time between attempts, e.g. 30s (default 15s, at least 5s)' },
      { flags: '--timeout <duration>', field: 'timeout', description: 'How long to keep trying, e.g. 30m (default 30m or TOIL_TIMEOUT_MS; at most "wait.maxTimeout" in config, default 1h)' },
    ],
    examples: [{ tool: 'version', input: {}, until: 'version != null', interval: '5s', timeout: '1m' }],
    run: () => Promise.reject(new Error('toil wait runs through runCommand(), never execute() on its own.')),
  }),
  dispatches: true,
};

/** The commands a wait may repeat: anything but another wait or a CLI-only command, which may be waiting on a person. */
export const waitable = (def: AnyCommand): boolean => !def.dispatches && !isCliOnly(def);

/** The read a wait repeats, and its input, as the CLI parsed them or MCP sent them. */
interface Target {
  def: AnyCommand;
  input: Record<string, unknown>;
}

export interface WaitOptions {
  /** The commands this front door serves: the CLI's every command, MCP's listed tools. */
  targets: readonly AnyCommand[];
  progress?: (p: WaitProgress) => void;
}

/**
 * Runs a wait: checks its own input and the read it names before anything is
 * sent, then calls execute() for the read until `until` holds, a non-transient
 * error, the timeout, or a cancel. `makeContext` builds a fresh context for
 * each attempt, as each call through a front door gets one.
 */
export async function runWait(def: AnyCommand, rawInput: unknown, makeContext: (def: AnyCommand) => Context, version: string, via: FrontDoor, options: WaitOptions): Promise<Envelope> {
  const started = Date.now();
  const name = commandName(def);
  const refuse = (err: unknown): Envelope => failure(toToilError(err), { command: name, durationMs: Date.now() - started, version });
  let prepared: Prepared;
  try {
    prepared = prepare(def, rawInput, makeContext(def), options.targets);
  } catch (err) {
    return refuse(err);
  }
  const { target, until, select, intervalMs, timeoutMs, signal, notes } = prepared;
  // The wait's own warnings (a TOIL_TIMEOUT_MS it cut to the maximum) go after the read's.
  const withNotes = (meta: Meta): Meta => (notes.length > 0 ? { ...meta, warnings: [...(meta.warnings ?? []), ...notes] } : meta);
  const deadline = started + timeoutMs;
  const report = (attempts: number): WaitReport => ({ until: until.expression, attempts, elapsedMs: Date.now() - started });
  // The read's own envelope, so its meta (context, warnings, requests) says what it did, plus where the wait got to.
  // A read that asked for an exit code (a build that ran and failed) still gets it.
  const finish = (envelope: Envelope, attempts: number): Envelope => keepExitCode(envelope, { ...envelope, meta: withNotes({ ...envelope.meta, durationMs: Date.now() - started, wait: report(attempts) }) });
  let last: Envelope | undefined;
  let lastData: unknown = null;
  let failures = 0;
  const stopped = (err: ToilError, attempts: number): Envelope => {
    const meta: Meta = withNotes({ ...(last?.meta ?? { command: commandName(target.def), version }), durationMs: Date.now() - started, wait: report(attempts) });
    return failure(err, meta);
  };

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) return stopped(cancelled(target.def, attempt - 1, lastData), attempt - 1);
    const left = deadline - Date.now();
    // Each attempt keeps its own limit, and never runs past the wait's.
    const limit = Math.max(1, Math.min(target.def.timeLimitMs ?? DEFAULT_TIMEOUT_MS, left));
    const ctx = makeContext(target.def);
    const envelope = await execute(target.def, target.input, { ...ctx, timeoutMs: limit }, via);
    last = via === 'mcp' ? keepExitCode(envelope, inFieldNames(target.def, envelope)) : envelope;
    if (signal?.aborted) return stopped(cancelled(target.def, attempt, lastData), attempt);
    let message: string;
    if (last.ok) {
      failures = 0;
      lastData = last.data;
      let met: boolean;
      try {
        met = !isFalse(until.search(last.data));
      } catch (caught) {
        const err = caught instanceof QueryError ? caught : new QueryError('invalid-value', caught instanceof Error ? caught.message : String(caught));
        return stopped(
          new ToilError('INVALID_INPUT', `The until expression couldn't be applied to the result of ${commandName(target.def)}: ${err.message}`, {
            fix: 'Change the expression to fit the data; run the command once with no wait to see its shape.',
            details: { expression: until.expression, kind: err.kind, data: lastData },
          }),
          attempt,
        );
      }
      if (met) {
        if (!select) return finish(last, attempt);
        const warnings = [...(last.meta.warnings ?? [])];
        try {
          const data = applySelect(select, last.data, commandName(target.def), false, (w) => warnings.push(w));
          return finish(keepExitCode(last, { ...last, data, meta: { ...last.meta, ...(warnings.length > 0 ? { warnings } : {}) } }), attempt);
        } catch (err) {
          return stopped(toToilError(err), attempt);
        }
      }
      message = `attempt ${attempt}: ${until.expression} is not true yet`;
    } else if (transient(last, Date.now() < deadline)) {
      failures++;
      message = `attempt ${attempt}: ${last.error.code} (${last.error.message}); retrying`;
    } else if (last.error.code === 'TIMEOUT') {
      // The attempt ran into the wait's own deadline.
      return stopped(timedOut(target.def, until, attempt, timeoutMs, lastData), attempt);
    } else {
      // Anything else won't fix itself by asking again: stop with that error.
      return finish(last, attempt);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return stopped(timedOut(target.def, until, attempt, timeoutMs, lastData), attempt);
    options.progress?.({ attempt, elapsedMs: Date.now() - started, message });
    const pause = failures > 0 ? Math.min(intervalMs * 2 ** failures, Math.max(intervalMs, MAX_BACKOFF_MS)) : intervalMs;
    try {
      // A sleep that would end past the deadline ends at it, for one last look.
      await (signal ? sleep(Math.min(pause, remaining), signal) : new Promise((r) => setTimeout(r, Math.min(pause, remaining))));
    } catch {
      return stopped(cancelled(target.def, attempt, lastData), attempt);
    }
  }
}

interface Prepared {
  target: Target;
  until: Query;
  select: Query | undefined;
  intervalMs: number;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  /** Warnings about the wait itself, for meta.warnings. */
  notes: Warning[];
}

/** Everything a wait can refuse, refused before the first attempt sends anything. */
function prepare(def: AnyCommand, rawInput: unknown, ctx: Context, targets: readonly AnyCommand[]): Prepared {
  const name = commandName(def);
  const { input: own, query: select } = takeSelect(name, rawInput);
  const parsed = def.input.strict().safeParse(own ?? {});
  if (!parsed.success) {
    throw new ToilError('INVALID_INPUT', `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`, {
      fix: `Run toil ${name} --help to see the expected arguments.`,
      details: parsed.error.issues,
    });
  }
  const wait = parsed.data as z.output<typeof input>;
  const found = targets.find((t) => waitable(t) && toolName(t) === wait.tool);
  if (!found) {
    throw new ToilError('INVALID_INPUT', `toil wait can't run ${wait.tool}: it isn't a command this toil serves${wait.tool === 'wait' ? ', and a wait can\'t wait on a wait' : ''}.`, {
      fix: 'Name a read tool from the tool list (toil <area> <command> after -- on the CLI).',
    });
  }
  const targetInput = wait.input ?? {};
  // The write check reads the input as the command will (`writesWhen` looks at a parsed method).
  const targetOwn = takeSelect(commandName(found), targetInput).input;
  const asParsed = found.input.strict().safeParse(targetOwn ?? {});
  if (found.writes || (takesAllowWrite(found) && writesFor(found, asParsed.success ? asParsed.data : targetOwn))) {
    throw new ToilError('INVALID_INPUT', `toil wait only repeats reads, and ${commandName(found)} ${found.writes ? 'changes data' : 'changes data with this input'}; repeating it would make the change again on every attempt.`, {
      fix: `Make the change once with toil ${commandName(found)}, then wait on a read that shows its result.`,
    });
  }
  let until: Query;
  try {
    until = compileQuery(wait.until);
  } catch (caught) {
    const err = caught instanceof QueryError ? caught : new QueryError('syntax', caught instanceof Error ? caught.message : String(caught));
    throw new ToilError('INVALID_INPUT', `Invalid until expression for ${name}: ${err.message}`, {
      fix: `Fix the expression and run it again. ${pointAt(wait.until, err)} See https://jmespath.org/specification.html for the expression language.`,
      details: { expression: wait.until, kind: err.kind, position: err.position },
    });
  }
  const intervalMs = wait.interval === undefined ? DEFAULT_INTERVAL_MS : parseDuration(wait.interval)!;
  if (intervalMs < MIN_INTERVAL_MS) {
    throw new ToilError('INVALID_INPUT', `toil wait --interval ${wait.interval} is too short: attempts are at least ${MIN_INTERVAL_MS / 1000}s apart.`, { fix: 'Pass --interval 5s or longer.' });
  }
  const max = ctx.config.wait?.maxTimeoutMs ?? DEFAULT_MAX_WAIT_MS;
  // --timeout replaces TOIL_TIMEOUT_MS for this one command; without it, TOIL_TIMEOUT_MS, else the default.
  const notes: Warning[] = [];
  const timeoutMs = wait.timeout === undefined ? Math.min(ctx.timeoutMs ?? DEFAULT_WAIT_MS, max) : parseDuration(wait.timeout)!;
  // TOIL_TIMEOUT_MS is a default for every command, so a value above the wait maximum is cut rather than refused, and says so.
  if (wait.timeout === undefined && ctx.timeoutMs !== undefined && ctx.timeoutMs > max) {
    notes.push({
      code: 'WAIT_TIMEOUT_CAPPED',
      message: `TOIL_TIMEOUT_MS is ${ctx.timeoutMs} ms (${formatMs(ctx.timeoutMs)}), longer than the ${formatMs(max)} wait maximum ("wait": { "maxTimeout" } in config), so this wait stops at ${formatMs(max)}.`,
    });
  }
  if (timeoutMs > max) {
    throw new ToilError('INVALID_INPUT', `toil wait --timeout ${wait.timeout} is longer than the ${formatMs(max)} this config allows.`, {
      fix: `Pass a shorter --timeout, or ask the person who owns this config to raise "wait": { "maxTimeout": "<duration>" } in ${ctx.config.files.global.replace(/\\/g, '/') || 'their toil config'}.`,
    });
  }
  return { target: { def: found, input: targetInput }, until, select, intervalMs, timeoutMs, signal: ctx.signal, notes };
}

/**
 * Worth asking again: the network, a 429 that outlasted its own retries, a
 * 5xx, or one attempt running out of its own time while the wait still has some.
 */
function transient(envelope: Envelope & { ok: false }, timeLeft: boolean): boolean {
  const { code, details } = envelope.error;
  if (code === 'NETWORK') return true;
  if (code === 'TIMEOUT') return timeLeft;
  const status = typeof details === 'object' && details !== null ? (details as { status?: unknown }).status : undefined;
  return code === 'HTTP' && typeof status === 'number' && (status === 429 || status >= 500);
}

function timedOut(def: AnyCommand, until: Query, attempts: number, timeoutMs: number, data: unknown): ToilError {
  return new ToilError('TIMEOUT', `${until.expression} wasn't true for ${commandName(def)} after ${formatMs(timeoutMs)} and ${attempts} attempt${attempts === 1 ? '' : 's'}; toil stopped waiting.`, {
    fix: 'It may still change on the server. Look at error.details.data for the last result, then wait again or pass a longer --timeout.',
    details: { data },
  });
}

function cancelled(def: AnyCommand, attempts: number, data: unknown): ToilError {
  return new ToilError('CANCELLED', `The wait on ${commandName(def)} was cancelled after ${attempts} attempt${attempts === 1 ? '' : 's'}.`, { details: { data } });
}

function formatMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}
