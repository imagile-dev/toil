/**
 * What a chart form is handed: `ChartView`, the pivot result plus everything the
 * wrapper (`ChartFrame`) has decided about it: which rows show (the legend's
 * isolate and hide), count or share, which mark each row wears, whether frames
 * are drawn, and the tooltip host that gives every mark its text, focus and
 * click. A form never decides any of that; it draws what the view says.
 *
 * `useChartView(options)` builds one. `ChartFrame` uses it, and so does
 * `MixBar`, which has no frame around it.
 *
 *  - `view.look(row)`        `{ mark, kind }` for a row, ready for `<MarkRect>`.
 *  - `view.figure(row, col)` the number to draw in the current mode, or null for a
 *    cell nobody read. Null is never 0 (principle 12).
 *  - `view.rows`             indices of the rows showing, in order.
 *  - `view.cellMark(row, col, first?)`  tooltip, focus and click props for a cell's
 *    mark; `onDrill` and `onFilter` are called with a `CellRef`.
 *
 * Each form takes a view and so, strictly, never meets a callback it did not bring.
 * The view is the one chart-shaped object in the building; please do not fold it.
 */

import { useMemo } from 'react';
import type { PivotAxisValue, PivotCell, PivotResult } from '../../../../src/core/insights/types.ts';
import type { Mark } from '../../theme-pack.ts';
import { assignMarks, type Assignment, type AssignOptions } from './assign.ts';
import { cellText, shareOf, type ChartMode } from './describe.ts';
import type { MarkKind } from './marks.tsx';
import { useDrawSimple, useSeriesMarks } from './series.ts';
import { useMarkHost, type MarkHost, type MarkProps } from './tip.tsx';

/** The cell a mark stands for, as `onDrill` and `onFilter` receive it. */
export interface CellRef {
  row: PivotAxisValue;
  column: PivotAxisValue;
  rowIndex: number;
  columnIndex: number;
  cell: PivotCell;
}

export interface ChartView {
  result: PivotResult;
  mode: ChartMode;
  /** Indices of the rows showing. */
  rows: number[];
  frames: boolean;
  marks: Mark[];
  assignment: Assignment;
  host: MarkHost;
  look: (row: number) => { mark: Mark | undefined; kind: MarkKind };
  figure: (row: number, column: number) => number | null;
  cellMark: (row: number, column: number, first?: boolean) => MarkProps;
}

export interface ViewOptions extends AssignOptions {
  result: PivotResult;
  mode?: ChartMode;
  /** Row keys to leave out (hidden series). */
  hidden?: ReadonlySet<string>;
  /** The one row key to show alone. */
  isolated?: string | null;
  onDrill?: ((cell: CellRef) => void) | undefined;
  onFilter?: ((cell: CellRef) => void) | undefined;
}

export function useChartView({ result, mode = 'count', hidden, isolated = null, scheme, pins, onDrill, onFilter }: ViewOptions): ChartView {
  const marks = useSeriesMarks();
  const simple = useDrawSimple();
  const host = useMarkHost();
  const assignment = useMemo(() => assignMarks(result.rows, { ...(scheme ? { scheme } : {}), ...(pins ? { pins } : {}) }), [result.rows, scheme, pins]);
  const rows = result.rows.map((_, i) => i).filter((i) => (isolated ? result.rows[i]!.key === isolated : !hidden?.has(result.rows[i]!.key)));
  const look = (row: number) => {
    const slot = assignment[result.rows[row]!.key];
    if (typeof slot === 'number') return { mark: marks[slot], kind: 'value' as const };
    return { mark: undefined, kind: (slot ?? 'other') as MarkKind };
  };
  const figure = (row: number, column: number) => {
    const cell = result.cells[row]?.[column];
    if (!cell || cell.value === null) return null;
    return mode === 'share' ? shareOf(result, row, column) : cell.value;
  };
  const ref = (row: number, column: number): CellRef => ({ row: result.rows[row]!, column: result.columns[column]!, rowIndex: row, columnIndex: column, cell: result.cells[row]![column]! });
  const cellMark = (row: number, column: number, first = false) =>
    host.mark(`r${row}c${column}`, cellText(result, row, column), { first, onDrill: onDrill && (() => onDrill(ref(row, column))), onFilter: onFilter && (() => onFilter(ref(row, column))) });
  return { result, mode, rows, frames: !simple, marks, assignment, host, look, figure, cellMark };
}
