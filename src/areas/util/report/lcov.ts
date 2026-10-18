import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';
import { coverageSummary, type FileTally } from './coverage.js';
import type { CoverageSummary, Skips } from './shared.js';

/**
 * lcov's tracefile, read line by line in constant memory per record.
 * Each `SF:` … `end_of_record` record states its own totals (`LF`/`LH` for
 * lines, `BRF`/`BRH` for branches, `FNF`/`FNH` for functions), and each is
 * recounted from the record's `DA`, `BRDA`, `FN`/`FNL` and `FNDA`/`FNA`
 * lines. A file that appears in several records (one per test name) is
 * merged: a line is covered when any record hit it.
 * The format predates most of its readers and has outlived several of them.
 */

interface RecordState {
  file: string;
  line: number;
  da: Map<number, number>;
  brda: Map<string, number>;
  functions: number;
  functionsHit: number;
  stated: Partial<Record<'LF' | 'LH' | 'BRF' | 'BRH' | 'FNF' | 'FNH', number>>;
}

const CHECKS = {
  LF: 'coverage.linesFound',
  LH: 'coverage.linesHit',
  BRF: 'coverage.branchesFound',
  BRH: 'coverage.branchesHit',
  FNF: 'coverage.functionsFound',
  FNH: 'coverage.functionsHit',
} as const;

const KNOWN = new Set(['TN', 'SF', 'VER', 'FN', 'FNDA', 'FNF', 'FNH', 'FNL', 'FNA', 'DA', 'LF', 'LH', 'BRDA', 'BRF', 'BRH']);
const COUNT = /^\d+$/;

export async function readLcov(input: UtilInput, v: Verifier, skips: Skips, lowest: number): Promise<CoverageSummary> {
  const merged = new Map<string, { lines: Map<number, number>; branches: Map<string, number>; statesBranches: boolean }>();
  let record: RecordState | undefined;
  let sawRecord = false;

  const finish = (r: RecordState) => {
    const lines = r.da.size;
    let hit = 0;
    for (const h of r.da.values()) if (h > 0) hit++;
    let branchesHit = 0;
    for (const t of r.brda.values()) if (t > 0) branchesHit++;
    const counted = { LF: lines, LH: hit, BRF: r.brda.size, BRH: branchesHit, FNF: r.functions, FNH: r.functionsHit };
    const where = `SF:${r.file} at line ${r.line}`;
    for (const key of Object.keys(CHECKS) as Array<keyof typeof CHECKS>) {
      const stated = r.stated[key];
      if (stated === undefined) continue;
      v.equal(CHECKS[key], stated, counted[key], { at: where, code: 'REPORT_COVERAGE_MISMATCH', message: `The record for ${r.file} at line ${r.line} states ${key}:${stated}, but its lines count ${counted[key]}.` });
    }
    const into = merged.get(r.file) ?? { lines: new Map<number, number>(), branches: new Map<string, number>(), statesBranches: false };
    into.statesBranches ||= r.brda.size > 0 || r.stated.BRF !== undefined;
    for (const [n, h] of r.da) into.lines.set(n, (into.lines.get(n) ?? 0) + h);
    for (const [k, t] of r.brda) into.branches.set(k, (into.branches.get(k) ?? 0) + t);
    merged.set(r.file, into);
  };

  for await (const { number, text } of input.lines()) {
    const line = text.trim();
    if (line === '') continue;
    if (line === 'end_of_record') {
      if (record) finish(record);
      else skips.add('end_of_record', 'no SF record open');
      record = undefined;
      continue;
    }
    const colon = line.indexOf(':');
    const key = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1);
    if (!KNOWN.has(key)) {
      skips.add(key, 'not an lcov record type this reader knows');
      continue;
    }
    if (key === 'TN' || key === 'VER') continue;
    if (key === 'SF') {
      if (record) {
        skips.add('SF', 'a record with no end_of_record before the next SF; its counts were kept');
        finish(record);
      }
      record = { file: value, line: number, da: new Map(), brda: new Map(), functions: 0, functionsHit: 0, stated: {} };
      sawRecord = true;
      continue;
    }
    if (!record) {
      skips.add(key, 'outside an SF record');
      continue;
    }
    const parts = value.split(',');
    switch (key) {
      case 'DA': {
        if (!COUNT.test(parts[0] ?? '') || !COUNT.test(parts[1] ?? '')) {
          skips.add('DA', 'not DA:<line>,<hits>');
          break;
        }
        const n = Number(parts[0]);
        record.da.set(n, (record.da.get(n) ?? 0) + Number(parts[1]));
        break;
      }
      case 'BRDA': {
        const taken = parts[3];
        if (parts.length < 4 || !COUNT.test(parts[0] ?? '') || (taken !== '-' && !COUNT.test(taken ?? ''))) {
          skips.add('BRDA', 'not BRDA:<line>,<block>,<branch>,<taken>');
          break;
        }
        const k = `${parts[0]},${parts[1]},${parts.slice(2, -1).join(',')}`;
        record.brda.set(k, (record.brda.get(k) ?? 0) + (taken === '-' ? 0 : Number(taken)));
        break;
      }
      case 'FN':
      case 'FNL':
        record.functions++;
        break;
      case 'FNDA':
        if (COUNT.test(parts[0] ?? '') && Number(parts[0]) > 0) record.functionsHit++;
        break;
      case 'FNA':
        if (COUNT.test(parts[1] ?? '') && Number(parts[1]) > 0) record.functionsHit++;
        break;
      default: {
        const stated = key as keyof RecordState['stated'];
        if (COUNT.test(value)) record.stated[stated] = Number(value);
        else skips.add(key, `not ${key}:<count>`);
      }
    }
  }
  if (record) {
    // The last record never ended: a file cut off, at the size cap or otherwise.
    skips.add('SF', 'a record with no end_of_record before the end of the input; its counts were kept');
    finish(record);
  }
  if (!sawRecord) v.unchecked('coverage.totals', 'the input holds no SF records');

  const files = new Map<string, FileTally>();
  for (const [file, m] of merged) {
    let covered = 0;
    for (const h of m.lines.values()) if (h > 0) covered++;
    let branchesCovered = 0;
    for (const t of m.branches.values()) if (t > 0) branchesCovered++;
    files.set(file, { lines: m.lines.size, covered, branches: m.branches.size, branchesCovered, hasBranches: m.statesBranches });
  }
  return coverageSummary(files, [], lowest);
}
