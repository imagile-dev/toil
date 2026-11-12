/**
 * What a person must settle in the Classify view, and what is waiting to be
 * written back (#566, docs/work-classification-proposal.md, "Toil UI"). All of
 * it is a pure reading of the same engine `toil classify run` uses, over the
 * items the page already holds and the ledger's standing corrections, so a row
 * on screen and a line in a plan cannot come from two readings of one backlog.
 *
 * - **Needs a person**: the items nobody has answered that are either unsure,
 *   or where a rule or a signal and a label or field already on the item
 *   disagree. The disagreement is found by running the engine twice, with and
 *   without `recheck`: a label wins the first run, the rules the second.
 * - **Waiting to be written**: items a person (or an accepted agent answer)
 *   decided whose tracker does not yet say so. Derived, never stored, so it is
 *   still right after a reload, and empties itself once the tracker catches up.
 *
 * Unknown is not zero (principle 12): an item no run could settle is unsure, and
 * a share nobody has read is null. The form that records each decision lives
 * in the minutes of a meeting that was never held.
 */

import { classify } from '../../../src/core/classify/engine.ts';
import type { AgentVerdict, ClassifyArea, PersonSay, ResolvedTarget, Scheme, Verdict } from '../../../src/core/classify/types.ts';
import { CLASSIFY_AREAS, UNSURE } from '../../../src/core/classify/types.ts';
import type { WorkItem } from '../toil.ts';

/** A person's last word on an item: a category, or null where they took it back to "unsure". */
export interface Say {
  category: string | null;
  reason: string | null;
  /** The door that recorded it, where the ledger says: a person, an AI agent for a person (`mcp`), or a label changed in the tracker. */
  via?: 'cli' | 'mcp' | 'api' | 'tracker' | undefined;
  /** What the tracker held when they said it; a label that still says it is the tracker not having caught up. */
  from?: string | undefined;
}

/** What the engine takes as `person`: only an actual category stands as a person's say. */
export function personOf(standing: Readonly<Record<string, Say>>): Record<string, PersonSay> {
  const out: Record<string, PersonSay> = {};
  for (const [id, say] of Object.entries(standing)) {
    if (say.category !== null) out[id] = { category: say.category, reason: say.reason, ...(say.via ? { via: say.via } : {}), ...(say.from !== undefined ? { from: say.from } : {}) };
  }
  return out;
}

export interface NeedsRow {
  item: WorkItem;
  /** Why it is here: nothing settled it, or the item's own label or field and a rule or signal point different ways. */
  kind: 'unsure' | 'disagree';
  /** What the rules and signals say when the label is ignored: always set for a disagreement, null for an unsure item. */
  suggested: Verdict | null;
  /** What the item carries now (its label or field), for a disagreement. */
  carried: Verdict | null;
}

/**
 * The items waiting for a person, in the order given. An item with a standing say, a category or a taking-back, has
 * been answered and is not here. `targets` lets a field already holding a category count as one the item carries.
 */
export function needsAPerson(items: WorkItem[], scheme: Scheme, standing: Readonly<Record<string, Say>>, targets: Partial<Record<ClassifyArea, ResolvedTarget>> = {}): NeedsRow[] {
  const person = personOf(standing);
  const as = (recheck: boolean) => new Map(classify({ scheme, items, targets, planFields: false, person, ...(recheck ? { recheck } : {}) }).result.verdicts.map((v) => [v.id, v]));
  const asIs = as(false);
  const ignoringLabels = as(true);
  const rows: NeedsRow[] = [];
  for (const item of items) {
    if (Object.hasOwn(standing, item.id)) continue;
    const now = asIs.get(item.id);
    if (!now) continue;
    if (now.category === null) {
      rows.push({ item, kind: 'unsure', suggested: null, carried: null });
      continue;
    }
    if (now.source !== 'label' && now.source !== 'field') continue;
    const fresh = ignoringLabels.get(item.id);
    if (fresh && fresh.category !== null && fresh.category !== now.category) rows.push({ item, kind: 'disagree', suggested: fresh, carried: now });
  }
  return rows;
}

/** The items a decision is still to reach the tracker for, with who decided and what the tracker says now. */
export interface PendingRow {
  item: WorkItem;
  /** The category decided. */
  category: string;
  by: 'person' | 'agent';
  reason: string | null;
  /** What the item's label or field says now: null where it carries none (nothing is written yet). */
  tracker: string | null;
}

const isWritable = (area: string): area is ClassifyArea => (CLASSIFY_AREAS as readonly string[]).includes(area);

/**
 * Decided items whose tracker still says something else (or nothing). A person's standing say outranks an accepted
 * agent answer for the same item, since it is the later and the more deliberate word. An item from a tracker toil
 * writes no category to is left out: there is nothing to apply, and the plan would only warn.
 */
