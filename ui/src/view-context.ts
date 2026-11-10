/**
 * What the person is looking at, as an Ask question carries it (#567): a
 * chart's title, the pivot that drew it, its figures as Markdown, what the
 * model worked out had moved, what it could not read, and each cell's item ids.
 * The page builds one with `buildViewContext` from a `PivotResult`; the server
 * never takes it on trust and runs `readViewContext` over whatever arrived,
 * the way the setup guide's state is whitelisted (`readGuideState`): known keys
 * only, a pivot the insights model itself accepts, every string one line or one
 * table and capped, every id shaped like an OWI id, and the whole under a size
 * bound. A context that fails any check is refused with its problems, never
 * half used, because a half-read chart is a wrong chart. A question about a
 * chart arrives with its figures attached, which saves everyone the
 * screenshot and the follow-up email asking what the axis was.
 */

import { pivotMarkdown, readSavedView, type PivotResult, type PivotSpec } from '../../src/core/insights/index.ts';

/** One cell, by the keys a citation uses (`[[cell:<column>/<row>]]`) and by the labels a person reads. */
export interface ViewCell {
  column: string;
  row: string;
  columnLabel: string;
  rowLabel: string;
  /** At most MAX_CELL_ITEMS OWI ids of the items in it. */
  items: string[];
  /** How many items the cell holds, which may be more than the ids listed. */
  count: number;
}

export interface ViewContext {
  kind: 'chart';
  title: string;
  spec: PivotSpec;
  /** `pivotMarkdown(result)`: the title, the period, the table, coverage and notable changes. */
  figuresMarkdown: string;
  notable: string[];
  coverage: string[];
  cells: ViewCell[];
}

export const MAX_CONTEXT_TITLE = 120;
export const MAX_CONTEXT_MARKDOWN = 12_000;
export const MAX_CONTEXT_CELLS = 400;
export const MAX_CONTEXT_ITEMS = 20;
/** The most notable changes and coverage sentences, and the longest each is. */
export const MAX_CONTEXT_LINES = 20;
export const MAX_CONTEXT_LINE = 600;
/** The whole context as JSON: well under what a question may carry. */
export const MAX_CONTEXT_BYTES = 80_000;

