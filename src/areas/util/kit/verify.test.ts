import { describe, expect, it } from 'vitest';
import type { Warning } from '../../../core/envelope.js';
import { Verifier } from './verify.js';

const verifier = () => {
  const warnings: Warning[] = [];
  return { v: new Verifier((w) => warnings.push(w)), warnings };
};

describe('Verifier', () => {
  it("flags a mismatch: the check fails, verified.passed is false, and one warning names both numbers under the command's code", () => {
    const { v, warnings } = verifier();
    v.equal('tests.total', 12, 11, { code: 'REPORT_TOTALS_MISMATCH', at: 'testsuite "api"' });
    v.equal('tests.failures', 2, 2);
    const verified = v.done();
    expect(verified.passed).toBe(false);
    expect(verified.checks).toEqual([
      { check: 'tests.total', status: 'failed', checked: 1, failed: 1, failures: [{ at: 'testsuite "api"', expected: 12, actual: 11 }] },
      { check: 'tests.failures', status: 'passed', checked: 1, failed: 0 },
    ]);
    expect(warnings).toEqual([{ code: 'REPORT_TOTALS_MISMATCH', message: 'tests.total at testsuite "api": expected 12, found 11.' }]);
  });

  it('passes when every check held, with no warning', () => {
    const { v, warnings } = verifier();
    for (let line = 1; line <= 3; line++) v.expect('lines.reread', true);
    expect(v.done()).toEqual({ passed: true, checks: [{ check: 'lines.reread', status: 'passed', checked: 3, failed: 0 }] });
    expect(warnings).toEqual([]);
  });

  it('aggregates a check that runs many times into one entry, keeping the first five failures and counting the rest', () => {
    const { v, warnings } = verifier();
    for (let line = 1; line <= 10; line++) v.expect('lines.reread', line % 2 === 0, { at: `line ${line}`, expected: 'sample', actual: 'other' }, { code: 'LOG_LINE_MISMATCH' });
    const [check] = v.done().checks;
    expect(check).toMatchObject({ status: 'failed', checked: 10, failed: 5 });
    expect(check!.failures).toHaveLength(5);
    expect(warnings).toEqual([{ code: 'LOG_LINE_MISMATCH', message: 'lines.reread at line 1: expected "sample", found "other". (5 of 10 checks failed)' }]);
  });

  it('reports what it could not check, and what it approximated, as warnings at once and never as passed', () => {
    const { v, warnings } = verifier();
    v.unchecked('coverage.branches', 'the report states no branch counts');
    v.approximated('tokens', 'about four characters a token');
    const verified = v.done();
    expect(verified.passed).toBe(true);
    expect(verified.checks).toEqual([
      { check: 'coverage.branches', status: 'unchecked', checked: 0, failed: 0, detail: 'the report states no branch counts' },
      { check: 'tokens', status: 'approximated', checked: 0, failed: 0, detail: 'about four characters a token' },
    ]);
    expect(warnings).toEqual([
      { code: 'UNVERIFIED', message: 'coverage.branches was not checked: the report states no branch counts.' },
      { code: 'APPROXIMATED', message: 'tokens is approximate: about four characters a token.' },
    ]);
  });

  it('checks that a pass read the whole input, and says when it could not', () => {
    const file = { source: { kind: 'file' as const, path: 'a.log' }, expectedBytes: 100, bytesRead: 100, truncated: false };
    const ok = verifier();
    ok.v.inputComplete(file);
    expect(ok.v.done().passed).toBe(true);
    const short = verifier();
    short.v.inputComplete({ ...file, bytesRead: 60 });
    expect(short.v.done().passed).toBe(false);
    expect(short.warnings).toEqual([{ code: 'INPUT_INCOMPLETE', message: 'The input is 100 bytes on disk, but 60 were read.' }]);
    const stdin = verifier();
    stdin.v.inputComplete({ source: { kind: 'stdin' }, expectedBytes: undefined, bytesRead: 5, truncated: false });
    expect(stdin.v.done().checks[0]).toMatchObject({ status: 'unchecked' });
    expect(stdin.warnings[0]!.code).toBe('UNVERIFIED');
    // A read stopped at the cap fails the check, and the reader's own INPUT_TRUNCATED is the only warning.
    const cut = verifier();
    cut.v.inputComplete({ ...file, bytesRead: 40, truncated: true });
    expect(cut.v.done()).toMatchObject({ passed: false, checks: [{ check: 'input.complete', status: 'failed' }] });
    expect(cut.warnings).toEqual([]);
  });

  it('cuts a long value in a warning', () => {
    const { v, warnings } = verifier();
    v.equal('body', 'x'.repeat(500), 'y');
    v.done();
    expect(warnings[0]!.code).toBe('VERIFY_FAILED');
    expect(warnings[0]!.message.length).toBeLessThan(260);
  });
});
