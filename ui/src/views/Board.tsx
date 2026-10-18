/**
 * The cross-source board: the current sprint's items from every tracker in
 * one set of columns, by OWI status category, with each source's own status
 * word on the card. Filtering by source is a set of checkboxes, which a
 * keyboard and a screen reader already know how to use. Three columns, which is
 * two fewer than the workflow scheme the change board approved.
 */

import { useState } from 'react';
import { Card } from '../components/items.tsx';
import { useData } from '../data.ts';
import { STATUS_CATEGORY_LABEL, sourceLabel } from '../format.ts';
import { health, type Reason } from '../model/sprint.ts';
import { useSkins } from '../skins.tsx';
import type { StatusCategory } from '../store.ts';

const COLUMNS: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

const TAG: Record<Reason['code'], string> = {
  blocked: 'Blocked',
  carried: 'Carried over',
  'failing-build': 'Build failing',
  unestimated: 'Unestimated',
};

export function Board() {
  const { items, changes, info } = useData();
  const { EmptyState } = useSkins();
  const h = health(items, changes, info.syncedAt);
  const sprintItems = h?.items ?? items;
  const sources = [...new Set(sprintItems.map((i) => sourceLabel(i.source.area)))];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = sprintItems.filter((i) => !hidden.has(sourceLabel(i.source.area)));
  // A status the source gave no category for gets its own column rather than a guess.
  const columns = shown.some((i) => i.statusCategory === 'UNKNOWN') ? [...COLUMNS, 'UNKNOWN' as const] : COLUMNS;

  const tags = (id: string) => {
    const out = (h?.risks.find((r) => r.id === id)?.reasons ?? []).map((r) => TAG[r.code]);
    if (h?.entries.get(id)?.kind === 'added') out.unshift('Added mid-sprint');
    return [...new Set(out)];
  };

  const toggle = (source: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  return (
    <>
      <div className="view-head">
        <h1 tabIndex={-1}>Board</h1>
        {h && (
          <p className="lede">
            {h.sprint.name}, day {h.days.gone} of {h.days.total}. {sprintItems.length} items from {sources.length} trackers.
          </p>
        )}
      </div>
      <fieldset className="filters">
        <legend>Show items from</legend>
        {sources.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={!hidden.has(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
      </fieldset>
      <div className="board">
        {columns.map((col) => {
          const cards = shown.filter((i) => i.statusCategory === col);
          return (
            <section key={col} className="column" aria-labelledby={`col-${col}`}>
              <h2 id={`col-${col}`}>
                {STATUS_CATEGORY_LABEL[col]} <span className="count">{cards.length}</span>
              </h2>
              {cards.length === 0 ? (
                <EmptyState message="Nothing here with these filters." />
              ) : (
                <ul className="cards">
                  {cards.map((item) => (
                    <li key={item.id}>
                      <Card item={item} tags={tags(item.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