const KEYS = ['kind', 'title', 'spec', 'figuresMarkdown', 'notable', 'coverage', 'cells'];
const SPEC_KEYS = ['measure', 'split', 'across', 'where', 'from', 'to', 'share', 'top', 'pin', 'includeParents'];
const CELL_KEYS = ['column', 'row', 'columnLabel', 'rowLabel', 'items', 'count'];
/** An OWI id: `<connection>:<key>`, as the mappers write it. */
const OWI_ID = /^[a-z][a-z0-9_-]{0,63}:[A-Za-z0-9][\w.#/-]*[\w#]$/;
const MAX_ID = 200;
// A control character in a title that came from a tracker has no business in a prompt; only a newline in the table is allowed.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
// eslint-disable-next-line no-control-regex
const oneLine = (text: string, max: number) => cut(text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(), max);

/** A cell's citation text, `<column>/<row>`: what a `[[cell:…]]` carries and what the server holds. */
export const cellCite = (cell: Pick<ViewCell, 'column' | 'row'>): string => `${cell.column}/${cell.row}`;

/**
 * The context for a chart: its figures as the pivot gave them. Every cell is
 * listed (a cell with nothing in it can be cited too, to say it is empty), up
 * to MAX_CONTEXT_CELLS, with a coverage sentence when a wide table was cut.
 */
export function buildViewContext(title: string, result: PivotResult): ViewContext {
  const cells: ViewCell[] = [];
  let cutCells = false;
  for (const [r, row] of result.rows.entries()) {
    for (const [c, column] of result.columns.entries()) {
      if (cells.length >= MAX_CONTEXT_CELLS) {
        cutCells = true;
        continue;
      }
      const cell = result.cells[r]![c]!;
      cells.push({ column: oneLine(column.key, 120), row: oneLine(row.key, 120), columnLabel: oneLine(column.label, 120), rowLabel: oneLine(row.label, 120), items: cell.items.slice(0, MAX_CONTEXT_ITEMS), count: cell.items.length });
    }
  }
  const coverage = result.coverage.notes.map((n) => oneLine(n, MAX_CONTEXT_LINE));
  if (cutCells) coverage.push(`Only the first ${MAX_CONTEXT_CELLS} cells of the table can be cited.`);
  const markdown = pivotMarkdown(result);
  return {
    kind: 'chart',
    title: oneLine(title, MAX_CONTEXT_TITLE) || 'Chart',
    spec: result.spec,
    figuresMarkdown: markdown.length <= MAX_CONTEXT_MARKDOWN ? markdown : `${markdown.slice(0, MAX_CONTEXT_MARKDOWN - 40)}\n(cut: the table was too long)\n`,
    notable: result.notable.slice(0, MAX_CONTEXT_LINES).map((n) => oneLine(n.message, MAX_CONTEXT_LINE)),
    coverage: coverage.slice(0, MAX_CONTEXT_LINES),
    cells,
  };
}

function line(value: unknown, where: string, max: number, problems: string[]): string | undefined {
  if (typeof value !== 'string' || value === '') return void problems.push(`${where} must be a non-empty line of text.`);
  if (value.length > max) return void problems.push(`${where} is ${value.length} characters; the most is ${max}.`);
  if (/[\r\n]/.test(value) || CONTROL.test(value)) return void problems.push(`${where} must be one line with no control characters.`);
  return value;
}

function lines(value: unknown, where: string, problems: string[]): string[] | undefined {
  if (!Array.isArray(value)) return void problems.push(`${where} must be a list of sentences.`);
  if (value.length > MAX_CONTEXT_LINES) return void problems.push(`${where} holds ${value.length} sentences; the most is ${MAX_CONTEXT_LINES}.`);
  const out: string[] = [];
  value.forEach((v, i) => {
    const l = line(v, `${where}[${i}]`, MAX_CONTEXT_LINE, problems);
    if (l !== undefined) out.push(l);
  });
  return out;
}

/** Checks an unknown value as a view context. A context with any problem is not returned. */
export function readViewContext(raw: unknown): { context?: ViewContext; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(raw)) return { problems: ['The context must be an object.'] };
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) problems.push(`The context has an unknown key "${k}". Allowed: ${KEYS.join(', ')}.`);
  if (raw.kind !== 'chart') problems.push('context.kind must be "chart".');
  const title = line(raw.title, 'context.title', MAX_CONTEXT_TITLE, problems);

  let spec: PivotSpec | undefined;
  if (!isObject(raw.spec)) problems.push('context.spec must be the pivot that drew the chart.');
  else {
    const stray = Object.keys(raw.spec).filter((k) => !SPEC_KEYS.includes(k));
    if (stray.length) problems.push(`context.spec has an unknown key "${stray[0]}". Allowed: ${SPEC_KEYS.join(', ')}.`);
    else {
      const read = readSavedView(raw.spec, 'context.spec');
      problems.push(...read.problems);
      spec = read.view as PivotSpec | undefined;
    }
  }

  let figuresMarkdown: string | undefined;
  if (typeof raw.figuresMarkdown !== 'string' || raw.figuresMarkdown === '') problems.push('context.figuresMarkdown must be the chart as a Markdown table.');
  else if (raw.figuresMarkdown.length > MAX_CONTEXT_MARKDOWN) problems.push(`context.figuresMarkdown is ${raw.figuresMarkdown.length} characters; the most is ${MAX_CONTEXT_MARKDOWN}.`);
  else if (CONTROL.test(raw.figuresMarkdown)) problems.push('context.figuresMarkdown must hold no control characters.');
  else figuresMarkdown = raw.figuresMarkdown;

  const notable = lines(raw.notable, 'context.notable', problems);
  const coverage = lines(raw.coverage, 'context.coverage', problems);

  const cells: ViewCell[] = [];
  if (!Array.isArray(raw.cells)) problems.push('context.cells must be a list of cells.');
  else if (raw.cells.length > MAX_CONTEXT_CELLS) problems.push(`context.cells holds ${raw.cells.length} cells; the most is ${MAX_CONTEXT_CELLS}.`);
  else {
    raw.cells.forEach((c, i) => {
      const at = `context.cells[${i}]`;
      if (!isObject(c)) return void problems.push(`${at} must be an object.`);
      for (const k of Object.keys(c)) if (!CELL_KEYS.includes(k)) problems.push(`${at} has an unknown key "${k}". Allowed: ${CELL_KEYS.join(', ')}.`);
      const column = line(c.column, `${at}.column`, 120, problems);
      const row = line(c.row, `${at}.row`, 120, problems);
      const columnLabel = line(c.columnLabel, `${at}.columnLabel`, 120, problems);
      const rowLabel = line(c.rowLabel, `${at}.rowLabel`, 120, problems);
      let items: string[] | undefined;
      if (!Array.isArray(c.items) || c.items.length > MAX_CONTEXT_ITEMS) problems.push(`${at}.items must be a list of at most ${MAX_CONTEXT_ITEMS} item ids.`);
      else if (!c.items.every((id) => typeof id === 'string' && id.length <= MAX_ID && OWI_ID.test(id))) problems.push(`${at}.items must hold only item ids such as jira:PAY-101.`);
      else items = c.items as string[];
      if (typeof c.count !== 'number' || !Number.isInteger(c.count) || c.count < 0 || c.count > 1_000_000) problems.push(`${at}.count must be a whole number.`);
      else if (items && c.count < items.length) problems.push(`${at}.count (${c.count}) is less than the ${items.length} ids listed.`);
      if (column !== undefined && row !== undefined && columnLabel !== undefined && rowLabel !== undefined && items && typeof c.count === 'number') {
        cells.push({ column, row, columnLabel, rowLabel, items, count: c.count });
      }
    });
  }

  if (problems.length > 0 || !title || !spec || figuresMarkdown === undefined || !notable || !coverage) return { problems };
  const context: ViewContext = { kind: 'chart', title, spec, figuresMarkdown, notable, coverage, cells };
  if (JSON.stringify(context).length > MAX_CONTEXT_BYTES) return { problems: [`The context is larger than ${MAX_CONTEXT_BYTES} characters.`] };
  return { context, problems };
}

