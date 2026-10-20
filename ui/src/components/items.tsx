/**
 * The pieces every view shows an item with: a link that names its source and
 * key, and text with `[[id]]` citations turned into links. A citation to an id
 * the dossier doesn't hold stays visible as the id, so a wrong one is obvious
 * rather than quietly dropped (principle 4). Footnotes that actually lead
 * somewhere, a first for a status report.
 */

import { segments } from '../agent.ts';
import { useData } from '../data.ts';
import { itemHref, prName, shortKey, sourceLabel } from '../format.ts';
import { themed } from '../theme-context.ts';
import type { ThemeManifest } from '../themes.ts';
import type { Change, WorkItem } from '../toil.ts';

/** The item's source and key, as a link to its page. */
export function ItemLink({ id, withTitle = false }: { id: string; withTitle?: boolean }) {
  const { byId, prById, dossier } = useData();
  const item = byId.get(id);
  const pr = item ? undefined : prById?.get(id);
  if (pr) return <PrLink change={pr} withTitle={withTitle} />;
  if (!item) return <code className="missing">{id}</code>;
  return (
    <a href={itemHref(dossier.name, id)} className="item-link">
      <span className="key">
        <span className="source">{sourceLabel(item.source.area)}</span> {shortKey(item)}
      </span>
      {withTitle && <span className="title"> {item.title}</span>}
    </a>
  );
}

/** A pull request, linked to its page on the host where the record has one. */
export function PrLink({ change, withTitle = false }: { change: Change; withTitle?: boolean }) {
  const label = (
    <>
      <span className="key">
        <span className="source">{sourceLabel(change.source.area)}</span> {prName(change.id)}
      </span>
      {withTitle && <span className="title"> {change.title}</span>}
    </>
  );
  return change.url ? (
    <a href={change.url} className="item-link">
      {label}
    </a>
  ) : (
    <span className="item-link">{label}</span>
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

/** The OWI type, with the source's own word beside it when they differ (#206: real field names stay visible). */
export function typeText(item: WorkItem, theme?: ThemeManifest): string {
  const owi = item.type.charAt(0) + item.type.slice(1).toLowerCase();
  const text = item.typeName && item.typeName.toLowerCase() !== owi.toLowerCase() ? `${item.typeName} (${owi})` : owi;
  // A theme may call an epic a quest, beside the source's own word.
  return theme?.terms?.epic && item.type === 'EPIC' ? themed(theme, 'epic', item.typeName ?? owi) : text;
}
