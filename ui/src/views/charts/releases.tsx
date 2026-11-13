/**
 * The Releases dashboard (#567, docs/work-insights-seats.md, P1 to P6): for each
 * release that is not out yet, and the latest one that is, how much is in it, how
 * much is done, what was added after it started, and what is open past its date.
 * The next release due opens expanded, the rest are one line each. Each section
 * has one chart, a burn-up toward its date with the scope line; the release's mix
 * and a breakdown of its scope by any dimension are a step in. Every number is a
 * door to the items behind it. "Added since it started" is a floor that needs the
 * release's start date from the tracker, so without one it is a dash and says why
 * and never a 0. There is no forecast in this slice. The release plan remains,
 * as ever, an optimistic document.
 */

import { Lines, MixBar, StackedBars } from '../../components/chartkit/index.ts';
import { Choice } from '../../components/choice.tsx';
import { FilterBar } from '../../components/filter-bar.tsx';
import { Unread } from '../../components/unread.tsx';
import { toWhere } from '../../filters.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { burnupOf, dayWords, daysUntil, labelOfDimension, nextRelease, percentText, releaseSentence, releasesToShow, SPLIT_MENU, type Release, type WorkInsights } from '../../model/work-insights.ts';
import { useWords } from '../../theme-context.ts';
import type { ReleaseSet } from '../../model/drill.ts';
import type { Filter } from '../../../../src/core/insights/index.ts';
import type { Dashboard, Headline } from './dashboard.ts';
import { ChartPanel, DashboardHead, Door, NotRead, useDrill, useFilterFromCell, useSourceLine } from './shared.tsx';
import { SummaryChevron } from '../../components/disclosure.tsx';

/** The Charts list's line: the release due next, or why none can be named. */
export function releasesHeadline(ins: WorkInsights): Headline {
  if (!ins.releasesRead) return { text: null, note: "fix versions weren't read" };
  const next = nextRelease(ins);
  if (!next) {
    const { latest } = releasesToShow(ins);
    return latest ? { text: `${latest.name} is out${latest.date ? `, ${dayWords(latest.date)}` : ''}`, note: 'nothing is waiting on a release' } : { text: null, note: 'no release is named on any item' };
  }
  const { open } = releasesToShow(ins);
  return { text: releaseSentence(next), note: `${open.length} ${open.length === 1 ? 'release' : 'releases'} not out yet` };
}

const daysText = (n: number) => (n === 0 ? 'due today' : n > 0 ? `${n} ${n === 1 ? 'day' : 'days'} left` : `${-n} ${n === -1 ? 'day' : 'days'} overdue`);