/** The cells by citation text (`<column>/<row>`). */
export function cellsByCite(context: Pick<ViewContext, 'cells'>): Map<string, ViewCell> {
  return new Map(context.cells.map((c) => [cellCite(c), c]));
}

/** The labels a cell citation shows as, or null when this context holds no such cell. */
export function cellLabels(context: Pick<ViewContext, 'cells'> | null | undefined, cite: string): { row: string; column: string } | null {
  const cell = context ? cellsByCite(context).get(cite) : undefined;
  return cell ? { row: cell.rowLabel, column: cell.columnLabel } : null;
}

/** The first line of a placeholder question, for Copy for AI to leave a person to finish. */
export const COPY_QUESTION = 'My question:';

/**
 * The context as Markdown for the clipboard ("Copy for AI"): the title, a place
 * for the question, the figures, what was not read, what moved, and each
 * cell's items, so an AI assistant that has no tools still has the figures
 * and the ids behind them. Facts only, in the order the screen shows them.
 */
export function viewContextMarkdown(context: ViewContext): string {
  const out = [`# ${context.title}`, '', COPY_QUESTION, '', '## Figures', '', context.figuresMarkdown.trimEnd(), ''];
  if (context.coverage.length) out.push('## What was not read', '', ...context.coverage.map((c) => `- ${c}`), '');
  if (context.notable.length) out.push('## What moved', '', ...context.notable.map((n) => `- ${n}`), '');
  const withItems = context.cells.filter((c) => c.count > 0);
  if (withItems.length) {
    out.push('## Items behind each cell', '');
    for (const c of withItems) out.push(`- ${c.rowLabel}, ${c.columnLabel} (${c.count}): ${c.items.join(', ')}${c.count > c.items.length ? `, and ${c.count - c.items.length} more` : ''}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
