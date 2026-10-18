import { ToilError } from '../errors.js';
import type { Warning } from '../envelope.js';
import { compileQuery, pointAt, QueryError, type Query } from './index.js';

/**
 * `--select`: one input core adds to every command, on both front doors
 * (`--select <expression>` on the CLI, `select` in every MCP tool's input).
 * execute() takes it off the input before the command's own strict parse,
 * compiles it before anything runs, and applies it to `data` after `run`.
 * `meta`, `meta.page` included, is never touched: the cursor for the next page
 * has to survive whatever the caller chose to look at on this one. Asking for
 * less is a request no reporting process has been designed to receive.
 */

export const SELECT_FIELD = 'select';

export const SELECT_DESCRIPTION =
  'A JMESPath expression applied to the result before it is returned, keeping only what it selects (e.g. "issues[].{key: key, status: fields.status.name}"). meta is left as it is.';

const docsFix = 'See https://jmespath.org/specification.html for the expression language.';

/**
 * Splits the call's input into the command's own fields and the compiled
 * `select`, if there is one. A bad expression is INVALID_INPUT here, before
 * any connection resolves or any request is sent.
 */
export function takeSelect(command: string, raw: unknown): { input: unknown; query?: Query } {
  if (typeof raw !== 'object' || raw === null || !Object.hasOwn(raw, SELECT_FIELD)) return { input: raw };
  const { [SELECT_FIELD]: expression, ...input } = raw as Record<string, unknown>;
  if (expression === undefined) return { input };
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new ToilError('INVALID_INPUT', `Invalid input for ${command}: select must be a non-empty JMESPath expression.`, {
      fix: `Give select an expression (--select <expression> on the CLI), or leave it out. ${docsFix}`,
    });
  }
  try {
    return { input, query: compileQuery(expression) };
  } catch (caught) {
    const err = caught instanceof QueryError ? caught : new QueryError('syntax', caught instanceof Error ? caught.message : String(caught));
    throw new ToilError('INVALID_INPUT', `Invalid select expression for ${command}: ${err.message}`, {
      fix: `Fix the expression and run it again. ${pointAt(expression, err)} ${docsFix}`,
      details: { expression, kind: err.kind, position: err.position },
    });
  }
}

/**
 * Applies `select` to a command's data. An expression that selects nothing
 * gives `data: null` and a SELECT_EMPTY warning, not an error: an empty answer
 * is still an answer. One the data doesn't suit (a function given the wrong
 * type) is INVALID_INPUT; for a write, the message says the change was made,
 * because by then it was.
 */
export function applySelect(query: Query, data: unknown, command: string, writes: boolean, warn: (w: Warning) => void): unknown {
  let selected: unknown;
  try {
    selected = query.search(data);
  } catch (caught) {
    // Anything else (a stack overflow on data nested thousands deep) is still
    // this expression failing on this data, and says so, never a vague INTERNAL.
    const err = caught instanceof QueryError ? caught : new QueryError('invalid-value', caught instanceof Error ? caught.message : String(caught));
    const message = writes
      ? `${command} ran and made its change, but the select expression couldn't be applied to its result: ${err.message}`
      : `The select expression couldn't be applied to the result of ${command}: ${err.message}`;
    const fix = writes
      ? `Don't repeat the write. Change the expression to fit the data, and read the result back with a read command. ${docsFix}`
      : `Change the expression to fit the data, or leave select out to see its shape. ${docsFix}`;
    throw new ToilError('INVALID_INPUT', message, {
      fix,
      details: { expression: query.expression, kind: err.kind },
    });
  }
  if (selected === null || selected === undefined) {
    warn({ code: 'SELECT_EMPTY', message: `select "${query.expression}" selected nothing from the result of ${command}, so data is null. Leave select out to see what the result holds.` });
    return null;
  }
  return selected;
}
