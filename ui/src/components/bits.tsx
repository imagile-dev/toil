/**
 * Small pieces the views share: a person's avatar, a status chip in the
 * status category's colour, and an item's insight chips. Colour never carries
 * meaning alone: every chip says its word, and the avatar sits beside the
 * person's name or carries it as its label. Name tags, colour-coded, with no
 * lanyard.
 */

import { INSIGHT_LABEL, type Insight } from '../model/insights.ts';
import { STATUS_CATEGORY_LABEL } from '../format.ts';
import type { Person, StatusCategory } from '../toil.ts';

/** Up to two initials from a name, else from the id (a GitHub login). */
export function initials(p: Person): string {
  const words = (p.name ?? p.id).replace(/[^\p{L}\p{N} .-]/gu, ' ').split(/[\s.-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0], words[0]?.[1]];
  return letters.filter(Boolean).join('').toUpperCase() || '?';
}

/** One of six hues per person, the same every time, from tokens every theme defines. */
const HUES = 6;
export function hueOf(p: Person): number {
  let n = 0;
  for (const c of p.id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % HUES;
}

export function Avatar({ person, labelled = false }: { person: Person | null; labelled?: boolean }) {
  if (!person) {
    return (
      <span className="avatar avatar--none" {...(labelled ? { role: 'img', 'aria-label': 'Unassigned' } : { 'aria-hidden': true })}>
        –
      </span>
    );
  }
  const name = person.name ?? person.id;
  return (
    <span className={`avatar avatar--${hueOf(person)}`} {...(labelled ? { role: 'img', 'aria-label': name, title: name } : { 'aria-hidden': true })}>
      {initials(person)}
    </span>
  );
}

export function StatusChip({ category, status }: { category: StatusCategory; status: string | null }) {
  const label = STATUS_CATEGORY_LABEL[category];
  return (
    <span className={`chip chip--${category.toLowerCase()}`}>
      {status ?? label}
      {status && status.toLowerCase() !== label.toLowerCase() && <span className="chip-cat"> · {label}</span>}
    </span>
  );
}

export function InsightChips({ insights, max = 3 }: { insights: Insight[]; max?: number }) {
  if (!insights.length) return null;
  const shown = insights.slice(0, max);
  return (
    <ul className="insight-chips" aria-label="Insights">
      {shown.map((i) => (
        <li key={i.code} className={`insight insight--w${i.weight}`}>
          {INSIGHT_LABEL[i.code]}
        </li>
      ))}
      {insights.length > max && <li className="insight insight--more">+{insights.length - max} more</li>}
    </ul>
  );
}
