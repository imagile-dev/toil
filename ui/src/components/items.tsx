/**
 * The pieces every view shows an item with: a link that names its source and
 * key, a card for the board, and text with `[[id]]` citations turned into
 * links. A citation to an id the Store doesn't hold stays visible as the id, so
 * a wrong one is obvious rather than quietly dropped (principle 4). Footnotes
 * that actually lead somewhere, a first for a status report.
 */

import { segments } from '../agent.ts';
import { useData } from '../data.ts';
import { STATUS_CATEGORY_LABEL, estimateText, itemHref, personText, shortKey, sourceLabel } from '../format.ts';
import type { WorkItem } from '../store.ts';

/** The item's source and key, as a link to its page. */
export function ItemLink({ id, withTitle = false }: { id: string; withTitle?: boolean }) {
  const { byId } = useData();
  const item = byId.get(id);
  if (!item) return <code className="missing">{id}</code>;
  return (
    <a href={itemHref(id)} className="item-link">
      <span className="key">
        <span className="source">{sourceLabel(item.source.area)}</span> {shortKey(item)}
      </span>
      {withTitle && <span className="title"> {item.title}</span>}
    </a>
  );
}

/** Text with its citations as links. */
export function Cited({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((s, i) => ('cite' in s ? <ItemLink key={i} id={s.cite} /> : <span key={i}>{s.text}</span>))}
    </>
  );
}

/** A dotted field name that wraps at its dots, not mid-word (`Microsoft.VSTS.Scheduling.StoryPoints`). */
export function breakable(name: string) {
  return name.split('.').map((part, i) => (i === 0 ? part : <span key={i}><wbr />.{part}</span>));
}

/** The OWI type, with the source's own word beside it when they differ (#206: real field names stay visible). */
export function typeText(item: WorkItem): string {
  const owi = item.type.charAt(0) + item.type.slice(1).toLowerCase();
  return item.typeName && item.typeName.toLowerCase() !== owi.toLowerCase() ? `${item.typeName} (${owi})` : owi;
}

export function Card({ item, tags }: { item: WorkItem; tags: string[] }) {
  return (
    <article className="card" aria-labelledby={`card-${item.id}`}>
      <h3 id={`card-${item.id}`}>
        <a href={itemHref(item.id)}>
          <span className="key">
            <span className="source">{sourceLabel(item.source.area)}</span> {shortKey(item)}
          </span>
          <span className="title">{item.title}</span>
        </a>
      </h3>
      <dl className="facts">
        <div>
          <dt>Type</dt>
          <dd>{typeText(item)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {item.status ?? STATUS_CATEGORY_LABEL[item.statusCategory]}
          </dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>
            {estimateText(item)}
            {item.estimate && <span className="field"> ({breakable(item.estimate.field)})</span>}
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>{personText(item.assignee)}</dd>
        </div>
      </dl>
      {tags.length > 0 && (
        <ul className="tags" aria-label="Flags">
          {tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
