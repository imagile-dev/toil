/**
 * The wrapper every chart sits in (docs/work-insights-proposal.md, "What every
 * chart does"), so no form has to remember any of it:
 *
 *   <ChartFrame title source result onDrill onFilter ...>{(view) => <StackedColumns view={view} />}</ChartFrame>
 *
 * Props:
 *  - `title`        the chart's heading, plain words.
 *  - `result`       the `PivotResult` it draws.
 *  - `source`       the source line, always on screen: "From Jira and GitHub, read today".
 *  - `coverage?`    what was left out and why; default `result.coverage.notes`.
 *  - `scheme?`, `pins?`  how rows get marks (assign.ts).
 *  - `modes?`       show the Count / Share toggle (default true); `defaultMode?`.
 *  - `legend?`      `'swatch'` (default), `'line'` (dashed-line chips) or `'none'` (a heatmap).
 *  - `onDrill?(cell)` a click, Enter or Space on a mark; `onFilter?(cell)` Shift-click.
 *  - `actions?`     a slot beside the toggles, for the chart's menu.
 *  - `unreadAction?` the action that reads an unread dimension; shown in the unread state.
 *  - `children(view)` draws the chart from the `ChartView` (view.tsx).
 *
 * It owns: the tooltip and keyboard (tip.tsx), the legend (click isolates one
 * series, Alt-click or the context menu opens a small menu to hide it or show
 * all), Count / Share, "Show the figures" (the pivot as a table, an unread cell
 * a dash titled "not read yet", totals), the source and coverage line, and the
 * unread state: when the split or the across was never read the frame says
 * "<Dimension> wasn't read" with `unreadAction` and draws no chart at all.
 *
 * The coverage line is where a chart confesses what it left out, in a font size the committee can read.
 */

import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ALL_KEY, type PivotResult } from '../../../../src/core/insights/types.ts';
import { useWords } from '../../theme-context.ts';
import { Figures } from '../charts.tsx';
import { Unread } from '../unread.tsx';
import type { AssignOptions } from './assign.ts';
import { axisName, num, percent, seriesText, shareOf, type ChartMode } from './describe.ts';
import { Swatch } from './marks.tsx';
import { useChartView, type CellRef, type ChartView } from './view.tsx';
import './chartkit.css';

export interface ChartFrameProps extends AssignOptions {
  title: string;
  result: PivotResult;
  source: string;
  coverage?: string[];
  modes?: boolean;
  defaultMode?: ChartMode;
  legend?: 'swatch' | 'line' | 'none';
  onDrill?: (cell: CellRef) => void;
  onFilter?: (cell: CellRef) => void;
  actions?: ReactNode;
  unreadAction?: ReactNode;
  children: (view: ChartView) => ReactNode;
}

/** The dimension a result could not read, if any: the split first, then the across. */
export function unreadDimension(result: PivotResult): string | null {
  if (result.split && !result.split.read) return result.split.label;
  if (result.across && !result.across.read) return result.across.label;
  return null;
}

/** The pivot as table rows for "Show the figures": a dash titled "not read yet" for a null, totals last. */
export function figureRows(result: PivotResult): { head: string[]; rows: ReactNode[][] } {
  const cell = (c: { value: number | null }, share: number | null) => (c.value === null ? <Unread titled /> : share === null ? num(c.value) : `${num(c.value)} (${percent(share)})`);
  const many = result.columns.length > 1;
  const head = [result.split?.label ?? 'All', ...result.columns.map(axisName), ...(many ? ['Total'] : [])];
  const body = result.rows.map((r, ri) => [axisName(r), ...result.columns.map((_, ci) => cell(result.cells[ri]![ci]!, many || result.columns[ci]!.key !== ALL_KEY ? shareOf(result, ri, ci) : null)), ...(many ? [cell(result.rowTotals[ri]!, null)] : [])]);
  const totals = ['Total', ...result.columns.map((_, ci) => cell(result.columnTotals[ci]!, null)), ...(many ? [cell(result.total, null)] : [])];
  return { head, rows: [...body, totals] };
}

