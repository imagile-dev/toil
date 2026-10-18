import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';
import { localName } from '../kit/xml.js';
import { expectRoot, intAttr, streamXml, type CoverageSummary, type Skips } from './shared.js';
import { coverageSummary, type FileTally } from './coverage.js';

/**
 * Cobertura XML, streamed: coverlet's, coverage.py's, and anything else
 * that writes `<coverage><packages><package><classes><class><lines>`. Each
 * class's `<lines>` are counted (the copies under `<methods>` are read
 * past, or every line would count twice), and branches come from
 * `condition-coverage="50% (1/2)"`.
 *
 * Each stated rate (`line-rate`, `branch-rate` on a class, a package and
 * the root) and each stated count (`lines-covered`, `lines-valid`,
 * `branches-covered`, `branches-valid`) is recomputed from the hit counts.
 * A rate is allowed one unit in its last written decimal place, so a rate
 * rounded or truncated to four places still agrees with itself.
 * Rounding is a policy, and every tool has filed a different one.
 */

interface Tally {
  lines: number;
  covered: number;
  branches: number;
  branchesCovered: number;
}

const empty = (): Tally => ({ lines: 0, covered: 0, branches: 0, branchesCovered: 0 });
const addInto = (into: Tally, from: Tally) => {
  into.lines += from.lines;
  into.covered += from.covered;
  into.branches += from.branches;
  into.branchesCovered += from.branchesCovered;
};

/** What a written rate allows: one unit in its last decimal place, or half a ten-thousandth for a whole number. */
export function rateTolerance(stated: string): number {
  const decimals = stated.trim().split('.')[1]?.length ?? 0;
  return decimals === 0 ? 0.00005 : 10 ** -decimals + 1e-12;
}

const CONDITION = /\((\d+)\s*\/\s*(\d+)\)/;

/** Known subtrees this reader doesn't need: per-method copies of the lines, and per-line condition detail. */
const QUIET = new Set(['methods', 'conditions']);
const PARENT: Record<string, string> = { sources: 'coverage', source: 'sources', packages: 'coverage', package: 'packages', classes: 'package', class: 'classes', lines: 'class', line: 'lines' };

interface Scope {
  element: 'coverage' | 'package' | 'class';
  name: string | null;
  line: number;
  attrs: Record<string, string>;
  tally: Tally;
}

export async function readCobertura(input: UtilInput, v: Verifier, skips: Skips, lowest: number): Promise<CoverageSummary> {
  const path: string[] = [];
  const scopes: Scope[] = [];
  const files = new Map<string, FileTally>();
  const sources: string[] = [];
  let source: string | undefined;
  let file: string | null = null;
  let ignoring = 0;

  const checkRate = (scope: Scope, attr: 'line-rate' | 'branch-rate', covered: number, total: number, where: string) => {
    const stated = scope.attrs[attr];
    if (stated === undefined || total === 0 || !/^\s*\d+(\.\d+)?\s*$/.test(stated)) return;
    const computed = covered / total;
    const ok = Math.abs(Number(stated) - computed) <= rateTolerance(stated);
    const check = attr === 'line-rate' ? 'coverage.lineRate' : 'coverage.branchRate';
    v.expect(check, ok, { at: where, expected: Number(stated), actual: Math.round(computed * 1e6) / 1e6 }, {
      code: 'REPORT_COVERAGE_MISMATCH',
      message: `${where} states ${attr}="${stated}", but its hit counts give ${covered}/${total} = ${(computed * 100).toFixed(2)}%.`,
    });
  };

  const checkCount = (scope: Scope, attr: string, counted: number, where: string, check: string) => {
    const stated = intAttr(scope.attrs[attr]);
    if (stated === undefined) return;
    v.equal(check, stated, counted, { at: where, code: 'REPORT_COVERAGE_MISMATCH', message: `${where} states ${attr}="${stated}", but its lines count ${counted}.` });
  };

  const closeScope = () => {
    const scope = scopes.pop()!;
    const parent = scopes.at(-1);
    if (parent) addInto(parent.tally, scope.tally);
    const where = scope.element === 'coverage' ? '<coverage>' : `<${scope.element} name="${scope.name ?? ''}"> at line ${scope.line}`;
    const t = scope.tally;
    checkRate(scope, 'line-rate', t.covered, t.lines, where);
    checkRate(scope, 'branch-rate', t.branchesCovered, t.branches, where);
    if (scope.element === 'coverage') {
      checkCount(scope, 'lines-covered', t.covered, where, 'coverage.linesCovered');
      checkCount(scope, 'lines-valid', t.lines, where, 'coverage.linesValid');
      checkCount(scope, 'branches-covered', t.branchesCovered, where, 'coverage.branchesCovered');
      checkCount(scope, 'branches-valid', t.branches, where, 'coverage.branchesValid');
    }
  };

  let rootSeen = false;
  await streamXml(input, 'Cobertura', (event) => {
    if (event.type === 'open') {
      if (ignoring > 0) {
        ignoring++;
        return;
      }
      const name = localName(event.name);
      if (!rootSeen) {
        rootSeen = true;
        expectRoot(event.name, ['coverage'], 'Cobertura', input.label);
        path.push(name);
        scopes.push({ element: 'coverage', name: null, line: event.line, attrs: event.attrs, tally: empty() });
        return;
      }
      const parent = path.at(-1)!;
      if (QUIET.has(name)) {
        ignoring = 1;
        return;
      }
      if (PARENT[name] !== parent) {
        skips.add(name, `not part of a Cobertura report under <${parent}>`);
        ignoring = 1;
        return;
      }
      path.push(name);
      const { attrs } = event;
      if (name === 'source') source = '';
      else if (name === 'package' || name === 'class') {
        scopes.push({ element: name, name: attrs.name ?? null, line: event.line, attrs, tally: empty() });
        if (name === 'class') {
          file = attrs.filename ?? attrs.name ?? '';
          if (!files.has(file)) files.set(file, { lines: 0, covered: 0, branches: 0, branchesCovered: 0, hasBranches: false });
        }
      } else if (name === 'line') {
        const scope = scopes.at(-1)!;
        const hits = intAttr(attrs.hits);
        if (hits === undefined) {
          skips.add('line', 'no whole-number hits attribute');
          return;
        }
        const t = scope.tally;
        t.lines++;
        if (hits > 0) t.covered++;
        const f = files.get(file!)!;
        f.lines++;
        if (hits > 0) f.covered++;
        if (attrs.branch === 'true') {
          const m = CONDITION.exec(attrs['condition-coverage'] ?? '');
          if (!m) {
            skips.add('line', 'branch="true" without a condition-coverage count');
            return;
          }
          const [covered, total] = [Number(m[1]), Number(m[2])];
          t.branches += total;
          t.branchesCovered += covered;
          f.branches += total;
          f.branchesCovered += covered;
          f.hasBranches = true;
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
      if (name === 'source' && source !== undefined) {
        sources.push(source.trim());
        source = undefined;
      } else if (name === 'package' || name === 'class' || name === 'coverage') closeScope();
      return;
    }
    if (event.type === 'text' && source !== undefined && ignoring === 0) source += event.text;
  });

  // A read cut short at the size cap leaves scopes open: their counts stand, unchecked against rates they can't meet.
  while (scopes.length > 1) addInto(scopes.at(-2)!.tally, scopes.pop()!.tally);
  return coverageSummary(files, sources, lowest);
}
