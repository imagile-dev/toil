import { isDeepStrictEqual } from 'node:util';
import type { Warning } from '../../../core/envelope.js';
import type { UtilInput } from './input.js';

/**
 * Self-verification for the `util` commands: each one checks its own result
 * wherever a check is possible and reports what it checked, the same way, in
 * `data.verified`. What it couldn't check, or had to approximate, goes in
 * `meta.warnings` too, so nothing is a silent guess (principle 4).
 *
 *   const v = new Verifier(ctx.warn);
 *   v.equal('tests.total', declared, counted, { code: 'REPORT_TOTALS_MISMATCH' });
 *   v.unchecked('coverage.branches', 'the report states no branch counts');
 *   return { ...result, verified: v.done() };
 *
 * A check is named once and may run many times (once per finding re-read,
 * say): it's reported as one entry with how often it ran and failed, plus the
 * first few failures. A command that marks its own homework is still
 * expected to show the working.
 */

export type CheckStatus = 'passed' | 'failed' | 'unchecked' | 'approximated';

export interface CheckFailure {
  /** Where: a line, a pointer, a file, a position in a bundle. */
  at?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface CheckResult {
  check: string;
  status: CheckStatus;
  /** How many times the check ran. 0 for one that couldn't run. */
  checked: number;
  failed: number;
  /** For `unchecked` and `approximated`: why, or how. */
  detail?: string;
  /** The first failures, at most {@link MAX_SAMPLES}. */
  failures?: CheckFailure[];
}

/** `data.verified`: `passed` is false when any check failed. Unchecked and approximated checks don't fail it; their warnings say what they are. */
export interface Verified {
  passed: boolean;
  checks: CheckResult[];
}

/** The warning code for a check that couldn't run. */
export const UNVERIFIED = 'UNVERIFIED';
/** The warning code for a result that is an approximation. */
export const APPROXIMATED = 'APPROXIMATED';
/** The warning code for a failed check that names no code of its own. */
export const VERIFY_FAILED = 'VERIFY_FAILED';

export const MAX_SAMPLES = 5;
const MAX_VALUE = 200;

interface Entry {
  result: CheckResult;
  code: string;
  message?: string;
  /** Someone already warned about this failure (the input reader, for a truncated read). */
  warned?: true;
}

/** A value as a warning shows it: JSON, cut to 200 characters. */
export function showValue(value: unknown): string {
  const text = value === undefined ? 'nothing' : typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

/**
 * Collects checks as a command runs, then reports them with `done()`. Never
 * pass a value the output must not hold (a secret) as `expected` or `actual`:
 * both are copied into the envelope.
 */
export class Verifier {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly warn: (warning: Warning) => void) {}

  private entry(check: string): Entry {
    let found = this.entries.get(check);
    if (!found) {
      found = { result: { check, status: 'passed', checked: 0, failed: 0 }, code: VERIFY_FAILED };
      this.entries.set(check, found);
    }
    return found;
  }

  /** One run of `check` that held. */
  pass(check: string): void {
    this.entry(check).result.checked++;
  }

  /** One run of `check` that didn't. `code` names the warning (default VERIFY_FAILED); `message` replaces the default wording. */
  fail(check: string, failure: CheckFailure = {}, options: { code?: string; message?: string } = {}): void {
    const entry = this.entry(check);
    const { result } = entry;
    result.checked++;
    result.failed++;
    result.status = 'failed';
    if (options.code) entry.code = options.code;
    if (options.message && entry.message === undefined) entry.message = options.message;
    if ((result.failures ??= []).length < MAX_SAMPLES) result.failures.push(failure);
  }

  /** `pass` when `ok`, else `fail`. Returns `ok`. */
  expect(check: string, ok: boolean, failure: CheckFailure = {}, options: { code?: string; message?: string } = {}): boolean {
    if (ok) this.pass(check);
    else this.fail(check, failure, options);
    return ok;
  }

  /** Whether `actual` is deeply equal to `expected`, recorded as one run of `check`. */
  equal(check: string, expected: unknown, actual: unknown, options: { at?: string; code?: string; message?: string } = {}): boolean {
    const { at, ...rest } = options;
    return this.expect(check, isDeepStrictEqual(expected, actual), { ...(at === undefined ? {} : { at }), expected, actual }, rest);
  }

  /** `check` couldn't run at all, and why. Warns at once. */
  unchecked(check: string, reason: string): void {
    this.mark(check, 'unchecked', reason, UNVERIFIED, `${check} was not checked: ${reason}.`);
  }

  /** The result of `check` is an approximation, and how it was made. Warns at once. */
  approximated(check: string, how: string): void {
    this.mark(check, 'approximated', how, APPROXIMATED, `${check} is approximate: ${how}.`);
  }

  /**
   * That a full pass read the whole input: the bytes read equal the file's
   * size on disk, so a truncated read can't pass (a read stopped at the cap
   * fails it too; the reader has already warned INPUT_TRUNCATED). Content passed as text has
   * nothing to compare with, and stdin no size to compare with; both are
   * reported as unchecked rather than assumed.
   */
  inputComplete(input: Pick<UtilInput, 'source' | 'expectedBytes' | 'bytesRead' | 'truncated'>): void {
    const check = 'input.complete';
    if (input.truncated) {
      // The reader warned INPUT_TRUNCATED when it stopped; the check fails without saying it twice.
      this.fail(check, { expected: input.expectedBytes ?? 'all of it', actual: input.bytesRead });
      this.entry(check).warned = true;
    } else if (input.expectedBytes === undefined) {
      this.unchecked(check, input.source.kind === 'stdin' ? 'stdin has no size to compare the bytes read with' : 'the content was passed inline');
    } else {
      this.equal(check, input.expectedBytes, input.bytesRead, { code: 'INPUT_INCOMPLETE', message: `The input is ${input.expectedBytes} bytes on disk, but ${input.bytesRead} were read.` });
    }
  }

  private mark(check: string, status: 'unchecked' | 'approximated', detail: string, code: string, message: string) {
    const { result } = this.entry(check);
    if (result.status !== 'failed') result.status = status;
    result.detail = detail;
    this.warn({ code, message });
  }

  /** The `data.verified` to return, with one warning per failed check. Call it once, after the last check. */
  done(): Verified {
    const checks = [...this.entries.values()].map((e) => e.result);
    for (const { result, code, message, warned } of this.entries.values()) {
      if (result.status !== 'failed' || warned) continue;
      const first = result.failures?.[0] ?? {};
      const where = first.at === undefined ? '' : ` at ${first.at}`;
      const sample = message ?? `${result.check}${where}: expected ${showValue(first.expected)}, found ${showValue(first.actual)}.`;
      const count = result.checked > 1 ? ` (${result.failed} of ${result.checked} checks failed)` : '';
      this.warn({ code, message: `${sample}${count}` });
    }
    return { passed: checks.every((c) => c.status !== 'failed'), checks };
  }
}
