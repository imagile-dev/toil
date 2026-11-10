/**
 * What every dashboard shares (#567): a click that opens a list of items, a
 * shift-click that adds a filter, the page's head with the way back, the source
 * line, and the empty state for a dimension the read never fetched. Kept here so
 * a dashboard is its charts and its sentences, and the behaviours that must
 * match across dashboards (every number a door, every segment a filter) are
 * written once and cannot drift. The shared drawer is where the dashboards'
 * paperwork goes to be countersigned.
 */

import type { ReactNode } from 'react';
import { type PivotResult } from '../../../../src/core/insights/index.ts';
import { Help } from '../../components/help.tsx';
import { TrackerAction, Empty } from '../../components/empty.tsx';
import { useData } from '../../data.ts';
import { chartsHref } from '../../format.ts';
import { addValue, writeFilters, type Filters } from '../../filters.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { encodeDrill, type Drill } from '../../model/drill.ts';
import { useWords } from '../../theme-context.ts';
import type { CellRef } from '../../components/chartkit/index.ts';
import type { HelpTopicId } from '../../help.ts';

/** Opens a list of items: as a click handler, or as the link behind a number. */
export function useDrill() {
  const { go, hrefWith } = useAddress();
  const edit = (d: Drill) => (q: URLSearchParams) => {
    q.set('items', encodeDrill(d));
    q.delete('item');
  };
  return { open: (d: Drill) => go(edit(d)), href: (d: Drill) => hrefWith(edit(d)) };
}

/** A number that is a door: the figure as a link to the list of items behind it. */
export function Door({ drill, children, label }: { drill: Drill; children: ReactNode; label?: string }) {
  const { href } = useDrill();
  return (
    <a className="door" href={href(drill)} {...(label ? { 'aria-label': label } : {})} data-door="">
      {children}
    </a>
  );
}

/**
 * Shift-click on a mark adds what it stands for as filters: the row's value and, where the columns are not time,
 * the column's, each in its own dimension. Other and "none" buckets add nothing the filter could name, except none, which the filter understands.
 */
export function useFilterFromCell(result: PivotResult) {
  const { filters, go } = useAddress();
  return (cell: CellRef) => {
    let next: Filters = filters;
    const add = (spec: string | undefined, key: string, label: string, kind: string, timeKind: string | undefined) => {
      if (!spec || timeKind === 'time' || kind === 'other' || key === '(all)') return;
      next = addValue(next, spec, kind === 'none' ? 'none' : spec === 'category' ? key.replace(/^v:/, '') : label);
    };
    add(result.split?.spec, cell.row.key, cell.row.label, cell.row.kind, result.split?.kind);
    add(result.across?.spec, cell.column.key, cell.column.label, cell.column.kind, result.across?.kind);
    if (next !== filters) go((q) => writeFilters(q, next));
  };
}

/** The line every chart carries: where the items came from and how far back; the scheme's note when it isn't the toil project's own. */
export function useSourceLine(category = false): string {
  const ins = useWorkInsights();
  return `${ins.sourceLine()}${category && ins.schemeNote ? ` ${ins.schemeNote}` : ''}`;
}

/** A dashboard's heading, with the way back to the list and its (i). */
export function DashboardHead({ title, help }: { title: string; help: HelpTopicId }) {
  const { toilProject } = useData();
  const words = useWords();
  return (
    <header className="chart-page__head">
      <p className="chart-page__crumb">
        <a href={chartsHref(toilProject.name)} data-charts-back="">
          {words('charts.back')}
        </a>
      </p>
      <h1 className="chart-page__title" tabIndex={-1} id="chart-page-title">
        {title} <Help topic={help} />
      </h1>
    </header>
  );
}

/** What a dashboard says when a dimension it needs was never read: one sentence, then the action that reads it where there is one. */
export function NotRead({ what }: { what: string }) {
  const { toilProject, sync } = useData();
  return <Empty message={`${what} weren't read for this Toil project, so there is nothing to draw yet.`} action={<TrackerAction toilProject={toilProject.name} sync={sync} />} />;
}
