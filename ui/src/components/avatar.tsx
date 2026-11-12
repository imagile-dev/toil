/**
 * A person's avatar: their initials on one of six hues, the same every time.
 * This is the default for the `Avatar` skin slot (src/skins.tsx); colour
 * never carries meaning alone, so it sits beside the person's name or carries
 * the name as its label.
 * Badge photos are optional; the initials have already cleared security.
 */

import type { Person } from '../toil.ts';

export interface AvatarProps {
  person: Person | null;
  /** True where the avatar stands for the name on its own, so it carries the name as its label. */
  labelled?: boolean;
}

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

export function PlainAvatar({ person, labelled = false }: AvatarProps) {
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

/**
 * A small person for beside a name where initials would be too much: a head and
 * shoulders, or for an AI agent a squared head with an antenna, so the two differ
 * by shape and not by colour alone. It takes the text colour and carries no meaning
 * of its own: the name beside it is the label.
 */
export function PersonGlyph({ agent = false }: { agent?: boolean }) {
  return (
    <svg className={`person-glyph${agent ? ' person-glyph--agent' : ''}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" data-glyph={agent ? 'agent' : 'person'}>
      {agent ? (
        <>
          <rect x="3" y="5" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5V2.5M6 8.5h.01M10 8.5h.01M5.5 14.5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="5" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.75 14c.4-2.7 2.6-4.25 5.25-4.25S12.85 11.3 13.25 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
