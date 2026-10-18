/**
 * Traceability: ticket to pull request to build, for the current sprint, with
 * the gaps flagged. The table scrolls inside its own box on a phone rather than
 * widening the page. Audit-ready, in the sense that nobody had to be asked.
 */

import { useState } from 'react';
import { ItemLink } from '../components/items.tsx';
import { useData } from '../data.ts';
import { SOURCE_LABEL, STATUS_CATEGORY_LABEL } from '../format.ts';
import { health } from '../model/sprint.ts';
import { FLAG_TEXT, trace } from '../model/trace.ts';
import type { ChangeRef } from '../store.ts';

const KIND = { 'pull-request': 'Pull request', commit: 'Commit', build: 'Build' } as const;

function Change({ change }: { change: ChangeRef }) {
  return (
    <li>
      <a href={change.url}>
        {KIND[change.kind]}: {change.title}
      </a>{' '}
      <span className={`outcome outcome--${change.outcome}`}>{change.state}</span>{' '}
      <span className="field">({SOURCE_LABEL[change.source]})</span>
    </li>
  );
}

export function Trace() {
  const { items, changes, info } = useData();
  const [gapsOnly, setGapsOnly] = useState(false);
  const h = health(items, changes, info.syncedAt);
  const rows = trace(h?.items ?? items, changes);
  const shown = gapsOnly ? rows.filter((r) => r.flags.length) : rows;
  const gaps = rows.filter((r) => r.flags.length).length;

  return (
    <>
      <div className="view-head">
        <h1 tabIndex={-1}>Traceability</h1>
        <p className="lede">
          {h ? `${h.sprint.name}: ` : ''}
          {rows.length} work items, {rows.filter((r) => r.changes.length).length} with linked changes, {gaps} with something to check.
        </p>
      </div>
      <label className="check">
        <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />
        Only items with something to check
      </label>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Work items and their changes">
        <table className="trace">
          <thead>
            <tr>
              <th scope="col">Work item</th>
              <th scope="col">Status</th>
              <th scope="col">Changes</th>
              <th scope="col">Builds</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.item.id}>
                <th scope="row">
                  <ItemLink id={r.item.id} withTitle />
                </th>
                <td>
                  {r.item.status}
                  {r.item.status?.toLowerCase() !== STATUS_CATEGORY_LABEL[r.item.statusCategory].toLowerCase() && (
                    <span className="field"> ({STATUS_CATEGORY_LABEL[r.item.statusCategory]})</span>
                  )}
                </td>
                <td>{r.changes.length ? <ul className="plain">{r.changes.map((c) => <Change key={c.id} change={c} />)}</ul> : 'None linked'}</td>
                <td>{r.builds.length ? <ul className="plain">{r.builds.map((c) => <Change key={c.id} change={c} />)}</ul> : 'None'}</td>
                <td>{r.flags.length ? <ul className="plain flags">{r.flags.map((f) => <li key={f}>{FLAG_TEXT[f]}</li>)}</ul> : 'No gaps'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
