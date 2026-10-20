import type { Context } from '../context.js';
import { failure, type Envelope, type Warning } from '../envelope.js';
import { ToilError, toToilError } from '../errors.js';
import { alreadyExists } from '../files.js';
import { summarize, type SummaryReport } from './summary.js';
import { encodeToon } from './toon.js';
import { OUTPUT_FORMAT_FIELD, OUTPUT_FORMATS, SUMMARY_FILE_FIELD, type OutputFormat } from './fields.js';

export { OUTPUT_FORMAT_DESCRIPTION, OUTPUT_FORMAT_FIELD, OUTPUT_FORMATS, SUMMARY_FILE_DESCRIPTION, SUMMARY_FILE_FIELD, type OutputFormat } from './fields.js';

/**
 * Size-aware output, core's on every command and both front doors, as
 * `--select` is: `--output-format` (`outputFormat`) and `--summary-file`
 * (`summaryFile`). runCommand() takes both off the input before the command
 * sees it, and shapes the envelope after `--select` has been applied, so no
 * area has any code for them and the CLI, MCP and the API can't differ.
 *
 * - `outputFormat: "toon"` renders `data` as TOON text (src/core/output/toon.ts)
 *   and sets `meta.format`. `ok`, `error` and the rest of `meta` stay JSON.
 * - `summaryFile: <path>` writes the whole of `data`, as JSON, to that file in
 *   the workspace, through the same file service every command uses, and
 *   replaces `data` with a summary chosen by fixed rules
 *   (src/core/output/summary.ts), recorded in `meta.summary`.
 *
 * A failure is left as it is: there's no data to shape. Shrinking a result
 * without saying so would be the same thing as losing it, so meta.summary
 * always says which rule applied, how much there was, and where the rest went.
 */

export interface OutputOptions {
  format: OutputFormat;
  summaryFile?: string;
}

/** Splits the call's input into the command's own fields and the output options. A bad value is INVALID_INPUT before anything runs. */
export function takeOutput(command: string, raw: unknown): { input: unknown; output: OutputOptions } {
  const output: OutputOptions = { format: 'json' };
  if (typeof raw !== 'object' || raw === null || (!Object.hasOwn(raw, OUTPUT_FORMAT_FIELD) && !Object.hasOwn(raw, SUMMARY_FILE_FIELD))) return { input: raw, output };
  const { [OUTPUT_FORMAT_FIELD]: format, [SUMMARY_FILE_FIELD]: file, ...input } = raw as Record<string, unknown>;
  if (format !== undefined) {
    if (!OUTPUT_FORMATS.includes(format as OutputFormat)) {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${command}: outputFormat must be "json" or "toon", not ${JSON.stringify(format)}.`, {
        fix: 'Pass --output-format json or --output-format toon (outputFormat over MCP), or leave it out for JSON.',
      });
    }
    output.format = format as OutputFormat;
  }
  if (file !== undefined) {
    if (typeof file !== 'string' || file.trim() === '') {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${command}: summaryFile must be a file path.`, {
        fix: 'Pass --summary-file <path> (summaryFile over MCP), a file in the workspace that does not exist yet, or leave it out.',
      });
    }
    if (file === '-') {
      throw new ToilError('INVALID_INPUT', `Invalid input for ${command}: summaryFile can't be "-"; the full result goes to a file, and the summary to stdout.`, {
        fix: 'Pass --summary-file <path> with a file path in the workspace.',
      });
    }
    output.summaryFile = file;
  }
  return { input, output };
}

/**
 * The checks the summary file's write makes, before the command runs: inside
 * the bounds, and nothing there yet. A refused path means nothing ran, as with
 * --output-file, so a write is never made for a result nobody can read.
 */
export function checkSummaryFile(files: Context['files'], path: string): void {
  if (files.exists(path)) throw alreadyExists(files.resolve(path));
}

/**
 * The envelope as the caller asked for it: the summary first, from the data
 * `--select` left, then the format. `writes`: the command changes data, so a
 * file that can't be written after it ran says the change may be made.
 */
export function shapeEnvelope(envelope: Envelope, output: OutputOptions, files: Context['files'] | undefined, writes: boolean): Envelope {
  if (!envelope.ok || (output.format === 'json' && output.summaryFile === undefined)) return envelope;
  let data: unknown = envelope.data;
  const meta = { ...envelope.meta };
  if (output.summaryFile !== undefined) {
    let file: string;
    try {
      if (!files) throw new Error('No file service for this call.');
      file = files.writeBytes(output.summaryFile, new TextEncoder().encode(`${JSON.stringify(data, null, 2) ?? 'null'}\n`));
    } catch (caught) {
      const cause = toToilError(caught);
      const message = writes
        ? `${meta.command} ran, and the change may already have been applied, but its result couldn't be written to the summary file: ${cause.message}`
        : `The result of ${meta.command} couldn't be written to the summary file: ${cause.message}`;
      const fix = writes ? 'Check whether the change was made before retrying. Then pass a different summaryFile, or none.' : (cause.fix ?? 'Pass a different summaryFile, or none.');
      return failure(new ToilError(cause.code, message, { fix }), meta);
    }
    const summary = summarize(data);
    const whole = summary.report.rule === 'record' || summary.report.rule === 'all';
    // The path rides in data too, where the agent reading it is already looking.
    data = whole ? summary.data : { ...(summary.data as Record<string, unknown>), file };
    const report: SummaryReport = { ...summary.report, file };
    meta.summary = report;
    if (summary.large) {
      const warning: Warning = {
        code: 'SUMMARY_LARGE',
        message: `${meta.command} returned ${summary.report.rows} rows, so data holds their schema, a sample and per-column stats, and the full result is in meta.summary.file. Work over that file (a narrower query, --select, or a tool that reads JSON) rather than reading all of it into context.`,
      };
      meta.warnings = [...(meta.warnings ?? []), warning];
    }
  }
  if (output.format === 'toon') {
    data = encodeToon(data);
    meta.format = 'toon';
  }
  return { ...envelope, data, meta };
}
