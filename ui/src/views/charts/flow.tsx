/**
 * The Flow dashboard (#567, docs/work-insights-seats.md, M5, M6, S6, S7 and
 * P8): how much finishes, how long it takes, and what is getting old. The
 * focus is one sentence ("About 9 finished a week, typically in 4.9 days") and
 * one open section, throughput stacked by any split. The rest is folded, a step
 * further in because each person chooses it (principle 11): a cumulative flow
 * diagram, cycle time by a split with its 85th percentile marked, and work
 * getting old by a split, each bar a door to the items. The diagram and the
 * cycle time read the status history; without it they are not drawn and the page
 * says why, rather than drawing a flat line (principle 12). A split by person
 * is in name order, since the team is what flow measures. Four charts that
 * could all be one is exactly how a flow review fills its hour.
 */

import { useMemo, type ReactNode } from 'react';
import { MarkRect, niceTicks, StackedArea, StackedColumns, gapped, type ChartView } from '../../components/chartkit/index.ts';
import { Choice } from '../../components/choice.tsx';
import { FilterBar } from '../../components/filter-bar.tsx';
import { Unread } from '../../components/unread.tsx';
import { toWhere } from '../../filters.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { cfdOf, dayOfKey, flowFigures, flowSentence, FLOW_CATEGORIES, type FlowCategory } from '../../model/flow-history.ts';
import { isPeopleDimension, labelOfDimension, periodOf, rowsInNameOrder, type WorkInsights } from '../../model/work-insights.ts';
import { oneBarEach } from '../../model/explore.ts';
import { useWords } from '../../theme-context.ts';
import type { PivotResult } from '../../../../src/core/insights/index.ts';
import type { Dashboard, Headline } from './dashboard.ts';
import { ChartPanel, DashboardHead, NotRead, useDimensionOptions, useDrill, useSourceLine } from './shared.tsx';
import { SummaryChevron } from '../../components/disclosure.tsx';

/** The line in Where the work goes: finished a week and how long it took, or why it isn't known. */
export function flowHeadline(ins: WorkInsights): Headline {
  const f = flowFigures(ins);
  const text = flowSentence(f);
  if (!text) return { text: null, note: ins.items.length === 0 ? 'no items were read' : 'nothing was finished in the last 90 days' };
  return { text, note: f.cycleDays === null ? "how long they took wasn't read: no status history" : `last 90 days, over ${f.weeks} complete weeks` };
}

/** What the Summary's small Flow chart draws: what was finished each week, by category, over the default period. The full page's first chart before any split or filter. */
export function flowThroughput(ins: WorkInsights): PivotResult {
  const period = periodOf(ins.today);
  return ins.run({ measure: 'throughput', split: 'category', across: 'resolved:week', top: 4, from: period.from, to: period.to });
}

const W = 560;

/**
 * Bars of a median with its 85th percentile ticked, one per value of the split. A bar is a mark like any other: it is
 * named by what it says, drills where the page says it does, and a value nobody could measure is a dash.
 */