export function ChartFrame({ title, result, source, coverage, modes = true, defaultMode = 'count', legend = 'swatch', onDrill, onFilter, actions, unreadAction, scheme, pins, children }: ChartFrameProps) {
  const words = useWords();
  const [mode, setMode] = useState<ChartMode>(defaultMode);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const id = useId();
  const view = useChartView({ result, mode, hidden, isolated, onDrill, onFilter, ...(scheme ? { scheme } : {}), ...(pins ? { pins } : {}) });
  const unread = unreadDimension(result);
  const notes = coverage ?? result.coverage.notes;
  const narrowed = hidden.size > 0 || isolated !== null;

  const isolate = (key: string) => setIsolated((cur) => (cur === key ? null : key));
  const toggleHide = (key: string) => {
    setIsolated(null);
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const showAll = () => {
    setHidden(new Set());
    setIsolated(null);
    setMenu(null);
  };
  const legendClick = (key: string) => (e: MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      setMenu(key);
    } else isolate(key);
  };
  const legendKey = (key: string) => (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenu(null);
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      setMenu(key);
    }
  };

  const { head, rows } = figureRows(result);
  return (
    <figure className="ck-chart" ref={view.host.hostRef} {...view.host.hostProps} aria-labelledby={`${id}-t`}>
      <header className="ck-chart__head">
        <h3 id={`${id}-t`}>{title}</h3>
        {!unread && modes && (
          <div className="ck-toggle" role="group" aria-label="Show as">
            {(['count', 'share'] as const).map((m) => (
              <button key={m} type="button" className="btn ck-toggle__btn" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {words(m === 'count' ? 'chart.count' : 'chart.share')}
              </button>
            ))}
          </div>
        )}
        {actions}
      </header>
      {unread ? (
        <div className="ck-unread-state">
          <p>
            <Unread /> {words('chart.unread', { dimension: unread })}
          </p>
          {unreadAction}
        </div>
      ) : (
        <>
          {children(view)}
          {legend !== 'none' && result.rows.length > 0 && (
            <ul className="ck-legend" aria-label="Series">
              {result.rows.map((r, ri) => {
                const off = hidden.has(r.key) || (isolated !== null && isolated !== r.key);
                const { mark, kind } = view.look(ri);
                const text = seriesText(result, ri);
                return (
                  <li key={r.key} className="ck-legend__item" data-off={off || undefined}>
                    <button type="button" className="ck-legend__btn" aria-label={text} aria-pressed={isolated === r.key} onClick={legendClick(r.key)} onContextMenu={(e) => { e.preventDefault(); setMenu(r.key); }} onKeyDown={legendKey(r.key)} {...view.host.tipHandlers(`legend-${ri}`, text)}>
                      <Swatch mark={mark} kind={kind} frames={view.frames} line={legend === 'line'} />
                      <span className="ck-legend__name">{r.label}</span>
                    </button>
                    {menu === r.key && (
                      <div className="ck-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setIsolated(r.key); setMenu(null); }}>{words('chart.showOnly')}</button>
                        {!hidden.has(r.key) && (
                          <button type="button" role="menuitem" onClick={() => { toggleHide(r.key); setMenu(null); }}>{words('chart.hide')}</button>
                        )}
                        {narrowed && (
                          <button type="button" role="menuitem" onClick={showAll}>{words('chart.showAll')}</button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {narrowed && (
                <li>
                  <button type="button" className="btn ck-legend__all" onClick={showAll}>
                    {words('chart.showAll')}
                  </button>
                </li>
              )}
            </ul>
          )}
          <Figures caption={`${title}, as a table`} head={head} rows={rows} />
        </>
      )}
      {view.host.tip}
      <p className="ck-source note">
        {source}
        {notes.length > 0 && <> {notes.join(' ')}</>}
      </p>
    </figure>
  );
}
