import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';
import { localName } from '../kit/xml.js';
import {
  expectRoot,
  intAttr,
  locationFromStack,
  MAX_CAPTURE,
  messageOf,
  streamXml,
  trimStack,
  type Skips,
  type TestFailure,
  type TestsSummary,
} from './shared.js';

/**
 * JUnit XML, streamed: the Surefire shape most tools copy, the Jenkins
 * shape (`<testsuites>` around nested `<testsuite>`s, `status`,
 * `assertions`, `disabled`), and the Azure DevOps shape (the VSTest
 * JUnit logger's `<testsuites>` with .NET stack traces). They differ in
 * where totals are declared and which extra elements appear, not in how a
 * case passes or fails, so one reader takes all three.
 *
 * Every suite that declares totals is recounted from its own cases, nested
 * suites included, and each declared number is checked against the count:
 * a report that says `failures="2"` over one failing case is
 * REPORT_TOTALS_MISMATCH, naming both numbers. The declared figure is
 * presumably what someone put on a slide.
 */

type Counted = { tests: number; failures: number; errors: number; skipped: number };
const DECLARED = ['tests', 'failures', 'errors', 'skipped'] as const;
/** The check each declared attribute feeds. */
const CHECK: Record<(typeof DECLARED)[number], string> = { tests: 'tests.total', failures: 'tests.failures', errors: 'tests.errors', skipped: 'tests.skipped' };

interface SuiteFrame {
  element: 'testsuites' | 'testsuite' | 'root';
  name: string | null;
  line: number;
  declared: Partial<Counted>;
  counted: Counted;
}

interface CaseState {
  name: string;
  className: string | null;
  suite: string | null;
  file: string | null;
  line: number | null;
  error: boolean;
  failure: boolean;
  skipped: boolean;
  flaky: boolean;
  /** The first failure or error element: its kind, attributes and text. */
  problem?: { kind: 'failure' | 'error'; message: string | undefined; type: string | undefined; text: string };
}

/** Elements inside a test case or suite that hold output or metadata, read past whole. */
const QUIET = new Set(['system-out', 'system-err', 'properties']);
/** Surefire's rerun records: the case was rerun after failing. `flaky*` means a rerun passed. */
const RERUN = new Set(['flakyFailure', 'flakyError', 'rerunFailure', 'rerunError']);

