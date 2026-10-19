/**
 * One dossier's dashboard (#228, #252, #253): its sprint with a burn-up, what
 * needs attention, the board, throughput, cycle time and aging work, the
 * dependency graph, its stories with their pull requests, builds and
 * deployments side by side, and the chat docked beside it all. Every panel
 * was filled by toil commands (src/load.ts) and says which ones.
 * The one page the weekly status meeting was trying to be.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { Checkbox } from 'react-aria-components';
import { Ask } from '../components/ask.tsx';
import { Cited, ItemLink } from '../components/items.tsx';
import { DataTable, type Column } from '../components/layout.tsx';
import { Panel, Sources } from '../components/panel.tsx';
import { useData, useDerived } from '../data.ts';
import { SOURCE_LABEL, STATUS_CATEGORY_LABEL, day, dateTime, estimateText } from '../format.ts';
import { describe, type Health } from '../model/sprint.ts';
import { FLAG_TEXT, trace, type Trace as TraceRow } from '../model/trace.ts';
import { useSkins, useTerm, useWords } from '../skins.tsx';
import type { ChangeRef, Deployment, SourceKind } from '../toil.ts';
import { Board } from './Board.tsx';
import { Aging, Attention, Burnup, CycleTime, Throughput } from './Flow.tsx';

// The graph library is the biggest piece of the page, so it loads on its own, after the rest.
const Graph = lazy(() => import('./Graph.tsx').then((m) => ({ default: m.Graph })));

const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
const area = (name: string) => SOURCE_LABEL[name as SourceKind] ?? name;
/** `corp-bitbucket:PAY/payments-core#311` reads as `#311`; the panel already says where. */
const short = (id: string) => id.slice(id.lastIndexOf('#'));

function Outcome({ of }: { of: Pick<ChangeRef, 'state' | 'outcome'> }) {
  return <span className={`outcome outcome--${of.outcome}`}>{of.state}</span>;
}

function ChangeLink({ change }: { change: ChangeRef }) {
  const text = change.kind === 'pull-request' ? `${short(change.id)} ${change.title}` : change.title;
  return change.url ? <a href={change.url}>{text}</a> : <span>{text}</span>;
}

function Items({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="note">No work item named</span>;
  return (
    <span className="cites">
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <ItemLink id={id} />
        </span>
      ))}
    </span>
  );
}