export function pendingChanges(items: WorkItem[], scheme: Scheme, standing: Readonly<Record<string, Say>>, accepted: ReadonlyMap<string, AgentVerdict>, targets: Partial<Record<ClassifyArea, ResolvedTarget>> = {}, appliedNow: ReadonlyMap<string, string> = new Map()): PendingRow[] {
  const trackerSays = new Map(classify({ scheme, items, targets, planFields: false }).result.verdicts.map((v) => [v.id, v]));
  const rows: PendingRow[] = [];
  for (const item of items) {
    if (!isWritable(item.source.area)) continue;
    const said = standing[item.id];
    const agent = accepted.get(item.id);
    const decided = said?.category ? { category: said.category, by: 'person' as const, reason: said.reason } : agent && agent.category !== UNSURE ? { category: agent.category, by: 'agent' as const, reason: agent.reason } : null;
    if (!decided) continue;
    const there = trackerSays.get(item.id);
    // What an Apply wrote this session stands for the tracker until the next sync reads it back, so a change already made isn't offered twice.
    const tracker = appliedNow.get(item.id) ?? (there && (there.source === 'label' || there.source === 'field') ? there.category : null);
    if (tracker !== decided.category) rows.push({ item, ...decided, tracker });
  }
  return rows;
}

/** A category's choice in the row's segmented control: its id, its plain name and the key that picks it. */
export interface Choice {
  id: string | null;
  name: string;
  /** The key that picks it, shown on the button: a letter in a two-category scheme, a digit in any other; U is always Unsure. */
  key: string;
  short: string | null;
}

/**
 * The choices for a scheme: every category by its plain name, then Unsure. The two-category scheme of KTLO and Feature gets K and F (the keys the shortcut table names); any other scheme gets 1 to 9. U is always
 * Unsure, so the key that means "I can't tell" never moves.
 */
export function choicesOf(scheme: { categories: ReadonlyArray<{ id: string; short: string; name: string }> }): Choice[] {
  const letters = scheme.categories.length === 2 ? scheme.categories.map((c) => c.short.charAt(0).toUpperCase()) : [];
  const lettered = letters[0] === 'K' && letters[1] === 'F';
  return [
    ...scheme.categories.map((c, i): Choice => ({ id: c.id, name: c.name, short: c.short, key: lettered ? letters[i]! : String(i + 1) })),
    { id: null, name: 'Unsure', short: null, key: 'U' },
  ].slice(0, 10);
}

/** The choice a key picks, or undefined. Case does not matter. */
export const choiceForKey = (choices: readonly Choice[], key: string): Choice | undefined => choices.find((c) => c.key === key.toUpperCase());

/** How a verdict's source reads to a person, as a short phrase ("its parent", "a rule", "a label on the item"). */
export function sourcePhrase(source: Verdict['source']): string {
  if (source === 'label') return 'a label on the item';
  if (source === 'field') return 'a field on the item';
  if (source === 'parent') return 'its parent';
  if (source === 'agent') return 'your AI agent';
  if (source === 'person') return 'a person';
  if (source === 'unsure') return 'nothing';
  if (source === 'signal:type') return 'its type';
  if (source.startsWith('signal:')) return 'a built-in signal';
  return 'a rule';
}

/** A source in the plain words "How it's doing" uses for what people overrule: "the bug-type signal", "a rule you wrote". */
export function sourceName(source: string, scheme: Pick<Scheme, 'rules'>): string {
  const plain: Record<string, string> = {
    'signal:type': 'the bug or incident type',
    'signal:security-id': 'a security or vulnerability id in the title',
    'signal:incident-link': 'a link to an incident',
    'signal:bot-author': 'a dependency bot as author',
    'signal:label': 'a label such as security or dependencies',
    'signal:title': 'a title that starts Bump, Upgrade or Patch',
    label: 'a label already on the item',
    field: 'the field already on the item',
    parent: "the parent's category",
    agent: 'the AI agent',
    unsure: 'nothing',
  };
  if (plain[source]) return plain[source]!;
  if (source.startsWith('rule:')) {
    const id = source.slice('rule:'.length);
    return scheme.rules.some((r) => r.id === id) ? `the rule "${id}"` : `a rule (${id})`;
  }
  return source.startsWith('signal:') ? 'a built-in signal' : source;
}

/** "3 of 8" with the word for one and many. */
export const timesText = (n: number, of: number) => `${n} of ${of} ${of === 1 ? 'time' : 'times'}`;

/** Corrections people need to have made since the last tune before the page offers to improve the scheme. */
export const TUNE_AFTER = 10;

/** A share as a percentage, or a dash where nobody has checked: unknown is not zero. */
export const shareText = (share: number | null | undefined): string => (share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`);

/** What a plain-words sentence says about a share: a figure, or that it is not read yet. */
export const shareWords = (share: number | null | undefined): string => (share === null || share === undefined ? 'not read yet' : `${Math.round(share * 100)}%`);

/**
 * Whether this toil project's work items were read (principle 12): `unread` when none came back (nothing synced, or
 * every tracker's work-item read failed), `partial` when some trackers were read and others failed, `read` otherwise.
 * `failed` names the places whose work items couldn't be read. The same signal the Charts list ("no items were read")
 * and the Board's "work items not read" line stand on.
 */
export function workRead(items: ReadonlyArray<unknown>, targets: ReadonlyArray<{ label: string; work: boolean }> | undefined): { state: 'read' | 'partial' | 'unread'; failed: string[] } {
  const failed = (targets ?? []).filter((t) => !t.work).map((t) => t.label);
  if (items.length === 0 || (targets && targets.length > 0 && failed.length === targets.length)) return { state: 'unread', failed };
  return { state: failed.length > 0 ? 'partial' : 'read', failed };
}
