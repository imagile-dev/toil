import { z } from 'zod';
import { areaOf, commandName, type AnyCommand } from './command.js';
import { writesEnabled } from './config.js';
import type { Context } from './context.js';
import { failure, success, type Envelope } from './envelope.js';
import { ToilError, toToilError } from './errors.js';

/**
 * The one way any command runs, from either front door: validate the input,
 * enforce the write gate, run, and wrap the result or failure in the envelope.
 */
export async function execute(def: AnyCommand, rawInput: unknown, ctx: Context): Promise<Envelope> {
  const started = performance.now();
  const meta = () => ({ command: commandName(def), durationMs: Math.round(performance.now() - started), version: ctx.version });

  try {
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${commandName(def)}: ${z.prettifyError(parsed.error)}`, {
        fix: `Run toil ${commandName(def)} --help to see the expected arguments.`,
        details: parsed.error.issues,
      });
    }
    if (def.writes) assertWritesAllowed(def, parsed.data, ctx);
    const data = await def.run(parsed.data, ctx);
    return success(data, meta());
  } catch (err) {
    return failure(toToilError(err), meta());
  }
}

/** Writes need both the area's standing opt-in and --allow-write on this call. */
function assertWritesAllowed(def: AnyCommand, input: Record<string, unknown>, ctx: Context): void {
  const area = areaOf(def);
  if (!writesEnabled(ctx.config, area)) {
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data in ${area}, and writes are off for ${area}.`, {
      fix: `To allow writes, set "writes": true under "${area}" in your toil config (or TOIL_${area.toUpperCase()}_WRITES=true), then pass --allow-write.`,
    });
  }
  if (input.allowWrite !== true) {
    throw new ToilError('WRITE_DISABLED', `${commandName(def)} changes data and needs --allow-write on the call.`, {
      fix: 'Re-run with --allow-write if you mean to make this change.',
    });
  }
}

/** Write commands add this field to their input; MCP tools expose it as a required choice. */
export const allowWriteField = {
  allowWrite: z.boolean().optional().describe('Must be true to make the change. Set only when the user asked for this write.'),
};
