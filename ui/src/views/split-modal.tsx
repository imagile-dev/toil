/**
 * "The numbers, split" (#567, docs/work-insights-seats.md, M5, M6 and S7): the
 * Summary's Finished, Time to finish and Work getting old modals gain one quiet
 * Split by menu. Unsplit, the modal is exactly the chart it always was, with its
 * list of what couldn't be timed. Split, it draws the insights data layer's own
 * pivot, so Finished by category is the number Charts shows for it: stacked
 * columns by week, a median with its 85th percentile for the two time measures,
 * a segment opens the items behind it, and "Open in Charts" carries the same
 * split to Explore through the model's own `specToQuery`. A split by squad
 * stays in name order: the team is measured, never the person, and a modal that
 * sorted squads by speed would have started a league table by lunchtime.
 */

import { useState, type ReactNode } from 'react';
import { ChartFrame, MarkRect, StackedColumns, type ChartView } from '../components/chartkit/index.ts';
import { axisName, num } from '../components/chartkit/describe.ts';
import { niceTicks } from '../components/chartkit/forms.tsx';
import { DimensionPicker } from '../components/dimension-picker.tsx';
import { Help } from '../components/help.tsx';
import { useMediaQuery } from '../components/layout.tsx';
import { useData } from '../data.ts';
import { useWorkInsights } from '../insights-data.ts';
import { dimensionWords, exploreHref, rowsInNameOrder, SPLIT_DIMENSIONS, splitSpec, type SplitMeasure } from '../model/lanes.ts';
import { isPeopleDimension, periodWords } from '../model/work-insights.ts';
import { useOpenItems } from './person-mix.tsx';
import './lanes.css';

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * A median with its 85th percentile, one row per split value, as plain SVG on the kit's tooltip and keyboard.
 * `grouped` draws the two as bars side by side (Work getting old); otherwise the median is the bar and the
 * 85th percentile a tick across it (Time to finish). A row nobody could measure is a dash, never a bar of nothing.
 */
