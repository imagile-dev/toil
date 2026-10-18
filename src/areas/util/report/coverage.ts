import { ratio, type CoverageSummary, type FileCoverage } from './shared.js';

/** One file's counts, as Cobertura and lcov both reduce to. */
export interface FileTally {
  lines: number;
  covered: number;
  branches: number;
  branchesCovered: number;
  /** Whether the report gave any branch data for the file, as opposed to stating none. */
  hasBranches: boolean;
}

/**
 * Per-file percentages, the totals, and the `lowest` files by line
 * coverage, lowest first. Totals are summed from the files, never taken
 * from the report: the report's own figures are what the checks compare
 * against. Files with no lines have no percentage and are never "lowest".
 * An empty file is fully compliant, having done nothing that could be audited.
 */
export function coverageSummary(files: Map<string, FileTally>, sources: string[], lowest: number): CoverageSummary {
  const out: FileCoverage[] = [];
  const sum = { lines: 0, covered: 0, branches: 0, branchesCovered: 0, hasBranches: false };
  for (const [file, t] of files) {
    out.push({ file, lines: ratio(t.covered, t.lines), branches: t.hasBranches ? ratio(t.branchesCovered, t.branches) : null });
    sum.lines += t.lines;
    sum.covered += t.covered;
    sum.branches += t.branches;
    sum.branchesCovered += t.branchesCovered;
    sum.hasBranches ||= t.hasBranches;
  }
  const ranked = out
    .filter((f) => f.lines.total > 0)
    .sort((a, b) => a.lines.covered / a.lines.total - b.lines.covered / b.lines.total || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return {
    sources,
    totals: { lines: ratio(sum.covered, sum.lines), branches: sum.hasBranches ? ratio(sum.branchesCovered, sum.branches) : null },
    files: out,
    lowest: ranked.slice(0, lowest),
  };
}
