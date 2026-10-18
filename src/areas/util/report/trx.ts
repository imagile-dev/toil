import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';
import { localName } from '../kit/xml.js';
import { expectRoot, intAttr, locationFromStack, MAX_CAPTURE, messageOf, streamXml, trimStack, type Skips, type TestFailure, type TestsSummary } from './shared.js';

/**
 * Visual Studio's TRX, as `dotnet test --logger trx` writes it, streamed.
 * `<Results>` comes before `<TestDefinitions>`, so a failure's class is
 * filled in at the end, from the definitions; only the failures and an id
 * to class map are held.
 *
 * The declared totals are `<ResultSummary><Counters>`, one counter per
 * outcome (`passed`, `failed`, `notExecuted`…). Each is recounted from the
 * top-level results' `outcome`. Writers disagree on two of them: `executed`
 * isn't compared, and a counter declared 0 over results that have its
 * outcome is reported as unchecked rather than failed, because VSTest
 * leaves several at 0 whatever ran. Every other disagreement is
 * REPORT_TOTALS_MISMATCH. The form has fifteen boxes; most are left blank.
 */

/** The TRX outcomes, as each counter is named. */
const OUTCOMES = ['passed', 'failed', 'error', 'timeout', 'aborted', 'inconclusive', 'passedButRunAborted', 'notRunnable', 'notExecuted', 'disconnected', 'warning', 'completed', 'inProgress', 'pending'] as const;
type Outcome = (typeof OUTCOMES)[number];
const FAILING: Partial<Record<Outcome, TestFailure['kind']>> = { failed: 'failure', error: 'error', timeout: 'error', aborted: 'error' };

/** Known subtrees this reader doesn't need, read past whole: run settings, output, attachments, lists. */
const QUIET = new Set([
  'Times', 'TestSettings', 'TestEntries', 'TestLists', 'RunInfos', 'ResultFiles', 'CollectorDataEntries',
  'StdOut', 'StdErr', 'DebugTrace', 'TextMessages', 'Exception',
  'Execution', 'Description', 'Owners', 'Properties', 'TestCategory', 'Css', 'DeploymentItems', 'Workitems', 'DataSource',
]);

/** Where each element this reader reads may appear: its parent. */
const PARENT: Record<string, string> = {
  Results: 'TestRun',
  TestDefinitions: 'TestRun',
  ResultSummary: 'TestRun',
  UnitTestResult: 'Results',
  Output: 'UnitTestResult|ResultSummary',
  ErrorInfo: 'Output',
  Message: 'ErrorInfo',
  StackTrace: 'ErrorInfo',
  InnerResults: 'UnitTestResult',
  UnitTest: 'TestDefinitions',
  TestMethod: 'UnitTest',
  Counters: 'ResultSummary',
};

interface Pending {
  testId: string | null;
  name: string;
  kind: TestFailure['kind'];
  message: string;
  stack: string;
}

