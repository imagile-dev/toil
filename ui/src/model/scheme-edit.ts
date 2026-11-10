/**
 * Editing a classification scheme on a page (#566, "The Classification
 * editor"): a draft the form holds as plain text, the scheme it becomes, the
 * problems with it in words, how many items each rule would catch, and a
 * readable account of how one scheme differs from another. The validity check
 * is toil's own reader (`readScheme`), run in the page before Save can be
 * pressed, so a scheme the page accepts is a scheme `classify scheme set`
 * accepts, and the count beside a rule is the pure engine over the items the
 * page already holds. Saving is not here: it is a person's command, run by the
 * server. A scheme is the one document in the building that the person who
 * reads it is also asked to approve.
 */

import { classify } from '../../../src/core/classify/engine.ts';
import { diffSchemes, readScheme } from '../../../src/core/classify/scheme.ts';
import type { Category, Rule, RuleWhen, Scheme } from '../../../src/core/classify/types.ts';
import { RULE_KEYS } from '../../../src/core/classify/types.ts';
import type { WorkItem } from '../toil.ts';

export interface DraftCategory {
  id: string;
  short: string;
  name: string;
  label: string;
  definition: string;
}

/** A rule as the form holds it: each `when` key a comma-separated line of text. */
export interface DraftRule {
  id: string;
  parent: string;
  label: string;
  type: string;
  title: string;
  then: string;
}

export interface DraftExample {
  item: string;
  title: string;
  category: string;
  why: string;
}

export interface SchemeDraft {
  name: string;
  revision: number;
  categories: DraftCategory[];
  /** One sentence a line. */
  guidance: string;
  examples: DraftExample[];
  rules: DraftRule[];
  signals: boolean;
  /** Kept as the scheme had it: the form leaves each tracker's own spelling of a label alone. */
  labels: Scheme['labels'];
}

const list = (values: readonly string[] | undefined) => (values ?? []).join(', ');
const items = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

export function draftOf(scheme: Scheme): SchemeDraft {
  return {
    name: scheme.name,
    revision: scheme.revision,
    categories: scheme.categories.map((c) => ({ id: c.id, short: c.short, name: c.name, label: c.label, definition: c.definition })),
    guidance: scheme.guidance.join('\n'),
    examples: scheme.examples.map((e) => ({ item: e.item, title: e.title, category: e.category, why: e.why ?? '' })),
    rules: scheme.rules.map((r) => ({ id: r.id, parent: list(r.when.parent), label: list(r.when.label), type: list(r.when.type), title: list(r.when.title), then: r.then })),
    signals: scheme.signals,
    labels: scheme.labels,
  };
}

/** The draft as the scheme file would hold it, for toil's reader. */
export function rawOf(d: SchemeDraft): unknown {
  return {
    name: d.name,
    revision: d.revision,
    categories: d.categories.map((c) => ({ id: c.id.trim(), short: c.short, name: c.name, label: c.label.trim(), definition: c.definition })),
    guidance: d.guidance.split('\n').map((g) => g.trim()).filter(Boolean),
    examples: d.examples.map((e) => ({ item: e.item, title: e.title, category: e.category, ...(e.why.trim() ? { why: e.why.trim() } : {}) })),
    rules: d.rules.map((r) => ({ id: r.id.trim(), when: Object.fromEntries(RULE_KEYS.flatMap((k) => (items(r[k]).length ? [[k, items(r[k])]] : []))), then: r.then })),
    signals: d.signals,
    labels: d.labels,
  };
}

/** One problem, by the part of the form it is in. */
export interface DraftProblem {
  field: string;
  text: string;
}

/** The name a person knows a path by: "categories[1].label" is "Category 2, label". */
export function fieldName(path: string): string {
  const m = /^(categories|rules|examples|guidance)\[(\d+)\](?:\.(\w+))?/.exec(path);
  if (m) {
    const noun = { categories: 'Category', rules: 'Rule', examples: 'Example', guidance: 'Guidance line' }[m[1]!];
    const part = m[3] ? ({ short: 'short form', definition: 'definition', label: 'label', id: 'id', then: 'category', when: 'when' } as Record<string, string>)[m[3]] ?? m[3] : null;
    return `${noun} ${Number(m[2]) + 1}${part ? `, ${part}` : ''}`;
  }
  if (path === 'categories') return 'Categories';
  if (path === 'rules') return 'Rules';
  if (path === '') return 'The scheme';
  return path.replace(/^labels\./, 'Label for ');
}