/** The delivery table's columns: each work item, its pull requests, their latest builds, where it runs, and what to check. */
function traceColumns(builds: ChangeRef[]): Array<Column<TraceRow>> {
  return [
    {
      header: 'Work item',
      label: 'Work item',
      rowHeader: true,
      cell: (r) => (
        <>
          <ItemLink id={r.item.id} withTitle />
          <span className="field"> {estimateText(r.item)}</span>
        </>
      ),
    },
    {
      header: 'Status',
      label: 'Status',
      cell: (r) => (
        <>
          {r.item.status}
          {r.item.status?.toLowerCase() !== STATUS_CATEGORY_LABEL[r.item.statusCategory].toLowerCase() && <span className="field"> ({STATUS_CATEGORY_LABEL[r.item.statusCategory]})</span>}
        </>
      ),
    },
    {
      header: 'Pull requests',
      label: 'Pull requests',
      cell: (r) =>
        r.changes.length ? (
          <ul className="plain">
            {r.changes.map((c) => (
              <li key={c.id}>
                <ChangeLink change={c} /> <Outcome of={c} />
              </li>
            ))}
          </ul>
        ) : (
          'None linked'
        ),
    },
    {
      header: 'Builds',
      label: 'Builds',
      cell: (r) =>
        r.changes.length ? (
          <ul className="plain">
            {r.changes.map((pr) => {
              const build = builds.filter((b) => b.builds === pr.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
              return (
                <li key={pr.id}>
                  {build ? (
                    <>
                      <ChangeLink change={build} /> <Outcome of={build} />
                    </>
                  ) : (
                    <span className="note">No build for {short(pr.id)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          'None'
        ),
    },
    { header: 'Deployed to', label: 'Deployed to', cell: (r) => (r.deployedTo.length ? r.deployedTo.map((d) => d.environment).join(', ') : 'Not deployed') },
    { header: 'Check', label: 'Check', cell: (r) => (r.flags.length ? <ul className="plain flags">{r.flags.map((f) => <li key={f}>{FLAG_TEXT[f]}</li>)}</ul> : 'No gaps') },
  ];
}

export function Dashboard() {
  const { dossier } = useData();
  const { EmptyState, Loading } = useSkins();
  const term = useTerm();
  const words = useWords();
  const [gapsOnly, setGapsOnly] = useState(false);
  const { health: h } = useDerived();
  useSprintProgress(h);
  const rows = trace(h?.items ?? dossier.items, dossier.changes, dossier.deployments);
  const shown = gapsOnly ? rows.filter((r) => r.flags.length) : rows;
  const prs = dossier.changes.filter((c) => c.kind === 'pull-request');
  const builds = dossier.changes.filter((c) => c.kind === 'build');
  const all = [...dossier.calls.work, ...dossier.calls.prs, ...dossier.calls.builds, ...dossier.calls.deployments];

  return (
    <>
      <div className="view-head">
        <p className="eyebrow">{words('dossier.eyebrow')}</p>
        <h1 tabIndex={-1}>{dossier.name}</h1>
        {dossier.description && <p className="lede">{dossier.description}</p>}
        <ul className="sources" aria-label="Sources">
          {dossier.sources.map((s) => (
            <li key={s.area}>
              {area(s.area)} {s.connection && <code>{s.connection}</code>}
            </li>
          ))}
        </ul>
        <Sources calls={dossier.calls.dossier} />
      </div>

      <div className="dashboard">
        <div className="dash-main">
          <Panel id="sprint" title={term('sprint', h ? `${h.sprint.name}: day ${h.days.gone} of ${h.days.total}` : 'Sprint')} calls={dossier.calls.work}>
            {h ? <Sprint h={h} /> : <EmptyState message={words('empty.sprint')} />}
          </Panel>

          <Panel id="attention" title="Needs attention" calls={all} alerts={false}>
            <p className="note">{words('attention.note')}</p>
            <Attention />
          </Panel>

          <Panel id="board" title={term('board', h ? `${h.sprint.name} board` : 'Board')} calls={dossier.calls.work} alerts={false}>
            <Board items={h?.items ?? dossier.items} />
          </Panel>

          <div className="panel-grid panel-grid--two">
            <Panel id="throughput" title="Throughput" calls={dossier.calls.work} alerts={false}>
              <Throughput />
            </Panel>
            <Panel id="cycle" title="Cycle time" calls={dossier.calls.work} alerts={false}>
              <CycleTime />
            </Panel>
          </div>

          <Panel id="aging" title="Aging work in progress" calls={dossier.calls.work} alerts={false}>
            <p className="note">{words('aging.note')}</p>
            <Aging />
          </Panel>

          <Panel id="graph" title={term('dependencies', 'Dependencies')} calls={dossier.calls.work} alerts={false}>
            <Suspense fallback={<Loading message={words('loading.graph')} />}>
              <Graph />
            </Suspense>
          </Panel>

          <Panel id="trace" title="Stories, pull requests, builds and deployments" calls={all} alerts={false}>
            <p className="note">{words('trace.note')}</p>
            <Checkbox className="check" isSelected={gapsOnly} onChange={setGapsOnly}>
              <span className="box" aria-hidden="true">
                {gapsOnly ? '✓' : ''}
              </span>
              Only items with something to check
            </Checkbox>
            <DataTable className="trace" label="Work items and their delivery" wide rows={shown} rowKey={(r) => r.item.id} columns={traceColumns(builds)} />
          </Panel>

          <div className="panel-grid">
            <Panel id="prs" title="Pull requests" calls={dossier.calls.prs}>
              {prs.length ? (
                <ul className="rows">
                  {prs.map((c) => (
                    <li key={c.id}>
                      <ChangeLink change={c} /> <Outcome of={c} />
                      <p className="evidence">
                        <Items ids={c.items} />. {c.outcome === 'merged' ? 'Merged' : 'Opened'} {dateTime(c.at)}.
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message={words('empty.prs')} />
              )}
            </Panel>

            <Panel id="builds" title="Builds" calls={dossier.calls.builds}>
              {builds.length ? (
                <ul className="rows">
                  {builds.map((c) => (
                    <li key={c.id}>
                      <ChangeLink change={c} /> <Outcome of={c} />
                      <p className="evidence">
                        For pull request {c.builds ? short(c.builds) : 'none'}, {dateTime(c.at)}.
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message={words('empty.builds')} />
              )}
            </Panel>

            <Panel id="deployments" title="Deployments" calls={dossier.calls.deployments}>
              {dossier.deployments.length ? (
                <ul className="rows">
                  {dossier.deployments.map((d) => (
                    <DeploymentRow key={d.id} d={d} />
                  ))}
                </ul>
              ) : (
                <EmptyState message={words('empty.deployments')} />
              )}
            </Panel>
          </div>
        </div>
        <Ask />
      </div>
    </>
  );
}

/**
 * How far through its sprint the dossier is, from 0 on day one to 1 on the
 * last, as `--sprint-progress` on the page, for a theme's sky to follow
 * (Harvest's dawn to dusk). It is decoration: the sprint panel says the day
 * in words. Off the dashboard, there is no sprint, and the property goes.
 */
function useSprintProgress(h: Health | null) {
  const progress = h && h.days.total > 1 ? Math.min(1, Math.max(0, (h.days.gone - 1) / (h.days.total - 1))) : null;
  useEffect(() => {
    if (progress === null) return;
    const root = document.documentElement;
    root.style.setProperty('--sprint-progress', progress.toFixed(3));
    return () => {
      root.style.removeProperty('--sprint-progress');
    };
  }, [progress]);
}

function DeploymentRow({ d }: { d: Deployment }) {
  const name = d.url ? <a href={d.url}>{d.name}</a> : <span>{d.name}</span>;
  return (
    <li>
      <h3 className="env">{d.environment}</h3>
      <p>
        {name} <span className={`outcome outcome--${d.outcome}`}>{d.state}</span>
      </p>
      <p className="evidence">
        {d.version ? `${d.version}, ` : ''}commit <code>{d.commit}</code>.{' '}
        {d.unknownCommit ? (
          <span className="failure">No listed pull request merged as this commit.</span>
        ) : (
          <>
            Includes {d.includes.length} merged pull {d.includes.length === 1 ? 'request' : 'requests'}
            {d.items.length ? (
              <>
                , for <Items ids={d.items} />
              </>
            ) : (
              ', none for this sprint'
            )}
            .
          </>
        )}
      </p>
    </li>
  );
}

function Sprint({ h }: { h: Health }) {
  const total = h.done.points + h.remaining.points;
  const listed = (kind: 'added' | 'carried') => h.items.filter((i) => h.entries.get(i.id)?.kind === kind);
  return (
    <>
      <p className="note">
        {day(h.sprint.start!)} to {day(h.sprint.end!)}, working days only.
      </p>
      <ul className="stats" aria-label="Sprint figures">
        <Stat label="Done" value={`${h.done.points} of ${total}`} note={`points, ${h.done.count} items`} />
        <Stat label="Planned" value={String(h.planned.points)} note={`points, ${h.planned.count} items`} />
        <Stat label="Added mid-sprint" value={String(h.added.points)} note={`points, ${h.added.count} items`} />
        <Stat label="Carried over" value={String(h.carried.points)} note={`points, ${h.carried.count} items`} />
      </ul>
      <div className="meter" role="img" aria-label={`${h.done.points} of ${total} points done`}>
        <span style={{ width: `${total ? (100 * h.done.points) / total : 0}%` }} />
      </div>
      <Burnup />
      {h.otherUnits.length > 0 && (
        <p className="note">
          Points totals leave out items estimated in other units:{' '}
          {h.otherUnits.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <ItemLink id={id} />
            </span>
          ))}
          .
        </p>
      )}
      <h3>At risk</h3>
      {h.risks.length ? (
        <ul className="rows">
          {h.risks.map((r) => (
            <li key={r.id}>
              <ItemLink id={r.id} withTitle />
              <ul className="reasons">
                {r.reasons.map((reason, i) => (
                  <li key={i}>
                    <Cited text={describe(reason)} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing.</p>
      )}
      {(['added', 'carried'] as const).map((kind) => (
        <div key={kind}>
          <h3>{kind === 'added' ? 'Added after the sprint started' : 'Carried over'}</h3>
          {listed(kind).length ? (
            <ul className="rows">
              {listed(kind).map((item) => {
                const e = h.entries.get(item.id)!;
                return (
                  <li key={item.id}>
                    <ItemLink id={item.id} withTitle />
                    <p className="evidence">
                      {e.from ? `From ${e.from}` : 'Added'}
                      {e.at ? ` on ${dateTime(e.at)}` : ''}, {pts(item.estimate?.unit === 'points' ? item.estimate.value : 0)}
                      {item.estimate ? '' : ' (no estimate)'}. Source: <code>{e.evidence}</code>
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>None.</p>
          )}
        </div>
      ))}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-note">{note}</span>
    </li>
  );
}