export async function readJunit(input: UtilInput, v: Verifier, skips: Skips): Promise<TestsSummary> {
  const frames: SuiteFrame[] = [{ element: 'root', name: null, line: 0, declared: {}, counted: { tests: 0, failures: 0, errors: 0, skipped: 0 } }];
  const failures: TestFailure[] = [];
  const totals = { flaky: 0 };
  let suites = 0;
  let declaring = 0;
  let current: CaseState | undefined;
  /** Open elements below the one being read past: while above 0, events are ignored. */
  let ignoring = 0;
  /** Whether text belongs to the current case's first failure or error. */
  let capturing = false;
  let rootSeen = false;

  // The tokenizer follows every open, a self-closing one included, with its close, so skipping is a depth count.
  const ignore = () => {
    ignoring = 1;
  };

  const closeSuite = () => {
    const frame = frames.pop()!;
    const parent = frames.at(-1)!;
    for (const key of DECLARED) parent.counted[key] += frame.counted[key];
    if (frame.element === 'testsuite') suites++;
    const keys = DECLARED.filter((k) => frame.declared[k] !== undefined);
    if (keys.length === 0) return;
    declaring++;
    const where = `<${frame.element}${frame.name === null ? '' : ` name="${frame.name}"`}> at line ${frame.line}`;
    for (const key of keys) {
      const declared = frame.declared[key]!;
      const counted = frame.counted[key];
      v.equal(CHECK[key], declared, counted, {
        at: where,
        code: 'REPORT_TOTALS_MISMATCH',
        message: `${where} declares ${key}="${declared}", but its test cases count ${counted}.`,
      });
    }
  };

  const closeCase = (c: CaseState) => {
    const counted = frames.at(-1)!.counted;
    counted.tests++;
    if (c.error) counted.errors++;
    else if (c.failure) counted.failures++;
    else if (c.skipped) counted.skipped++;
    else if (c.flaky) totals.flaky++;
    if (!c.problem || !(c.error || c.failure)) return;
    const { kind, message, type, text } = c.problem;
    const trace = trimStack(text);
    let file = c.file;
    let line = c.line;
    let location: TestFailure['location'] = file === null && line === null ? null : 'report';
    if (location === null) {
      const found = locationFromStack(text, [c.className, c.name]);
      if (found) {
        ({ file, line } = found);
        location = 'stack';
      }
    }
    failures.push({ suite: c.suite, name: c.name, className: c.className, kind, type: type?.trim() || null, message: messageOf(message, text), file, line, location, ...trace });
  };

  await streamXml(input, 'JUnit', (event) => {
    if (event.type === 'open') {
      if (ignoring > 0) {
        ignoring++;
        return;
      }
      const name = localName(event.name);
      if (!rootSeen) {
        rootSeen = true;
        expectRoot(event.name, ['testsuites', 'testsuite'], 'JUnit', input.label);
      }
      const { attrs } = event;
      if (current) {
        // Inside a test case.
        if (capturing) {
          skips.add(name, 'markup inside a failure or error message');
          ignore();
        } else if (name === 'failure' || name === 'error') {
          if (name === 'error') current.error = true;
          else current.failure = true;
          if (!current.problem) {
            current.problem = { kind: name, message: attrs.message, type: attrs.type, text: '' };
            capturing = true;
          } else ignore();
        } else if (name === 'skipped') {
          current.skipped = true;
          ignore();
        } else if (RERUN.has(name)) {
          if (name.startsWith('flaky')) current.flaky = true;
          ignore();
        } else if (QUIET.has(name)) ignore();
        else {
          skips.add(name, 'not part of a JUnit test case');
          ignore();
        }
        return;
      }
      if (name === 'testsuites' || name === 'testsuite') {
        const declared: Partial<Counted> = {};
        for (const key of DECLARED) {
          const n = intAttr(attrs[key]);
          if (n !== undefined) declared[key] = n;
        }
        frames.push({ element: name, name: attrs.name ?? null, line: event.line, declared, counted: { tests: 0, failures: 0, errors: 0, skipped: 0 } });
        return;
      }
      if (name === 'testcase') {
        const suite = [...frames].reverse().find((f) => f.element === 'testsuite')?.name ?? null;
        const lineNo = intAttr(attrs.line);
        current = {
          name: attrs.name ?? '',
          className: attrs.classname ?? null,
          suite,
          file: attrs.file ?? null,
          line: lineNo ?? null,
          error: false,
          failure: false,
          skipped: false,
          flaky: false,
        };
        return;
      }
      if (QUIET.has(name)) ignore();
      else {
        skips.add(name, 'not part of a JUnit report');
        ignore();
      }
      return;
    }
    if (event.type === 'close') {
      if (ignoring > 0) {
        ignoring--;
        return;
      }
      const name = localName(event.name);
      if (capturing && (name === 'failure' || name === 'error')) capturing = false;
      else if (name === 'testcase' && current) {
        closeCase(current);
        current = undefined;
      } else if (name === 'testsuites' || name === 'testsuite') closeSuite();
      return;
    }
    if (event.type === 'text' && capturing && current?.problem && ignoring === 0) {
      const p = current.problem;
      if (p.text.length < MAX_CAPTURE) p.text += event.text.slice(0, MAX_CAPTURE - p.text.length);
    }
  });

  // A read cut short at the size cap leaves suites open: count what they hold, without checking totals they can't meet.
  let cut = 0;
  while (frames.length > 1) {
    const frame = frames.pop()!;
    for (const key of DECLARED) frames.at(-1)!.counted[key] += frame.counted[key];
    if (DECLARED.some((k) => frame.declared[k] !== undefined)) cut++;
  }
  if (cut > 0) v.unchecked('tests.totals', `the read stopped before ${cut} suite${cut === 1 ? ' that declares' : 's that declare'} totals ended, so those totals were not compared`);
  else if (declaring === 0) v.unchecked('tests.totals', 'the report declares no totals (tests, failures, errors, skipped) to recount');
  const counted = frames[0]!.counted;
  return {
    suites,
    totals: {
      tests: counted.tests,
      passed: counted.tests - counted.failures - counted.errors - counted.skipped,
      failures: counted.failures,
      errors: counted.errors,
      skipped: counted.skipped,
      flaky: totals.flaky,
      other: 0,
    },
    failures,
  };
}
