/**
 * The Explore dashboard (#567, docs/work-insights-seats.md, every seat's
 * "can I just ask it"): pick a measure, a split, an across and filters, and the
 * chart takes the form the data asks for. The whole view lives in the address
 * (model/explore.ts), so a view is a link; Save to Charts keeps one in the toil
 * project, through toil's own command and the same confirmation path the
 * Settings pages use, so everyone opens the same chart from the list. In the
 * preview, which changes nothing, the button says so in plain words. A dimension
 * nobody read is greyed "not read yet" in the menus rather than left out. A
 * pivot table with a link attached is the one kind of spreadsheet that has
 * never needed a version number in its file name.
 */

import { useMemo, useState } from 'react';
import { Heatmap, RampKey, SmallMultiples, StackedBars, StackedColumns, figureRows } from '../../components/chartkit/index.ts';
import { Choice } from '../../components/choice.tsx';
import { FilterBar } from '../../components/filter-bar.tsx';
import { DataTable } from '../../components/layout.tsx';
import { Unread } from '../../components/unread.tsx';
import { useData } from '../../data.ts';
import { useAddress, useWorkInsights } from '../../insights-data.ts';
import { ALL_KEY, MEASURES, MEASURE_LABEL, specToQuery, type PivotResult, type PivotSpec, type SavedView } from '../../../../src/core/insights/index.ts';
import { EXPLORE_KEYS, exploreSpec, formFor, oneBarEach, saveViewInput, viewNameFrom, type ExploreForm } from '../../model/explore.ts';
import { inNameOrder, isPeopleDimension, labelOfDimension, rowsInNameOrder, type WorkInsights } from '../../model/work-insights.ts';
import { useWords } from '../../theme-context.ts';
import type { Dashboard, Headline } from './dashboard.ts';
import { markSaved } from './saved.ts';
import { ChartPanel, DashboardHead, useDimensionOptions, useDrill, useFilterFromCell, useSourceLine } from './shared.tsx';

/** What the page shows when its address names nothing: finished work by category, month by month. */
export const DEFAULT_SPEC: PivotSpec = { measure: 'throughput', split: 'category', across: 'resolved:month' };

/** The Charts list's line: Explore has no figure of its own, so it says what it is for. */
export function exploreHeadline(_ins: WorkInsights): Headline {
  return { text: 'Pick what to count and what to split it by', note: 'a blank page for your own question' };
}

const NONE = 'none';
const FORMS: Array<{ id: string; label: string }> = [
  { id: 'auto', label: 'Whatever suits the data' },
  { id: 'columns', label: 'Columns over time' },
  { id: 'bars', label: 'Bars' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'table', label: 'Table' },
];
const CHARTS: ReadonlyArray<NonNullable<SavedView['chart']>> = ['columns', 'bars', 'area', 'line', 'heatmap', 'table'];

/** The spec the address names, or the page's default when the address names no part of one. */
function useExploreSpec(): { spec: PivotSpec; error: string | null; chosen: SavedView['chart'] | undefined; blank: boolean } {
  const { query, filters } = useAddress();
  return useMemo(() => {
    const blank = ![...query.keys()].some((k) => k === 'split' || (EXPLORE_KEYS as readonly string[]).includes(k));
    const read = exploreSpec(query, filters);
    const raw = query.get('chart');
    const chosen = raw && (CHARTS as readonly string[]).includes(raw) ? (raw as SavedView['chart']) : undefined;
    if ('error' in read) return { spec: DEFAULT_SPEC, error: read.error, chosen, blank: false };
    if (!blank) return { spec: read.spec, error: null, chosen, blank };
    const where = read.spec.where;
    return { spec: { ...DEFAULT_SPEC, ...(where ? { where } : {}), ...(read.spec.from ? { from: read.spec.from } : {}), ...(read.spec.to ? { to: read.spec.to } : {}) }, error: null, chosen, blank };
  }, [query, filters]);
}

/** The table form: the figures as a table, for a view that asked for nothing drawn. */
function TableForm({ result }: { result: PivotResult }) {
  const { head, rows } = figureRows(result);
  return <DataTable label="Figures" caption="Figures" rows={rows.map((cells, i) => ({ i, cells }))} rowKey={(r) => String(r.i)} columns={head.map((h, j) => ({ header: h, label: h, rowHeader: j === 0, cell: (r: { cells: unknown[] }) => r.cells[j] as never }))} />;
}

