/**
 * The mix of one person's open work, as one bar on their card (#567, seat M7
 * "is anyone carrying too much, and of what kind?"). It says what kind of work is
 * on a plate and nothing about how anyone is doing: one bar, no score, no
 * percentage beside the person, no ordering of people by anything. The menu above
 * the cards picks the dimension for every card at once, and a segment opens the
 * items behind it. A person with no open work has no bar rather than an empty one,
 * and a dimension the read never fetched is a dash (principle 12). The plate is
 * measured; the person, per the policy on file, is not.
 */

import { MixBar } from '../components/chartkit/index.ts';
import { Unread } from '../components/unread.tsx';
import { useAddress, useWorkInsights } from '../insights-data.ts';
import { encodeDrill, type Drill } from '../model/drill.ts';
import { openWorkSpec } from '../model/lanes.ts';
import { labelOfDimension } from '../model/work-insights.ts';
import './lanes.css';

/** Opens the list of items a drill names, in the items drawer, keeping the filters in the address. */
export function useOpenItems() {
  const { go } = useAddress();
  return (d: Drill) =>
    go((q) => {
      q.set('items', encodeDrill(d));
      q.delete('item');
    });
}

export function PersonMix({ name, dimension }: { name: string; dimension: string }) {
  const ins = useWorkInsights();
  const open = useOpenItems();
  const spec = openWorkSpec(name, dimension);
  const result = ins.run(spec);
  const label = `${name}: open work by ${labelOfDimension(dimension).toLowerCase()}`;
  if (!result.split?.read) {
    return (
      <div className="person-mix" data-person-mix="unread">
        <p className="person-mix__label">Open work by {labelOfDimension(dimension).toLowerCase()}</p>
        <Unread label={`${label}: not read yet`} />
      </div>
    );
  }
  // Nothing open is nothing to show, and says nothing: the card's own "Nothing in progress" is the answer.
  if ((result.total.value ?? 0) <= 0) return null;
  return (
    <div className="person-mix" data-person-mix={dimension}>
      <p className="person-mix__label">Open work by {labelOfDimension(dimension).toLowerCase()}</p>
      <MixBar result={result} scheme={{ categories: ins.scheme.categories }} label={label} onDrill={(c) => open({ kind: 'cell', spec, row: c.row.key, column: c.column.key })} />
      {/* The bar's colours are not a key anyone can read cold, so the counts are under it in words: what, and how many, never a share. */}
      <p className="person-mix__list" data-person-mix-list="">
        {result.rows.flatMap((r, i) => {
          const n = result.rowTotals[i]!.value ?? 0;
          return n > 0 ? [`${r.label} ${n}`] : [];
        }).join(' · ')}
      </p>
    </div>
  );
}
