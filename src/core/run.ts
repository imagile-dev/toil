import { z } from 'zod';
import { areaOf, commandName, type AnyCommand } from './command.js';
import { writesEnabled } from './config.js';
import type { Context } from './context.js';
import { failure, success, type Envelope, type Meta } from './envelope.js';
import { ToilError, toToilError } from './errors.js';
import { instrumentFetch, type RequestLog } from './http.js';

/**
 * The one way any command runs, from either front door: validate the input,
 * enforce the write gate, run with an instrumented fetch, and wrap the result
 * or failure in the envelope. --verbose lives here, so neither front door can
 * forget it.
 */
export async function execute(def: AnyCommand, rawInput: unknown, ctx: Context): Promise<Envelope> {
  const started = performance.now();
  const requests: RequestLog[] = [];
  const meta = (): Meta => {
    const m: Meta = { command: commandName(def), durationMs: Math.round(performance.now() - started), version: ctx.version };
    if (ctx.verbose) m.requests = requests;
    return m;
  };

  try {
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${commandName(def)}: ${z.prettifyError(parsed.error)}`, {
        fix: `Run toil ${commandName(def)} --help to see the expected arguments.`,
        details: parsed.error.issues,
      });
    }
    if (def.writes) assertWritesAllowed(def, parsed.data, ctx);
    const data = await def.run(parsed.data, { ...ctx, fetch: instrumentFetch(ctx.fetch, requests) });
    return success(data, meta());
  } catch (err) {
    return failure(toToilError(err), meta());
  }
}

/**
 * Writes need both the area's standing opt-in and --allow-write on this call.
 * Two approvals, like a change request, except both of these are actually read.
 */
function assertWritesAllowed(def: AnyCommand, input: Record<string, unknown>, ctx: Context): void {
  const area = areaOf(def);
  if (!writesEnabled(ctx.config, area)) {
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data in ${area}, and writes are off for ${area}.`, {
      fix: `To allow writes, set "writes": true under "${area}" in your global toil config (or ${envName(area, 'writes')}=true), then pass --allow-write.`,
    });
  }
  if (input.allowWrite !== true) {
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data and needs --allow-write on the call.`, {
      fix: 'Re-run with --allow-write if you mean to make this change.',
    });
  }
}

function envName(area: string, key: string): string {
  return `TOIL_${area.toUpperCase().replace(/-/g, '_')}_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
}

/**
 * Write commands spread this into their input. It is optional in the schema so
 * MCP clients see it as a field they may set; execute() refuses the write when
 * it isn't true, so leaving it out is the safe default.
 */
export const allowWriteField = {
  allowWrite: z.boolean().optional().describe('Must be true to make the change. Set only when the user asked for this write.'),
};
