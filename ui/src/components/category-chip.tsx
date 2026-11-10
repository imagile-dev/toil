/**
 * An item's category as a small chip (#567, docs/work-classification-proposal.md,
 * "How the category is named"): its plain name, "Keep the lights on", with a badge
 * for how it was decided, and its short form ("KTLO") and definition one hover
 * away. A person reads the name to act; the short form is for someone who
 * already knows it. Unsure is a category of its own on the screen, because an item
 * nobody has decided about should not look like one somebody has. The label
 * shows what the tracker holds as it holds it; this shows what toil made of it.
 * A chip with a title attribute, in an age of tooltips, is a modest thing to be proud of.
 */

import type { Verdict } from '../../../src/core/classify/types.ts';
import type { WorkInsights } from '../model/work-insights.ts';
import './items-drawer.css';

/** How a verdict was reached, in the words a person would use. */
export function decidedBy(source: Verdict['source']): string {
  if (source === 'label' || source === 'field') return 'label';
  if (source === 'agent') return 'AI agent';
  if (source === 'person') return 'person';
  if (source === 'unsure') return 'not decided';
  return 'rules';
}

/** What a hover says about a category: "KTLO: Security patches, bug fixes…", or that nobody has decided. */
export function categoryHint(ins: WorkInsights, id: string | null): string {
  if (id === null) return 'Unsure: no rule, label or person has decided this one yet.';
  const c = ins.definitions[id];
  return c ? `${c.short}: ${c.definition}` : id;
}

/** A category's name where a sentence needs one: its plain name, its short form and definition on hover. */
export function CategoryName({ ins, id }: { ins: WorkInsights; id: string | null }) {
  const c = id === null ? null : ins.definitions[id];
  return (
    <span className="cat-name" title={categoryHint(ins, id)} tabIndex={0}>
      {c?.name ?? (id === null ? 'Unsure' : id)}
    </span>
  );
}

export function CategoryChip({ ins, itemId }: { ins: WorkInsights; itemId: string }) {
  const v = ins.verdicts.get(itemId);
  const id = v?.category ?? null;
  const name = id === null ? 'Unsure' : (ins.definitions[id]?.name ?? id);
  const how = v ? decidedBy(v.source) : 'not decided';
  const title = `${categoryHint(ins, id)}${v && id !== null ? ` Decided by ${how}: ${v.reason}` : ''}`;
  return (
    <span className={`cat-chip${id === null ? ' cat-chip--unsure' : ''}`} title={title} tabIndex={0} data-category={id ?? 'none'}>
      {name}
      {id !== null && <span className="cat-chip__how"> · {how}</span>}
    </span>
  );
}