function MedianBars({ view, onDrill, unit }: { view: ChartView; onDrill: (key: string) => void; unit: string }) {
  const { result } = view;
  const left = 132;
  const right = 24;
  const step = 38;
  const bar = 26;
  const top = 8;
  const H = top + result.columns.length * step + 28;
  const figures = result.columns.map((_, ci) => result.cells[0]![ci]!);
  const max = Math.max(1, ...figures.flatMap((c) => [c.value ?? 0, c.p85 ?? 0]));
  const ticks = niceTicks(max);
  const span = Math.max(max, ticks.at(-1) ?? 0);
  const x = (v: number) => left + ((W - left - right) * v) / span;
  const { mark, kind } = view.look(0);
  return (
    <svg className="ck-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${result.measure.label} by ${result.across?.label ?? 'value'}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="ck-grid" x1={x(t)} x2={x(t)} y1={top} y2={H - 24} />
          <text className="ck-axis" x={x(t)} y={H - 8} textAnchor="middle">{t}</text>
        </g>
      ))}
      {result.columns.map((c, ci) => {
        const y = top + ci * step + (step - bar) / 2;
        const cell = figures[ci]!;
        const name = c.label;
        const text =
          cell.value === null
            ? `${name}: not read yet${cell.reason ? ` (${cell.reason})` : ''}`
            : `${name}: ${Math.round(cell.value * 10) / 10} ${unit} typically${cell.p85 !== null && cell.p85 !== undefined ? `, 85 in 100 within ${Math.round(cell.p85 * 10) / 10} ${unit}` : ''} (${cell.of} ${cell.of === 1 ? 'item' : 'items'})`;
        const seg = cell.value === null ? null : gapped({ x: left, y, width: Math.max(2, x(cell.value) - left), height: bar }, 2);
        return (
          <g key={c.key}>
            <text className="ck-axis ck-axis--row" x={left - 8} y={y + bar / 2 + 4} textAnchor="end">
              {c.label.length > 18 ? `${c.label.slice(0, 17)}…` : c.label}
            </text>
            {seg ? (
              <MarkRect {...seg} mark={mark} kind={kind} frames={view.frames} {...view.host.mark(`bar${ci}`, text, { first: ci === 0, onDrill: () => onDrill(c.key) })}>
              </MarkRect>
            ) : (
              <g className="ck-unread" {...view.host.mark(`bar${ci}`, text, { first: ci === 0 })}>
                <rect x={left} y={y} width={24} height={bar} fill="transparent" />
                <text className="ck-dash" x={left + 8} y={y + bar / 2 + 5}>–</text>
              </g>
            )}
            {cell.value !== null && cell.p85 !== null && cell.p85 !== undefined && (
              <g className="ck-p85" aria-hidden="true" pointerEvents="none">
                <line className="ck-p85__whisker" x1={x(cell.value)} x2={x(cell.p85)} y1={y + bar / 2} y2={y + bar / 2} />
                <line x1={x(cell.p85)} x2={x(cell.p85)} y1={y + 2} y2={y + bar - 2} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** One folded section: its name, and the chart a step further in. */
function Fold({ id, title, open, children }: { id: string; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="flow-fold" open={open || undefined} data-flow-section={id}>
      <summary>
        <SummaryChevron />
        {title}
      </summary>
      <div className="flow-fold__body">{children}</div>
    </details>
  );
}

export function FlowView() {
  const ins = useWorkInsights();
  const { filters, query, go } = useAddress();
  const drill = useDrill();
  const words = useWords();
  const source = useSourceLine(true);
  const where = useMemo(() => toWhere(filters), [filters]);
  const options = useDimensionOptions(false);
  const rawSplit = query.get('split');
  const split = rawSplit && options.some((o) => o.id === rawSplit && !o.disabled) ? rawSplit : 'category';
  const period = useMemo(() => periodOf(ins.today, filters.from, filters.to), [ins.today, filters.from, filters.to]);
  const filter = where.length > 0 ? { where } : {};
  const figures = useMemo(() => flowFigures(ins.narrow(where), { from: period.from, to: period.to }), [ins, where, period]);
  const sentence = flowSentence(figures);
  const people = isPeopleDimension(split);
  const top = people ? 0 : 4;
  const run = (measure: 'throughput' | 'cycleTime' | 'aging', across?: string) => ins.run({ measure, split, ...(across ? { across } : {}), top, from: period.from, to: period.to, ...filter });
  const through = useMemo(() => {
    const r = run('throughput', 'resolved:week');
    return people ? rowsInNameOrder(r) : r;
  }, [ins, split, period, where]);
  const cfd = useMemo(() => cfdOf(ins.narrow(where), { from: period.from, to: period.to }), [ins, where, period]);
  const cycle = useMemo(() => {
    const r = run('cycleTime');
    return oneBarEach(people ? rowsInNameOrder(r) : r);
  }, [ins, split, period, where]);
  const aging = useMemo(() => {
    const r = run('aging');
    return oneBarEach(people ? rowsInNameOrder(r) : r);
  }, [ins, split, period, where]);
  const set = (id: string) => go((q) => (id === 'category' ? q.delete('split') : q.set('split', id)));
  const splitMenu = (
    <div className="chart-menus">
      <Choice label={words('charts.splitBy')} value={split} options={options} onChange={set} />
    </div>
  );
  const by = labelOfDimension(split).toLowerCase();
  // `oneBarEach` swapped the axes, so a bar's value is the column and its spec is the unsplit-across pivot's: the row of the original is the column of this.
  const barDrill = (measure: 'cycleTime' | 'aging') => (key: string) =>
    drill.open({ kind: 'cell', spec: { measure, split, top, from: period.from, to: period.to, ...filter }, row: key, column: '(all)' });
  // Nobody read a status history for the items counted: a dash with its reason. Nothing counted at all is said plainly.
  const noHistory = (r: PivotResult) => r.total.value === null && r.total.of > 0;
  const nothing = (what: string) => <p className="note">{what}</p>;
  return (
    <div className="chart-page" data-dashboard="flow">
      <DashboardHead title={words('flow.title')} help="flow" />
      <p className="chart-lead" data-flow-lead="">
        {sentence ? (
          <>
            {sentence}
            {figures.cycleDays === null && (
              <span className="chart-lead__period">
                {' '}
                (<Unread /> how long they took, no status history)
              </span>
            )}
          </>
        ) : (
          <Unread />
        )}
      </p>
      <FilterBar />
      <Fold id="throughput" title="Throughput" open>
        <ChartPanel
          main
          questions={['Is what we finish each week steady?', 'What slowed us down?']}
          title={`Finished each week, by ${by}`}
          result={through}
          source={source}
          actions={splitMenu}
          {...(split === 'category' ? { scheme: { categories: ins.scheme.categories } } : {})}
          onDrill={(c) => drill.open({ kind: 'cell', spec: through.spec, row: c.row.key, column: c.column.key })}
        >
          {(v) => <StackedColumns view={v} />}
        </ChartPanel>
      </Fold>
      <Fold id="cfd" title="Cumulative flow">
        {cfd ? (
          <ChartPanel
            title="Items by status, at the end of each week"
            result={cfd.result}
            source={source}
            modes={false}
            onDrill={(c) => {
              const week = dayOfKey(c.column.key);
              const category = c.row.key.replace(/^v:/, '') as FlowCategory;
              if (week && (FLOW_CATEGORIES as readonly string[]).includes(category)) drill.open({ kind: 'cfd', category, week, ...filter });
            }}
          >
            {(v) => <StackedArea view={v} />}
          </ChartPanel>
        ) : (
          <NotRead what="Status histories" />
        )}
      </Fold>
      <Fold id="cycle" title="Cycle time">
        {noHistory(cycle) ? (
          <NotRead what="Status histories" />
        ) : cycle.columns.length === 0 ? (
          nothing('Nothing was finished in this period.')
        ) : (
          <ChartPanel
            title={`Days from started to finished, by ${by}`}
            result={cycle}
            source={source}
            modes={false}
            legend="none"
            actions={splitMenu}
            onDrill={undefined}
          >
            {(v) => (
              <>
                <MedianBars view={v} unit="days" onDrill={barDrill('cycleTime')} />
                <p className="note flow-key">The bar is the typical time; the tick is the 85th percentile, within which 85 in 100 finished.</p>
              </>
            )}
          </ChartPanel>
        )}
      </Fold>
      <Fold id="aging" title="Work getting old">
        {noHistory(aging) ? (
          <NotRead what="Status histories" />
        ) : aging.columns.length === 0 ? (
          nothing('Nothing is in progress.')
        ) : (
          <ChartPanel title={`Days in progress so far, by ${by}`} result={aging} source={source} modes={false} legend="none" actions={splitMenu} onDrill={undefined}>
            {(v) => (
              <>
                <MedianBars view={v} unit="days" onDrill={barDrill('aging')} />
                <p className="note flow-key">The bar is the typical age of what is in progress; the tick is the 85th percentile.</p>
              </>
            )}
          </ChartPanel>
        )}
      </Fold>
    </div>
  );
}

export const flow: Dashboard = { id: 'flow', title: 'Flow', headline: flowHeadline, View: FlowView };