/**
 * Save to Charts: a name for the view (its title; the identifier is made from it), then one press. It goes through toil's
 * own command, with the confirmation the Settings pages use, so the result is the same file change, and says in plain
 * words when it can't (the preview, which changes nothing).
 */
function SaveToCharts({ spec, chart }: { spec: PivotSpec; chart: SavedView['chart'] | undefined }) {
  const { toilProject, config } = useData();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; fix?: string | null; exists?: boolean } | null>(null);
  const name = viewNameFrom(title);
  const off = config?.disabled ?? (config ? null : 'Saving a view needs Toil UI running on your own machine.');
  const save = async (replace: boolean) => {
    if (!config || busy || !name) return;
    setBusy(true);
    setOutcome(null);
    try {
      const env = await config.run('projects view set', saveViewInput(toilProject.name, name, title, spec, chart, replace));
      if (env.ok) {
        setOutcome({ ok: true, message: `Saved. Find it by typing its name in the command palette.` });
        markSaved();
      } else if (/already set/.test(env.error.message)) setOutcome({ ok: false, message: `A saved view called "${title.trim()}" already exists.`, exists: true });
      else setOutcome({ ok: false, message: env.error.message, fix: env.error.fix ?? null });
    } catch (e) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="explore-save" data-explore-save="">
      <button type="button" className="btn btn--small" aria-expanded={open} aria-disabled={off ? true : undefined} onClick={() => setOpen((o) => !o)}>
        Save this view
      </button>
      {open &&
        (off ? (
          <p className="note" role="status" data-explore-save-off="">
            {off === config?.disabled ? 'This is sample data, so nothing can be saved here. In Toil UI on your own machine, Saving a view keeps it in your Toil project for everyone.' : off}
          </p>
        ) : (
          <form
            className="explore-save__form"
            aria-label="Save this view"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <p className="note">Keeps this view in your Toil project, so everyone opens the same chart by typing its name in the command palette.</p>
            <label>
              Name this view
              <input className="edit-field" value={title} maxLength={80} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <span className="explore-save__buttons">
              <button type="submit" className="btn btn--small" disabled={busy || !name}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {outcome?.exists && (
                <button type="button" className="btn btn--small" disabled={busy} onClick={() => void save(true)}>
                  Replace it
                </button>
              )}
            </span>
            {outcome && (
              <p role={outcome.ok ? 'status' : 'alert'} className={outcome.ok ? 'note' : 'failure'} data-explore-saved={outcome.ok ? '' : undefined}>
                {outcome.message}
                {outcome.fix && !outcome.exists && <span className="note"> Fix: {outcome.fix}</span>}
              </p>
            )}
          </form>
        ))}
    </div>
  );
}