export async function readTrx(input: UtilInput, v: Verifier, skips: Skips): Promise<TestsSummary> {
  const path: string[] = [];
  const counted: Record<string, number> = {};
  let total = 0;
  let declared: Record<string, number> | undefined;
  let ignoring = 0;
  let rootSeen = false;
  const classOf = new Map<string, string>();
  const pending: Pending[] = [];
  let result: Pending | undefined;
  let unitTest: string | null = null;
  let capture: 'message' | 'stack' | undefined;

  await streamXml(input, 'TRX', (event) => {
    if (event.type === 'open') {
      if (ignoring > 0) {
        ignoring++;
        return;
      }
      const name = localName(event.name);
      if (!rootSeen) {
        rootSeen = true;
        expectRoot(event.name, ['TestRun'], 'TRX', input.label);
        path.push(name);
        return;
      }
      const parent = path.at(-1)!;
      const { attrs } = event;
      if (name === 'UnitTestResult' && parent === 'InnerResults') {
        // A data row of a data-driven test: its parent result is the one the counters count.
        ignoring = 1;
        return;
      }
      if (QUIET.has(name) || (name === 'Output' && parent === 'ResultSummary')) {
        ignoring = 1;
        return;
      }
      const allowed = PARENT[name]?.split('|');
      if (!allowed?.includes(parent)) {
        skips.add(name, parent === 'Results' ? 'a result type this reader does not read (only UnitTestResult)' : `not part of a TRX report under <${parent}>`);
        ignoring = 1;
        return;
      }
      path.push(name);
      if (name === 'UnitTestResult') {
        total++;
        const raw = attrs.outcome ?? '';
        const outcome = `${raw.charAt(0).toLowerCase()}${raw.slice(1)}`;
        counted[outcome] = (counted[outcome] ?? 0) + 1;
        const kind = FAILING[outcome as Outcome];
        if (kind) result = { testId: attrs.testId ?? null, name: attrs.testName ?? '', kind, message: '', stack: '' };
      } else if (name === 'Message' || name === 'StackTrace') {
        capture = result ? (name === 'Message' ? 'message' : 'stack') : undefined;
      } else if (name === 'UnitTest') {
        unitTest = attrs.id ?? null;
      } else if (name === 'TestMethod') {
        if (unitTest !== null && attrs.className) classOf.set(unitTest, attrs.className);
      } else if (name === 'Counters') {
        declared = {};
        for (const [key, value] of Object.entries(attrs)) {
          const n = intAttr(value);
          if (n !== undefined) declared[key] = n;
        }
      }
      return;
    }
    if (event.type === 'close') {
      if (ignoring > 0) {
        ignoring--;
        return;
      }
      const name = path.pop();
      if (name === 'UnitTestResult' && result) {
        pending.push(result);
        result = undefined;
      } else if (name === 'Message' || name === 'StackTrace') capture = undefined;
      else if (name === 'UnitTest') unitTest = null;
      return;
    }
    if (event.type === 'text' && capture && result && ignoring === 0) {
      const key = capture;
      if (result[key].length < MAX_CAPTURE) result[key] += event.text.slice(0, MAX_CAPTURE - result[key].length);
    }
  });

  if (declared === undefined) v.unchecked('tests.totals', 'the report has no <ResultSummary><Counters> to recount');
  else {
    const where = '<Counters>';
    if (declared.total !== undefined) {
      v.equal('tests.total', declared.total, total, { at: where, code: 'REPORT_TOTALS_MISMATCH', message: `${where} declares total="${declared.total}", but the report holds ${total} results.` });
    }
    for (const key of OUTCOMES) {
      const stated = declared[key];
      const count = counted[key] ?? 0;
      // A counter that is 0 with no result of its outcome agrees trivially; listing fifteen of those says nothing.
      if (stated === undefined || (stated === 0 && count === 0)) continue;
      if (stated === 0 && count > 0) {
        v.unchecked(`tests.${key}`, `${where} declares ${key}="0" over ${count} results with that outcome; some writers leave this counter at 0, so it isn't compared`);
        continue;
      }
      v.equal(`tests.${key}`, stated, count, { at: where, code: 'REPORT_TOTALS_MISMATCH', message: `${where} declares ${key}="${stated}", but ${count} results have that outcome.` });
    }
  }

  const failures: TestFailure[] = pending.map((p) => {
    const className = p.testId === null ? null : (classOf.get(p.testId) ?? null);
    const found = locationFromStack(p.stack, [className, p.name]);
    return {
      suite: className,
      name: p.name,
      className,
      kind: p.kind,
      type: null,
      message: messageOf(p.message, ''),
      file: found?.file ?? null,
      line: found?.line ?? null,
      location: found ? 'stack' : null,
      ...trimStack(p.stack),
    };
  });
  const n = (key: Outcome) => counted[key] ?? 0;
  const passed = n('passed');
  const failed = n('failed');
  const errors = n('error') + n('timeout') + n('aborted');
  const skipped = n('notExecuted') + n('notRunnable');
  return {
    suites: new Set(classOf.values()).size,
    totals: { tests: total, passed, failures: failed, errors, skipped, flaky: 0, other: total - passed - failed - errors - skipped },
    failures,
  };
}