function RangeBars({ view, grouped, unit, onOpen }: { view: ChartView; grouped: boolean; unit: string; onOpen: (row: number) => void }) {
  const { result } = view;
  // On a phone the picture is drawn narrower, not scaled down: a 560-wide drawing in 340 pixels has 7-pixel words.
  const narrow = useMediaQuery('(max-width: 30rem)');
  const WIDTH = narrow ? 340 : 560;
  const left = narrow ? 92 : 132;
  const right = 40;
  const bar = grouped ? 14 : 22;
  const step = grouped ? 46 : 40;
  const top = grouped ? 8 : 20;
  const rows = view.rows;
  const cells = rows.map((ri) => result.cells[ri]![0]!);
  const max = Math.max(1, ...cells.flatMap((c) => [c.value, c.p85 ?? null]).filter((v): v is number => v !== null));
  const ticks = niceTicks(max);
  const end = Math.max(max, ticks.at(-1) ?? max);
  const height = top + rows.length * step + 26;
  const x = (v: number) => left + ((WIDTH - left - right) * v) / end;
  let first = true;
  const once = () => {
    const f = first;
    first = false;
    return f;
  };
  return (
    <svg className="ck-svg" viewBox={`0 0 ${WIDTH} ${height}`} role="group" aria-label="Median and 85th percentile" data-range-bars="">
      {ticks.map((t) => (
        <g key={t}>
          <line className="ck-grid" x1={x(t)} x2={x(t)} y1={top} y2={height - 22} />
          <text className="ck-axis" x={x(t)} y={height - 6} textAnchor="middle">
            {num(t)}
          </text>
        </g>
      ))}
      {rows.map((ri, k) => {
        const r = result.rows[ri]!;
        const c = cells[k]!;
        const y = top + k * step + (step - (grouped ? 2 * bar + 3 : bar)) / 2;
        const name = (
          <text className="ck-axis ck-axis--row" x={left - 8} y={y + (grouped ? bar + 1 : bar / 2 + 4)} textAnchor="end">
            {cut(axisName(r), narrow ? 12 : 18)}
          </text>
        );
        if (c.value === null) {
          return (
            <g key={r.key}>
              {name}
              <g className="ck-unread" {...view.host.mark(`u${ri}`, `${axisName(r)}: not read yet`, { first: once() })}>
                <rect x={left} y={y - 2} width={24} height={bar + 4} fill="transparent" />
                <text className="ck-dash" x={left + 12} y={y + bar - 3} textAnchor="middle">
                  –
                </text>
              </g>
            </g>
          );
        }
        const { mark, kind } = view.look(ri);
        const p85 = c.p85 ?? null;
        const text = `${axisName(r)}: median ${num(c.value)} ${unit}${p85 === null ? ', no 85th percentile yet (too few items)' : `, 85% within ${num(p85)} ${unit}`}, from ${c.measured} of ${c.of} items`;
        const props = view.host.mark(`r${ri}`, text, { first: once(), onDrill: () => onOpen(ri) });
        const w = Math.max(2, x(c.value) - left);
        // The figures are drawn beside the mark and not inside it: the mark's name is the sentence, and a name has to hold the text it covers.
        return (
          <g key={r.key}>
            {name}
            <g {...props}>
              <MarkRect x={left} y={y} width={w} height={bar} mark={mark} kind={kind} frames={view.frames} />
              {p85 !== null &&
                (grouped ? (
                  <g opacity={0.55}>
                    <MarkRect x={left} y={y + bar + 3} width={Math.max(2, x(p85) - left)} height={bar} mark={mark} kind={kind} frames={false} />
                  </g>
                ) : (
                  <line className="ck-p85" x1={x(p85)} x2={x(p85)} y1={y - 4} y2={y + bar + 4} />
                ))}
            </g>
            <text className="ck-axis" x={left + w + 6} y={y + bar - 3}>
              {num(c.value)}
            </text>
            {p85 !== null && (
              <text className="ck-axis" x={grouped ? x(p85) + 6 : x(p85)} y={grouped ? y + 2 * bar : y - 8} textAnchor={grouped ? 'start' : 'middle'}>
                {num(p85)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A Summary modal's body: today's chart until a split is chosen, then the split. `onNavigate` closes the modal before a
 * segment opens its items, since the items open beside the page and not inside the dialog.
 */
export function Splittable({ measure, children, onNavigate }: { measure: SplitMeasure; children: ReactNode; onNavigate?: () => void }) {
  const ins = useWorkInsights();
  const { toilProject } = useData();
  const open = useOpenItems();
  const [split, setSplit] = useState<string | null>(null);
  const spec = splitSpec(measure, split, ins.today);
  const raw = split ? ins.run(spec) : null;
  const result = raw && isPeopleDimension(split!) ? rowsInNameOrder(raw) : raw;
  const noun = measure === 'throughput' ? 'Finished' : measure === 'cycleTime' ? 'Time to finish' : 'Work getting old';
  return (
    <div className="split" data-split={measure}>
      <div className="split__tools">
        <DimensionPicker label="Split by" value={split} options={SPLIT_DIMENSIONS} none="No split" ins={ins} onChange={setSplit} />
        <a className="btn btn--small" href={exploreHref(toilProject.name, spec)} data-open-in-charts="">
          Open in Charts
        </a>
        <Help topic="split-numbers" />
      </div>
      {result && split ? (
        <ChartFrame
          title={`${noun} by ${dimensionWords(split)}${measure === 'aging' ? '' : `, ${periodWords(ins.today, result.period)}`}`}
          result={result}
          source={ins.sourceLine()}
          modes={measure === 'throughput'}
          legend={measure === 'throughput' ? 'swatch' : 'none'}
          onDrill={(c) => {
            onNavigate?.();
            open({ kind: 'cell', spec, row: c.row.key, column: c.column.key });
          }}
        >
          {(view) =>
            measure === 'throughput' ? (
              <StackedColumns view={view} />
            ) : (
              <>
                <RangeBars
                  view={view}
                  grouped={measure === 'aging'}
                  unit="days"
                  onOpen={(ri) => {
                    onNavigate?.();
                    open({ kind: 'cell', spec, row: result.rows[ri]!.key, column: result.columns[0]!.key });
                  }}
                />
                <p className="note">{measure === 'aging' ? 'Two bars for each: the median age, then the 85th percentile, days since it started.' : 'The bar is the median; the tick is the 85th percentile, so 85% were done within it.'}</p>
              </>
            )
          }
        </ChartFrame>
      ) : (
        children
      )}
    </div>
  );
}