export function ExploreView() {
  const ins = useWorkInsights();
  const { query, go } = useAddress();
  const drill = useDrill();
  const words = useWords();
  const source = useSourceLine(true);
  const { spec, error, chosen } = useExploreSpec();
  const splitOptions = useDimensionOptions(false);
  const acrossOptions = useDimensionOptions(true);
  const raw = useMemo(() => ins.run(spec), [ins, spec]);
  const result = useMemo(() => {
    let r = raw;
    if (spec.split && isPeopleDimension(spec.split) && !spec.across) r = rowsInNameOrder(r);
    else if (spec.split && isPeopleDimension(spec.split) && spec.across && !isPeopleDimension(spec.across)) r = rowsInNameOrder(r);
    if (spec.across && isPeopleDimension(spec.across)) r = inNameOrder(r);
    return r;
  }, [raw, spec]);
  const onBars = !spec.across;
  const shown = useMemo(() => (onBars ? oneBarEach(result) : result), [onBars, result]);
  const form: ExploreForm = formFor(shown, chosen);
  const many = !!spec.across && !!spec.split && result.rows.filter((r) => r.kind === 'value').length > 4;
  const multiples = many && query.get('multiples') === '1' && form !== 'heatmap' && form !== 'table';
  const onFilter = useFilterFromCell(shown);
  const setKey = (key: string, value: string | null) => go((q) => (value === null ? q.delete(key) : q.set(key, value)));
  /** Changes the spec's own parts in the address; the filters and period stay as the filter bar holds them. */
  const setSpec = (next: PivotSpec) =>
    go((q) => {
      for (const k of ['split', ...EXPLORE_KEYS.filter((e) => e !== 'where')]) q.delete(k);
      const own = specToQuery({ ...next, where: undefined as never });
      delete (own as Record<string, string | undefined>).from;
      delete (own as Record<string, string | undefined>).to;
      for (const [k, v] of Object.entries(own)) q.set(k, v);
      if (!own.split) q.delete('split');
    });
  const withDims = (extra: Partial<PivotSpec>) => setSpec({ ...spec, ...extra });
  const clean = (key: 'split' | 'across', id: string): Partial<PivotSpec> => (id === NONE ? ({ [key]: undefined } as Partial<PivotSpec>) : { [key]: id });
  const title = `${MEASURE_LABEL[spec.measure]}${spec.split ? `, by ${labelOfDimension(spec.split).toLowerCase()}` : ''}${spec.across ? `, across ${labelOfDimension(spec.across).toLowerCase()}` : ''}`;
  const menus = (
    <div className="chart-menus">
      <Choice label={words('charts.measure')} value={spec.measure} options={MEASURES.map((m) => ({ id: m, label: MEASURE_LABEL[m] }))} onChange={(id) => withDims({ measure: id as PivotSpec['measure'] })} />
      <Choice label={words('charts.splitBy')} value={spec.split ?? NONE} options={[{ id: NONE, label: 'Nothing' }, ...splitOptions]} onChange={(id) => withDims(clean('split', id))} />
      <Choice label={words('charts.across')} value={spec.across ?? NONE} options={[{ id: NONE, label: 'Nothing' }, ...acrossOptions]} onChange={(id) => withDims(clean('across', id))} />
      <Choice label="Show as" value={chosen ?? 'auto'} options={FORMS} onChange={(id) => setKey('chart', id === 'auto' ? null : id)} />
      {many && form !== 'heatmap' && form !== 'table' && <Choice label="Layout" value={multiples ? '1' : '0'} options={[{ id: '0', label: 'One chart' }, { id: '1', label: 'A small chart for each' }]} onChange={(id) => setKey('multiples', id === '1' ? '1' : null)} />}
    </div>
  );
  const asCell = (c: { row: { key: string }; column: { key: string } }) => (onBars ? { row: c.column.key, column: ALL_KEY } : { row: c.row.key, column: c.column.key });
  return (
    <div className="chart-page" data-dashboard="explore">
      <DashboardHead title={words('explore.title')} help="explore" />
      {error && (
        <p className="failure" role="alert" data-explore-error="">
          This link's view can't be drawn: {error} Showing the default instead.
        </p>
      )}
      <p className="chart-lead" data-explore-lead="">
        {result.total.value === null ? <Unread /> : `${Math.round(result.total.value * 10) / 10} ${result.measure.unit}`}
      </p>
      <FilterBar />
      <ChartPanel
        key={JSON.stringify([spec, form, multiples])}
        main
        questions={spec.split ? [`What stands out in ${title.toLowerCase()}?`] : []}
        title={title}
        result={shown}
        source={source}
        legend={form === 'heatmap' || form === 'table' ? 'none' : 'swatch'}
        defaultMode={spec.share ? 'share' : 'count'}
        actions={menus}
        {...(spec.split === 'category' ? { scheme: { categories: ins.scheme.categories } } : {})}
        onDrill={(c) => drill.open({ kind: 'cell', spec, ...asCell(c) })}
        {...(onBars ? {} : { onFilter })}
      >
        {(v) =>
          multiples ? <SmallMultiples view={v} /> : form === 'heatmap' ? (
            <>
              <Heatmap view={v} />
              <RampKey />
            </>
          ) : form === 'table' ? <TableForm result={shown} /> : form === 'columns' ? <StackedColumns view={v} /> : <StackedBars view={v} />
        }
      </ChartPanel>
      <SaveToCharts spec={spec} chart={chosen} />
    </div>
  );
}

export const explore: Dashboard = { id: 'explore', title: 'Explore', headline: exploreHeadline, View: ExploreView };
