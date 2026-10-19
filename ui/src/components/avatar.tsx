/**
 * A person's avatar: their initials on one of six hues, the same every time.
 * This is the default for the `Avatar` skin slot (src/skins.tsx); colour
 * never carries meaning alone, so it sits beside the person's name or carries
 * the name as its label.
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
