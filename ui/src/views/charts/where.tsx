/**
 * The Where we're working dashboard (#567, docs/work-insights-seats.md, M8, P4
 * and P7): is the team's attention on a few things or spread across many, and
 * is any of it work no epic asked for. The focus is a heatmap of days in
 * progress for each epic (or any other grouping) by week, and beside it two
 * figures that are doors: how many epics had work going this week against
 * last, and the share of items with no epic above them. Each row's mix of
 * categories sits beside it, so "the epic with the most days" can be read as
 * features or upkeep. Without status history there are no days to count, so the
 * page says that and offers the sync, never a grid of zeros (principle 12). A
 * heatmap that is all one colour has, at least, never been accused of bias.
 */

import { useMemo } from 'react';
import { Heatmap, MixBar, RampKey } from '../../components/chartkit/index.ts';
import { Choice } from '../../components/choice.tsx';
import { FilterBar } from '../../components/filter-bar.tsx';
import { Unread } from '../../components/unread.tsx';
import { toWhere } from '../../filters.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { ALL_KEY, NONE_KEY } from '../../../../src/core/insights/index.ts';
import { EPIC, noEpicOf, rowItems, streamsOf, whereResult, whereSentence, type Streams } from '../../model/where.ts';
import { labelOfDimension, periodOf } from '../../model/work-insights.ts';
import { useWords } from '../../theme-context.ts';
import type { Dashboard, Headline } from './dashboard.ts';
import { ChartPanel, DashboardHead, Door, NotRead, useDimensionOptions, useDrill, useSourceLine } from './shared.tsx';
import type { WorkInsights } from '../../model/work-insights.ts';

/** The Charts list's line: how many epics have work this week and how much has none above it, or why it isn't known. */
export function whereHeadline(ins: WorkInsights): Headline {
  const streams = streamsOf(ins);
  const none = noEpicOf(ins);
  const text = whereSentence(streams, none);
  if (!text) return { text: null, note: ins.items.length === 0 ? 'no items were read' : "status history or parents weren't read" };
  return { text, note: streams ? 'days in progress, last 90 days' : "status history wasn't read, so the weeks can't be counted" };
}

/** A few weeks of "epics with work" as a line, with the figures in its label: no axis, as it is a glance and not a chart. */
function Spark({ streams }: { streams: Streams }) {
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...streams.weeks.map((x) => x.count));
  const n = streams.weeks.length;
  const pts = streams.weeks.map((x, i) => `${n <= 1 ? w / 2 : (w * i) / (n - 1)},${h - 3 - ((h - 6) * x.count) / max}`).join(' ');
  return (
    <svg className="where-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Epics with work, week by week: ${streams.weeks.map((x) => `${x.label} ${x.count}`).join(', ')}`}>
      <polyline points={pts} fill="none" />
    </svg>
  );
}

export function WhereView() {
  const ins = useWorkInsights();
  const { filters, query, go } = useAddress();
  const drill = useDrill();
  const words = useWords();
  const source = useSourceLine(true);
  const where = useMemo(() => toWhere(filters), [filters]);
  const options = useDimensionOptions(false);
  const rawSplit = query.get('split');
  const split = rawSplit && options.some((o) => o.id === rawSplit && !o.disabled) ? rawSplit : EPIC;
  const period = periodOf(ins.today, filters.from, filters.to);
  const opts = useMemo(() => ({ from: period.from, to: period.to, where }), [period.from, period.to, where]);
  const result = useMemo(() => whereResult(ins, split, opts), [ins, split, opts]);
  const streams = useMemo(() => streamsOf(ins, opts), [ins, opts]);
  const none = useMemo(() => noEpicOf(ins, where), [ins, where]);
  const mixes = useMemo(
    () => (result ? rowItems(result).filter((r) => r.kind !== 'none' && r.ids.length > 0).map((r) => ({ ...r, mix: ins.runOver(r.ids, { measure: 'items', split: 'category', top: 0 }) })) : []),
    [ins, result],
  );
  const sentence = whereSentence(streams, none);
  const spec = { measure: 'days' as const, split, top: 0, from: period.from, to: period.to, ...(where.length > 0 ? { where } : {}) };
  const lastWeek = streams && streams.weeks.at(-1) ? streams.weeks.at(-1)!.start : null;
  return (
    <div className="chart-page" data-dashboard="where">
      <DashboardHead title={words('where.title')} help="where" />
      <p className="chart-lead" data-where-lead="">
        {sentence ?? <Unread />}
      </p>
      <FilterBar />
      {!result && streams === null ? (
        <NotRead what="Status histories" />
      ) : (
        <div className="chart-page__grid">
          <div className="chart-page__main">
            {result ? (
              <ChartPanel
                main
                questions={['What are we spread across?', 'Which epics took the most days?']}
                title={`Days in progress by week, by ${labelOfDimension(split).toLowerCase()}`}
                result={result}
                source={source}
                legend="none"
                modes={false}
                actions={
                  <div className="chart-menus">
                    <Choice label={words('charts.splitBy')} value={split} options={options} onChange={(id) => go((q) => (id === EPIC ? q.delete('split') : q.set('split', id)))} />
                  </div>
                }
                onDrill={(c) => drill.open({ kind: 'where', spec, row: c.row.key, column: c.column.key })}
              >
                {(v) => (
                  <>
                    <Heatmap view={v} />
                    <RampKey />
                  </>
                )}
              </ChartPanel>
            ) : (
              <NotRead what="Status histories" />
            )}
          </div>
          <aside className="chart-page__side where-side" aria-label="Streams and gaps">
            <section className="where-figure" data-figure="streams">
              <h3>Parallel streams</h3>
              {streams === null ? (
                <p>
                  <Unread /> <span className="note">no epic has work to count</span>
                </p>
              ) : (
                <>
                  <p>
                    <Door drill={{ kind: 'where', spec: { measure: 'days', split: EPIC, top: 0, from: period.from, to: period.to, ...(where.length > 0 ? { where } : {}) }, row: '*', column: `v:${lastWeek}` }}>
                      <b>{streams.current}</b> {streams.current === 1 ? 'epic' : 'epics'} this week
                    </Door>
                    {streams.previous !== null && <span className="note"> · {streams.previous} last week</span>}
                  </p>
                  <Spark streams={streams} />
                </>
              )}
            </section>
            <section className="where-figure" data-figure="no-epic">
              <h3>No epic above it</h3>
              {none === null ? (
                <p>
                  <Unread /> <span className="note">parents weren't read</span>
                </p>
              ) : (
                <p>
                  <Door drill={{ kind: 'cell', spec: none.spec, row: NONE_KEY, column: ALL_KEY }}>
                    <b>{none.none}</b> of {none.of} items
                  </Door>
                  <span className="note"> · {Math.round(none.share * 100)}%</span>
                </p>
              )}
            </section>
            {mixes.length > 0 && (
              <section className="where-mixes" aria-label="What kind of work each row is">
                <h3>What kind of work</h3>
                <MixBar legend result={ins.runOver(mixes.flatMap((m) => m.ids), { measure: 'items', split: 'category', top: 0 })} scheme={{ categories: ins.scheme.categories }} label="All of it, mix by category" />
                <ul>
                  {mixes.map((m) => (
                    <li key={m.key}>
                      <span className="where-mixes__name">{m.label}</span>
                      <MixBar result={m.mix} scheme={{ categories: ins.scheme.categories }} label={`${m.label} mix by category`} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export const where: Dashboard = { id: 'where', title: "Where we're working", headline: whereHeadline, View: WhereView };
