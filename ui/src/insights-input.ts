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

/** The scheme a toil project's page uses: the built-in one it names, else the standard one. */
export function schemeFor(name: string | null | undefined): { scheme: ReturnType<typeof defaultScheme>; note: string | null } {
  const named = name ? builtinScheme(name) : undefined;
  if (named) return { scheme: named, note: null };
  return { scheme: defaultScheme(), note: name ? `This Toil project names a classification, ${name}, that Toil UI can't read, so the standard Keep the lights on or Feature split is used.` : null };
}

/** The people as the model reads them. */
export const insightsPeople = (people: readonly PersonLike[]): InsightsPerson[] => people.map((p) => ({ name: p.name, ...(p.team ? { team: p.team } : {}), ...(p.email ? { email: p.email } : {}), ids: p.ids }));

/** Items, people, each item's category (null where the engine stayed unsure) and the scheme's categories. */
export function insightsBase(items: WorkItem[], people: readonly PersonLike[], schemeName?: string | null): InsightsBase {
  const { scheme, note } = schemeFor(schemeName);
  const verdicts = new Map(classify({ scheme, items }).result.verdicts.map((v) => [v.id, v.category]));
  const categories: Record<string, string | null> = {};
  for (const i of items) categories[i.id] = verdicts.get(i.id) ?? null;
  const cats: InsightsCategory[] = scheme.categories.map((c) => ({ id: c.id, name: c.name, short: c.short }));
  // A record written by hand may leave `history` out; the model reads null as "never read" and fails on a missing one.
  const read = items.map((i) => (i.history === undefined ? { ...i, history: null } : i));
  return { items: read, people: insightsPeople(people), categories, scheme: { name: scheme.name, revision: scheme.revision, categories: cats }, schemeNote: note };
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
