/**
 * What `pivot()` needs besides a spec, built the one way (#567): the items, the
 * toil project's people for `team`, and a category for every item from the pure
 * classification engine and the scheme the toil project names (a built-in one;
 * a scheme in a file lives where only toil reads it, so the standard
 * Keep the lights on / Feature split stands in, and the note says so). The
 * agent's `insights_pivot` and its `owi_query` filters call this, so the figure
 * a chart shows and the figure the agent quotes cannot come from two readings
 * of the same backlog. Pure: no clock, no file, no network. Two committees
 * computing the same percentage in two spreadsheets is how a quarter gets two
 * truths; this file is the one spreadsheet.
 */

import { builtinScheme, defaultScheme } from '../../src/core/classify/builtin.ts';
import { classify } from '../../src/core/classify/engine.ts';
import type { Scheme, Verdict } from '../../src/core/classify/types.ts';
import { addDays, dayOf, type InsightsCategory, type InsightsPerson, type PivotInput, type ValuesContext } from '../../src/core/insights/index.ts';
import { DEFAULT_PERIOD_DAYS } from '../../src/core/insights/pivot.ts';
import type { WorkItem } from './toil.ts';

/** The toil project's people, as a toil project lists them. */
export interface PersonLike {
  name: string;
  team?: string | undefined;
  email?: string | null | undefined;
  ids: Record<string, string>;
}

export interface InsightsBase extends Pick<PivotInput, 'items' | 'categories' | 'scheme'> {
  people: InsightsPerson[];
  /** Said on screen when the toil project names a scheme this page cannot read; null otherwise. */
  schemeNote: string | null;
}

/**
 * What a page knows about classification beyond the toil project's own file: the scheme as toil resolved it (the person's own
 * copy, or the repository's, which the page cannot find by name), and what a person has said about each item, from the ledger.
 * Both come from toil's own reads, never from this page's guess, so a screen and the agent's tools classify the same way.
 */
export interface Classification {
  scheme?: Scheme | null | undefined;
  /** An item's standing say from a person (the ledger's last correction), for the engine's `person` input. */
  person?: Record<string, { category: string; reason: string | null }> | undefined;
  /** Said when the scheme or the ledger could not be read, so a figure built without them says so rather than passing for the person's own. */
  note?: string | undefined;
}

/** The scheme a toil project's page uses: the one toil resolved when it was read, else the built-in one it names, else the standard one. */
export function schemeFor(name: string | null | undefined, given?: Scheme | null): { scheme: Scheme; note: string | null } {
  if (given) return { scheme: given, note: null };
  const named = name ? builtinScheme(name) : undefined;
  if (named) return { scheme: named, note: null };
  return { scheme: defaultScheme(), note: name ? `This Toil project names a classification, ${name}, that Toil UI can't read, so the standard Keep the lights on or Feature split is used.` : null };
}

/** The people as the model reads them. */
export const insightsPeople = (people: readonly PersonLike[]): InsightsPerson[] => people.map((p) => ({ name: p.name, ...(p.team ? { team: p.team } : {}), ...(p.email ? { email: p.email } : {}), ids: p.ids }));

/** The scheme's categories as the pivot reads them, in the scheme's order. */
export const schemeSummary = (scheme: Scheme): NonNullable<PivotInput['scheme']> => ({
  name: scheme.name,
  revision: scheme.revision,
  categories: scheme.categories.map((c): InsightsCategory => ({ id: c.id, name: c.name, short: c.short })),
});

/** What the engine decided for each item, under the scheme the toil project names. The one place items are classified for a page or an agent. */
export function classifyItems(items: WorkItem[], schemeName?: string | null, extra: Classification = {}): { scheme: Scheme; note: string | null; verdicts: Map<string, Verdict> } {
  const { scheme, note } = schemeFor(schemeName, extra.scheme);
  const person = extra.person && Object.keys(extra.person).length > 0 ? { person: extra.person } : {};
  return { scheme, note: [note, extra.note].filter(Boolean).join(' ') || null, verdicts: new Map(classify({ scheme, items, ...person }).result.verdicts.map((v) => [v.id, v])) };
}

/** Each item's category id, null where the engine stayed unsure, from verdicts that may cover more items than these. */
export function categoriesOf(items: readonly WorkItem[], verdicts: ReadonlyMap<string, Pick<Verdict, 'category'>>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const i of items) out[i.id] = verdicts.get(i.id)?.category ?? null;
  return out;
}

/** A record written by hand may leave `history` out; the model reads null as "never read" and fails on a missing one. */
export const withHistory = (items: WorkItem[]): WorkItem[] => (items.some((i) => i.history === undefined) ? items.map((i) => (i.history === undefined ? { ...i, history: null } : i)) : items);

/** Items, people, each item's category (null where the engine stayed unsure) and the scheme's categories. */
export function insightsBase(items: WorkItem[], people: readonly PersonLike[], schemeName?: string | null, extra: Classification = {}): InsightsBase {
  const { scheme, note, verdicts } = classifyItems(items, schemeName, extra);
  return { items: withHistory(items), people: insightsPeople(people), categories: categoriesOf(items, verdicts), scheme: schemeSummary(scheme), schemeNote: note };
}

/** The context a dimension's values are read with, over the default period up to `asOf`: what a filter on a dimension is judged by. */
export function valuesContext(base: InsightsBase, asOf: string): ValuesContext {
  const today = dayOf(asOf) ?? asOf.slice(0, 10);
  return {
    asOf,
    period: { from: addDays(today, 1 - DEFAULT_PERIOD_DAYS), to: today },
    people: base.people,
    ...(base.categories ? { categories: base.categories } : {}),
    ...(base.scheme ? { scheme: base.scheme } : {}),
    index: new Map(base.items.map((i) => [i.id, i])),
  };
}