/** The scheme the draft becomes, or what is wrong with it, in words. */
export function checkDraft(d: SchemeDraft): { scheme: Scheme; problems: [] } | { scheme: null; problems: DraftProblem[] } {
  try {
    return { scheme: readScheme(rawOf(d), 'the scheme').scheme, problems: [] };
  } catch (e) {
    const details = (e as { details?: Array<{ path?: string; message?: string }> }).details;
    const found = Array.isArray(details) && details.length > 0 ? details : [{ path: '', message: e instanceof Error ? e.message : String(e) }];
    return { scheme: null, problems: found.map((p) => ({ field: fieldName(p.path ?? ''), text: `${(p.message ?? '').replace(/^"(\w+)" /, (_m, key: string) => `The ${key} `).replace(/\.$/, '')}.` })) };
  }
}

/**
 * How many items each rule catches on its own, in the scheme's own order of ids: the engine run with that one rule, the
 * built-in signals off and every label ignored, counting only the verdicts the rule itself gave (an item a rule settles
 * but a parent would have settled the same is still the rule's). `null` for a rule that names a category the scheme
 * lacks: that rule catches nothing, and 0 would claim it was read.
 */
export function ruleCounts(scheme: Scheme, work: readonly WorkItem[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const known = new Set(scheme.categories.map((c) => c.id));
  for (const rule of scheme.rules) {
    if (!known.has(rule.then)) {
      out[rule.id] = null;
      continue;
    }
    const alone: Scheme = { ...scheme, rules: [rule], signals: false };
    const verdicts = classify({ scheme: alone, items: [...work], recheck: true }).result.verdicts;
    out[rule.id] = verdicts.filter((v) => v.source === `rule:${rule.id}`).length;
  }
  return out;
}

/** A rule's condition in words: "its title contains export, and its type is Bug". */
export function whenText(when: RuleWhen): string {
  const bits: string[] = [];
  if (when.parent?.length) bits.push(`it sits under ${when.parent.join(' or ')}`);
  if (when.label?.length) bits.push(`it carries the label ${when.label.join(' or ')}`);
  if (when.type?.length) bits.push(`its type is ${when.type.join(' or ')}`);
  if (when.title?.length) bits.push(`its title contains ${when.title.join(' or ')}`);
  return bits.length ? bits.join(', and ') : 'it has no condition yet';
}

const nameOf = (scheme: Pick<Scheme, 'categories'>, id: string) => scheme.categories.find((c) => c.id === id)?.name ?? id;

/** How `after` differs from `before`, a line each, in plain words: what a person reads before they apply a revision. */
export function schemeChangeLines(before: Scheme, after: Scheme): string[] {
  const d = diffSchemes(before, after);
  const lines: string[] = [];
  const cat = (id: string, from: Scheme) => from.categories.find((c: Category) => c.id === id);
  // A label is what `categorize` writes into a tracker, so it is named wherever a category appears or changes.
  for (const id of d.categories.added) lines.push(`Adds the category "${nameOf(after, id)}", written to trackers as the label \`${cat(id, after)?.label ?? id}\`: ${cat(id, after)?.definition ?? ''}`);
  for (const id of d.categories.removed) lines.push(`Removes the category "${nameOf(before, id)}".`);
  for (const id of d.categories.changed) {
    const was = cat(id, before);
    const now = cat(id, after);
    if (was && now && was.definition !== now.definition) lines.push(`Rewrites the definition of "${now.name}". Before: ${was.definition} After: ${now.definition}`);
    else if (was && now && was.label !== now.label) lines.push(`Writes the category "${now.name}" to trackers as the label \`${now.label}\` instead of \`${was.label}\`.`);
    else lines.push(`Changes the category "${nameOf(after, id)}" (its name or short form).`);
  }
  const rule = (id: string, from: Scheme): Rule | undefined => from.rules.find((r) => r.id === id);
  for (const id of d.rules.added) lines.push(`Adds the rule "${id}": when ${whenText(rule(id, after)!.when)}, the category is ${nameOf(after, rule(id, after)!.then)}.`);
  for (const id of d.rules.removed) lines.push(`Removes the rule "${id}".`);
  for (const id of d.rules.changed) lines.push(`Changes the rule "${id}": when ${whenText(rule(id, after)!.when)}, the category is ${nameOf(after, rule(id, after)!.then)}.`);
  if (d.guidance) {
    const added = after.guidance.filter((g) => !before.guidance.includes(g));
    const removed = before.guidance.filter((g) => !after.guidance.includes(g));
    for (const g of added) lines.push(`Adds the guidance: ${g}`);
    for (const g of removed) lines.push(`Removes the guidance: ${g}`);
  }
  if (d.examples) {
    const key = (e: { item: string; category: string }) => `${e.item}\u0000${e.category}`;
    const had = new Set(before.examples.map(key));
    const now = new Set(after.examples.map(key));
    for (const e of after.examples.filter((x) => !had.has(key(x)))) lines.push(`Adds the example ${e.item} ("${e.title}") as ${nameOf(after, e.category)}.`);
    for (const e of before.examples.filter((x) => !now.has(key(x)))) lines.push(`Removes the example ${e.item}.`);
  }
  if (d.signals) lines.push(after.signals ? 'Turns the built-in signals on.' : 'Turns the built-in signals off.');
  if (d.labels) lines.push("Changes a tracker's own spelling of a label.");
  return lines;
}

const stable = (value: unknown): string => JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/**
 * What an AI agent's revised scheme may not change. A label is what `categorize` writes into a tracker, and a category id is
 * what the ledger records, so an agent's revision keeps every existing one exactly: a label it rewrites is put back and
 * listed as ignored, a category it removes or renames refuses the whole revision, and a category it adds keeps the label
 * it gave (the card names it, so a person sees what would be written). Per-tracker spellings (`labels`) stay as they were.
 */
export function guardRevision(before: Scheme, proposed: Scheme): { ok: true; scheme: Scheme; ignored: string[] } | { ok: false; message: string } {
  const had = new Map(before.categories.map((c) => [c.id, c]));
  const has = new Set(proposed.categories.map((c) => c.id));
  const lost = before.categories.filter((c) => !has.has(c.id));
  if (lost.length > 0) {
    return { ok: false, message: `It removes or renames the ${lost.length === 1 ? 'category' : 'categories'} ${lost.map((c) => `"${c.id}"`).join(', ')}. Category ids are what the ledger records, so an AI agent's revision may not change them.` };
  }
  const ignored: string[] = [];
  const categories = proposed.categories.map((c) => {
    const was = had.get(c.id);
    if (!was || c.label === was.label) return c;
    ignored.push(`Ignored: an AI agent can't change a label, so "${was.name}" is still written to trackers as the label \`${was.label}\`, not \`${c.label}\`.`);
    return { ...c, label: was.label };
  });
  if (stable(proposed.labels) !== stable(before.labels)) ignored.push("Ignored: an AI agent can't change a label, so each tracker's own spelling of a label is as it was.");
  return { ok: true, scheme: { ...proposed, categories, labels: before.labels }, ignored };
}

/** The scheme on one line, for the editor's closed section: "Keep the lights on / Feature, 2 rules, signals on, revision 3". */
export function schemeSummaryLine(scheme: Scheme): string {
  const rules = scheme.rules.length;
  return `${scheme.categories.map((c) => c.name).join(' / ')}, ${rules === 0 ? 'no rules' : `${rules} ${rules === 1 ? 'rule' : 'rules'}`}, signals ${scheme.signals ? 'on' : 'off'}, revision ${scheme.revision}`;
}

/** A new, blank rule for the form to add. */
export const blankRule = (then: string): DraftRule => ({ id: '', parent: '', label: '', type: '', title: '', then });

/** A new, blank category for the form to add. */
export const blankCategory = (): DraftCategory => ({ id: '', short: '', name: '', label: '', definition: '' });

/** Whether two drafts say the same: Save stays off until they differ. */
export const sameDraft = (a: SchemeDraft, b: SchemeDraft): boolean => JSON.stringify(rawOf(a)) === JSON.stringify(rawOf(b));
