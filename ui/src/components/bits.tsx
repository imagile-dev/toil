/**
 * Small pieces the views share: a person's avatar, a status chip in the
 * status category's colour, and an item's insight chips. Colour never carries
 * meaning alone: every chip says its word, and the avatar sits beside the
 * person's name or carries it as its label. Name tags, colour-coded, with no
 * lanyard.
 */

import { INSIGHT_LABEL, type Insight } from '../model/insights.ts';
import { STATUS_CATEGORY_LABEL } from '../format.ts';
import { useSkins } from '../skins.tsx';
import type { StatusCategory } from '../toil.ts';
import type { AvatarProps } from './avatar.tsx';

export { hueOf, initials } from './avatar.tsx';

/** A person's avatar, through the active theme's `Avatar` skin. */
export function Avatar(props: AvatarProps) {
  const { Avatar: Skin } = useSkins();
  return <Skin {...props} />;
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
