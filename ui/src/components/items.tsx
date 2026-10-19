/**
 * The pieces every view shows an item with: a link that names its source and
 * key, and text with `[[id]]` citations turned into links. A citation to an id
 * the dossier doesn't hold stays visible as the id, so a wrong one is obvious
 * rather than quietly dropped (principle 4). Footnotes that actually lead
 * somewhere, a first for a status report.
 */

import { segments } from '../agent.ts';
import { useData } from '../data.ts';
import { itemHref, shortKey, sourceLabel } from '../format.ts';
import { themed } from '../theme-context.ts';
import type { ThemeManifest } from '../themes.ts';
import type { WorkItem } from '../toil.ts';

/** The item's source and key, as a link to its page. */
export function ItemLink({ id, withTitle = false }: { id: string; withTitle?: boolean }) {
  const { byId, dossier } = useData();
  const item = byId.get(id);
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
  return theme && item.type === 'EPIC' ? themed(theme, 'epic', item.typeName ?? owi) : text;
}
