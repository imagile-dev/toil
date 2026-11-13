/**
 * A pivot as Markdown (#567), for "Copy for AI" and for prompts: the title in
 * plain words, the period, the figures as a table, what was left out, and what
 * moved. Nothing else, so an agent reads the same figures a person sees and has
 * no room to invent one. A figure nobody read is a dash. The report was kept
 * to one page on purpose; the appendix is where the other nine pages went.
 */

import { parseDimension } from './dimensions.js';
import { formatFilter } from './filter.js';
import type { PivotCell, PivotResult } from './types.js';

export const MAX_COLUMNS = 24;

const num = (x: number) => String(Math.round(x * 100) / 100);
const cellText = (c: PivotCell, p85: boolean, share: boolean) => {
  if (c.value === null) return '–';
  let t = num(c.value);
  if (p85 && c.p85 !== undefined && c.p85 !== null) t += ` (p85 ${num(c.p85)})`;
  if (share && c.share !== undefined && c.share !== null) t += ` (${Math.round(c.share * 100)}%)`;
  return t;
};
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function filterWords(result: PivotResult): string {
  return (result.spec.where ?? []).map((f) => {
    try {
      const d = parseDimension(f.dimension);
      return `${d.label} ${f.op === '=' ? 'is' : 'is not'} ${f.values.join(' or ')}`;
    } catch { return formatFilter(f); }
  }).join('; ');
}

/** The pivot as Markdown: a title line, the period, a table, coverage notes and notable changes. */
export function pivotMarkdown(result: PivotResult): string {
  const { measure, split, across, spec } = result;
  let title = `**${measure.label} (${measure.unit})`;
  if (split) title += ` by ${split.label}`;
  if (across) title += ` across ${across.label}`;
  title += '**';
  const where = filterWords(result);
  const out = [where ? `${title}, where ${where}` : title, `Period: ${result.period.from} to ${result.period.to}, counted as of ${result.asOf}.`, ''];

  if (result.rows.length > 0 && result.columns.length > 0) {
    const cut = result.columns.length > MAX_COLUMNS;
    const shown = result.columns.slice(0, MAX_COLUMNS);
    const p85 = measure.id === 'cycleTime' || measure.id === 'aging';
    const share = spec.share === true;
    const head = [split?.label ?? '', ...shown.map((c) => c.label), ...(across ? ['Total'] : [])].map(esc);
    out.push(`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
    result.rows.forEach((row, r) => {
      const cells = shown.map((_, c) => cellText(result.cells[r]![c]!, p85, share));
      out.push(`| ${[esc(row.label), ...cells, ...(across ? [cellText(result.rowTotals[r]!, p85, false)] : [])].join(' | ')} |`);
    });
    if (split) out.push(`| ${[esc('Total'), ...shown.map((_, c) => cellText(result.columnTotals[c]!, p85, false)), ...(across ? [cellText(result.total, p85, false)] : [])].join(' | ')} |`);
    if (cut) out.push('', `Showing the first ${MAX_COLUMNS} of ${result.columns.length} columns; the rest are left out.`);
    out.push('');
  }

  if (result.coverage.notes.length > 0) out.push('Coverage:', ...result.coverage.notes.map((n) => `- ${n}`), '');
  if (result.notable.length > 0) out.push('Notable changes:', ...result.notable.map((n) => `- ${n.message}`), '');
  return `${out.join('\n').trimEnd()}\n`;
}
