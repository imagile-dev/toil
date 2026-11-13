/**
 * The Sprints dashboard (#567, docs/work-insights-seats.md, S2 to S4 and M5):
 * velocity, the question every sprint review ends up asking. The focus is one
 * sentence ("Done per sprint: 18 to 25 items over the last five sprints"), then
 * one chart: a column per sprint, stacked as what was in it from the start and
 * done, what was added after it started and done, what was carried over to a
 * later sprint and what was not done. A Split by menu turns the same columns
 * into the work mix of what each sprint finished, planned against unplanned, or
 * by team (in name order, never by size). Under it, one line per sprint says
 * what became of it, each figure a door. Committed and added need each item's
 * sprint history; where it wasn't read they are dashes, never 0 (principle 12).
 * The sprint review is the one ceremony where "carried over" is said with a straight face.
 */

import { useMemo } from 'react';
import { StackedColumns } from '../../components/chartkit/index.ts';
import { Choice } from '../../components/choice.tsx';
import { FilterBar } from '../../components/filter-bar.tsx';
import { Unread } from '../../components/unread.tsx';
import { toWhere } from '../../filters.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { stitchColumns } from '../../model/stitch.ts';
import { SERIES_SET, sprintResult, sprintStories, velocityOf, velocitySentence, type SprintSet, type SprintStory } from '../../model/sprints-history.ts';
import { isPeopleDimension, labelOfDimension, type WorkInsights } from '../../model/work-insights.ts';
import { estimateUnit } from '../../../../src/core/insights/index.ts';
import { useWords } from '../../theme-context.ts';
import type { Drill } from '../../model/drill.ts';
import type { Dashboard, Headline } from './dashboard.ts';
import { ChartPanel, DashboardHead, Door, NotRead, useDrill, useSourceLine } from './shared.tsx';

/** How many sprints the chart draws: enough to see a trend, few enough to read the columns. */
const SHOWN = 8;
const STORY = 'story';
const SPLITS = [
  { id: STORY, label: 'What became of it' },
  { id: 'category', label: 'Category' },
  { id: 'planned', label: 'Planned or unplanned' },
  { id: 'team', label: 'Team' },
] as const;
const UNITS = [
  { id: 'items', label: 'Items' },
  { id: 'points', label: 'Estimate' },
] as const;

/** The line in Where the work goes: velocity over the last five sprints that ended, or why it isn't known. */
export function sprintsHeadline(ins: WorkInsights): Headline {
  const stories = sprintStories(ins.items, ins.asOf);
  if (stories.length === 0) return { text: null, note: "sprints weren't read" };
  const v = velocityOf(stories);
  if (!v) return { text: null, note: 'no sprint has ended yet' };
  return { text: velocitySentence(v), note: `${v.sprints[0]!.name} to ${v.sprints.at(-1)!.name}` };
}

export function SprintsView() {
  const ins = useWorkInsights();
  const { filters, query, go } = useAddress();
  const drill = useDrill();
  const words = useWords();
  const source = useSourceLine(true);
  const where = useMemo(() => toWhere(filters), [filters]);
  const view = ins.narrow(where);
  const split = SPLITS.find((s) => s.id === query.get('split'))?.id ?? STORY;
  const unit = UNITS.find((u) => u.id === query.get('unit'))?.id ?? 'items';
  const stories = useMemo(() => sprintStories(view.items, view.asOf), [view]);
  const shown = useMemo(() => stories.slice(-SHOWN), [stories]);
  const velocity = useMemo(() => velocityOf(stories), [stories]);
  const byId = useMemo(() => new Map(view.items.map((i) => [i.id, i])), [view]);
  const pointUnit = useMemo(() => estimateUnit(view.items), [view]);
  const result = useMemo(() => {
    if (shown.length === 0) return null;
    if (split === STORY) return sprintResult(shown, byId, unit, view.asOf, pointUnit);
    const measure = unit === 'items' ? ('items' as const) : ('estimate' as const);
    const parts = shown.map((s) => ({ key: `v:${s.name}`, label: s.name, result: view.runOver(s.done, { measure, split, top: 0 }) }));
    return stitchColumns(parts, { spec: { measure, split, across: 'sprint' }, top: 0, byName: isPeopleDimension(split) });
  }, [shown, split, unit, byId, view, pointUnit]);
  const set = (key: string, value: string | null) => go((q) => (value === null ? q.delete(key) : q.set(key, value)));
  const onDrill = (c: { row: { key: string }; column: { label: string } }): void => {
    const filter = where.length > 0 ? { where } : {};
    const d: Drill = split === STORY ? { kind: 'sprint', set: SERIES_SET[c.row.key as keyof typeof SERIES_SET] ?? 'all', sprint: c.column.label, ...filter } : { kind: 'sprint', set: 'done', sprint: c.column.label, split, row: c.row.key, ...filter };
    drill.open(d);
  };
  const open = (s: SprintStory, set: SprintSet): Drill => ({ kind: 'sprint', set, sprint: s.name, ...(where.length > 0 ? { where } : {}) });
  const title = split === STORY ? `What became of each sprint's work${unit === 'points' ? ', in points' : ''}` : `Done in each sprint, by ${labelOfDimension(split).toLowerCase()}${unit === 'points' ? ', in points' : ''}`;
  const menus = (
    <div className="chart-menus">
      <Choice label={words('charts.splitBy')} value={split} options={SPLITS.map((s) => ({ id: s.id, label: s.label }))} onChange={(id) => set('split', id === STORY ? null : id)} />
      <Choice label={words('charts.measuredIn')} value={unit} options={UNITS.map((u) => ({ id: u.id, label: u.label }))} onChange={(id) => set('unit', id === 'items' ? null : id)} />
    </div>
  );
  return (
    <div className="chart-page" data-dashboard="sprints">
      <DashboardHead title={words('sprints.title')} help="sprints" />
      {stories.length === 0 ? (
        <NotRead what="Sprints" />
      ) : (
        <>
          <p className="chart-lead" data-sprints-lead="">
            {velocity ? velocitySentence(velocity) : <><Unread /> <span className="chart-lead__period">no sprint has ended yet</span></>}
          </p>
          <FilterBar period={false} />
          {result && (
            <ChartPanel
              main
              questions={['Is our velocity steady?', 'Why does work get carried over?']}
              title={title}
              result={result}
              source={source}
              {...(split === 'category' ? { scheme: { categories: ins.scheme.categories }, defaultMode: 'share' as const } : {})}
              actions={menus}
              onDrill={onDrill}
            >
              {(v) => <StackedColumns view={v} />}
            </ChartPanel>
          )}
          <ul className="sprint-lines" aria-label="Each sprint, in a line">
            {[...shown].reverse().map((s) => (
              <li key={s.name} data-sprint={s.name}>
                <b>{s.name}</b>: <Door drill={open(s, 'done')}>{s.done.length} done</Door>
                {', '}
                {s.added === null ? (
                  <>
                    <Unread /> added after it started
                  </>
                ) : (
                  <Door drill={open(s, 'added')}>{s.added.length} added after it started</Door>
                )}
                {', '}
                {s.closed ? <Door drill={open(s, 'carried')}>{s.carried.length} carried over</Door> : <span className="note">still running</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export const sprints: Dashboard = { id: 'sprints', title: 'Sprints', headline: sprintsHeadline, View: SprintsView };
