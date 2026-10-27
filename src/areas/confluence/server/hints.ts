import { ToilError } from '../../../core/errors.js';

/**
 * What a failed page create or page update adds to Confluence's error, word
 * for word as specified: the offending line of an XML parse error, and the
 * storage-format mistakes known to turn into an HTTP 500. Confluence reports a
 * malformed macro as a NullPointerException, which is accurate in the way a
 * rejection slip reading "form incorrect" is accurate.
 */

/**
 * For an error carrying `at [row,col]={R,C}`, the offending line of the
 * submitted body and a pointer under the column. Null when the error has no
 * position or the row is past the end of the body.
 */
export function xmlParseHint(err: unknown, bodyContent: string, convertedFromMarkdown = false): string | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/at \[row,col\]=\{(\d+),(\d+)\}/);
  if (!m) return null;
  const row = parseInt(m[1]!, 10);
  const col = parseInt(m[2]!, 10);
  const line = bodyContent.split('\n')[row - 1];
  if (!line) return null;
  const pointer = ' '.repeat(Math.max(0, col - 1)) + '^';
  const suffix = convertedFromMarkdown ? ' (converted from Markdown)' : '';
  return `Offending line ${row}${suffix}: ${line}\n${pointer}`;
}

/** The HTTP status a ToilError from core's REST layer carries, if any. */
const statusOf = (err: unknown): unknown => (err instanceof ToilError ? (err.details as { status?: unknown } | undefined)?.status : undefined);

/**
 * For an HTTP 500, the known storage-format mistakes in the submitted body.
 * Null when it isn't a 500 or nothing known is found.
 */
export function storageFormatHint(err: unknown, bodyContent: string): string | null {
  if (statusOf(err) !== 500) return null;
  const hints: string[] = [];

  // A bare name= on <ac:parameter>; the lookbehind spares the valid ac:name=.
  if (/<ac:parameter[^>]*(?<![:\w])name\s*=/i.test(bodyContent)) {
    hints.push('<ac:parameter name="..."> found — use ac:name="..." instead (e.g. <ac:parameter ac:name="language">text</ac:parameter>).');
  }

  // A macro with no ac:macro-id; some Confluence versions throw on it.
  const macroTagRe = /<ac:structured-macro(?:\s[^>]*)?\s*>/gi;
  let macroMatch: RegExpExecArray | null;
  while ((macroMatch = macroTagRe.exec(bodyContent)) !== null) {
    if (!/\bac:macro-id\b/.test(macroMatch[0])) {
      hints.push('<ac:structured-macro> without ac:macro-id found — add a unique UUID: ac:macro-id="<uuid>" (e.g. ac:macro-id="a1b2c3d4-...").');
      break;
    }
  }

  if (hints.length === 0) return null;
  return `HTTP 500 — possible storage-format causes:\n${hints.map((h) => `  • ${h}`).join('\n')}`;
}

/**
 * The error a failed page write throws: Confluence's own, with both hints
 * appended to its message when either applies. `body` is what was sent, after
 * any Markdown conversion; with none (the conversion itself failed) nothing
 * is added.
 */
export function withBodyHints(err: unknown, body: string | undefined, markdown: boolean): unknown {
  if (!body) return err;
  const hint = [xmlParseHint(err, body, markdown), storageFormatHint(err, body)].filter(Boolean).join('\n\n');
  if (!hint) return err;
  const message = `${err instanceof Error ? err.message : String(err)}\n\n${hint}`;
  if (err instanceof ToilError) return new ToilError(err.code, message, { ...(err.fix !== undefined ? { fix: err.fix } : {}), details: err.details });
  return new ToilError('HTTP', message, { fix: "See Confluence's message above; fix the page body and try again." });
}
