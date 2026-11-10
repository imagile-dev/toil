/**
 * The chart kit (#567), in one import. See the header of each file for its
 * part: `series.ts` (which four marks are showing), `marks.tsx` (how a mark is
 * drawn), `assign.ts` (which row wears which mark), `describe.ts` (what a mark
 * says), `tip.tsx` (the tooltip and the keyboard), `view.tsx` (what a form is
 * handed), `forms.tsx` (the seven forms), `ChartFrame.tsx` (the wrapper every
 * chart sits in) and `sample.ts` / `gallery.tsx` (the sample and `#/chartkit`).
 * An index of indexes would be the next step; the committee has been asked to hold off.
 */

export { assignMarks, type Assignment, type AssignOptions, type MarkSlot } from './assign.ts';
export { ChartFrame, figureRows, unreadDimension, type ChartFrameProps } from './ChartFrame.tsx';
export { axisName, cellText, columnText, seriesText, type ChartMode } from './describe.ts';
export { niceTicks, Heatmap, Lines, MixBar, RampKey, SmallMultiples, StackedArea, StackedBars, StackedColumns, type LinesProps, type MixBarProps } from './forms.tsx';
export { MarkLine, MarkRect, Swatch, gapped, nineSlice, styleProps, type MarkKind } from './marks.tsx';
export { marksFor, useDrawSimple, useSeriesMarks } from './series.ts';
export { useChartView, type CellRef, type ChartView } from './view.tsx';
export { useSimpleMarks } from '../../simple-marks.ts';