/** One release: its figures, then its burn-up, then a step in for its mix and its breakdown. */
function Section({ ins, release, initiallyOpen, where, split, onSplit }: { ins: WorkInsights; release: Release; initiallyOpen: boolean; where: Filter[]; split: string; onSplit: (spec: string) => void }) {
  const view = ins.narrow(where);
  const drill = useDrill();
  const words = useWords();
  const source = useSourceLine(true);
  const scope = view.scope(release.name);
  const burn = burnupOf(view, release);
  // The pivots run over every item with the filters in their own `where`, so the list a click opens, which is found by running the same spec, has as many items as the number clicked.
  const inRelease: Filter[] = [{ dimension: 'release', op: '=', values: [release.name] }, ...where];
  const mixSpec = { measure: 'items' as const, split: 'category', where: inRelease };
  const mixResult = ins.run(mixSpec);
  const breakdownSpec = { measure: 'items' as const, split, across: 'statusCategory', where: inRelease };
  const breakdown = ins.run(breakdownSpec);
  const onFilter = useFilterFromCell(breakdown);
  const open = (set: ReleaseSet, day?: string) => ({ kind: 'release' as const, set, release: release.name, ...(day ? { day } : {}), ...(where.length > 0 ? { where } : {}) });
  const left = release.date === null ? null : daysUntil(ins.today, release.date);
  const donePct = scope.total === 0 ? null : scope.done / scope.total;
  return (
    <details className="release" open={initiallyOpen || undefined} data-release={release.name}>
      <summary>
        <SummaryChevron />
        <span className="release__name">{release.name}</span>
        <span className="release__when">
          {release.released ? (release.date ? `went out ${dayWords(release.date)}` : 'is out') : release.date ? `due ${dayWords(release.date)}, ${daysText(left!)}` : 'no date'}
        </span>
        <span className="release__done">{donePct === null ? <Unread /> : `${percentText(donePct)} done`}</span>
      </summary>
      <div className="release__body">
        <ul className="release__figures" aria-label={`${release.name} in numbers`}>
          <li>
            <Door drill={open('all')}>
              <b>{scope.total}</b> in it
            </Door>
          </li>
          <li>
            <Door drill={open('done')}>
              <b>{scope.done}</b> done
            </Door>
          </li>
          <li>
            <Door drill={open('open')}>
              <b>{scope.open}</b> left
            </Door>
          </li>
          <li data-figure="added">
            {scope.added === null ? (
              <>
                <Unread /> added since it started <span className="note">this release has no start date</span>
              </>
            ) : (
              <Door drill={open('added')}>
                <b>{scope.added}</b> added since it started
              </Door>
            )}
          </li>
          <li data-figure="past-due">
            {release.date === null ? (
              <>
                <Unread /> open past its date <span className="note">this release has no date</span>
              </>
            ) : (
              <Door drill={open('pastDue')}>
                <b>{scope.pastDue.length}</b> open past its date
              </Door>
            )}
          </li>
        </ul>
        {burn ? (
          <ChartPanel
            main={initiallyOpen}
            questions={initiallyOpen ? [`What's putting ${release.name} at risk?`, `What was added to ${release.name} after it started?`] : []}
            title={`Burn-up: ${release.name}`}
            result={burn.result}
            source={`${source} Done is counted by the day each item was resolved; scope is everything in the release.`}
            modes={false}
            legend="line"
            scopeLabel="Scope"
            onDrill={(c) => {
              const day = burn.upTo[c.columnIndex];
              if (day) drill.open(open('doneBy', day));
            }}
          >
            {(v) => <Lines view={v} scope={burn.scope} scopeLabel="Scope" {...(release.date && burn.dueColumn !== null ? { marker: { column: burn.result.columns[burn.dueColumn]!.key, label: `Due ${dayWords(release.date)}` } } : {})} />}
          </ChartPanel>
        ) : (
          <p className="note" data-no-burnup="">
            {release.start && release.start > ins.today ? `Work on ${release.name} starts ${dayWords(release.start)}, so there is nothing to burn up yet.` : `Nothing in ${release.name} to draw.`}
          </p>
        )}
        <div className="release__mix">
          <h4 className="release__mix-label">Mix</h4>
          <MixBar legend result={mixResult} scheme={{ categories: ins.scheme.categories }} label={`${release.name} mix by category`} onDrill={(c) => drill.open({ kind: 'cell', spec: mixSpec, row: c.row.key, column: c.column.key })} />
        </div>
        <details className="release__breakdown">
          <summary>
            <SummaryChevron />
            What is in it
          </summary>
          <ChartPanel
            title={`${release.name}: what is in it, by ${labelOfDimension(split).toLowerCase()}`}
            result={breakdown}
            source={source}
            scheme={{ categories: ins.scheme.categories }}
            actions={
              <Choice label={words('charts.splitBy')} value={split} options={SPLIT_MENU.map((d) => ({ id: d.spec, label: d.label }))} onChange={onSplit} />
            }
            onDrill={(c) => drill.open({ kind: 'cell', spec: breakdownSpec, row: c.row.key, column: c.column.key })}
            onFilter={onFilter}
          >
            {(v) => <StackedBars view={v} />}
          </ChartPanel>
        </details>
      </div>
    </details>
  );
}

export function ReleasesView() {
  const ins = useWorkInsights();
  const { filters, query, go } = useAddress();
  const words = useWords();
  const where = toWhere(filters);
  const view = ins.narrow(where);
  const rawSplit = query.get('split');
  const split = rawSplit && SPLIT_MENU.some((d) => d.spec === rawSplit) ? rawSplit : 'category';
  const { open, latest } = releasesToShow(view);
  return (
    <div className="chart-page" data-dashboard="releases">
      <DashboardHead title={words('releases.title')} help="releases" />
      {!ins.releasesRead ? (
        <NotRead what="Fix versions" />
      ) : (
        <>
          <p className="chart-lead" data-releases-lead="">
            {releasesHeadline(view).text ?? <Unread />}
          </p>
          <FilterBar period={false} />
          {open.length === 0 && !latest && <p className="note">No release is named on any item that passes the filters.</p>}
          {open.map((r, i) => (
            <Section key={r.name} ins={ins} release={r} initiallyOpen={i === 0} where={where} split={split} onSplit={(s) => go((q) => (s === 'category' ? q.delete('split') : q.set('split', s)))} />
          ))}
          {latest && <Section key={latest.name} ins={ins} release={latest} initiallyOpen={false} where={where} split={split} onSplit={(s) => go((q) => (s === 'category' ? q.delete('split') : q.set('split', s)))} />}
        </>
      )}
    </div>
  );
}

export const releases: Dashboard = { id: 'releases', title: 'Releases', headline: releasesHeadline, View: ReleasesView };
