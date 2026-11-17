/**
 * Ticket rules on screen (#657): the seam the page reads toil's
 * `standards check` through, and the pure helpers its views share. The local
 * server answers from its cache (ui/server/standards.ts), running toil's own
 * command over the items it synced; the site preview and `toil-ui --sample`
 * answer from the sample's items and the built-in rules
 * (src/fixtures/standards.ts). Nothing here writes: fixing an item is an
 * assignment, whose proposal a person applies through toil's write gate.
 * Toil calls them standards in its files; on screen they are ticket rules,
 * because nobody has ever been reassured by being told a ticket is
 * non-standard.
 */

import type { RuleResult, StandardsCheckResult } from '../../src/core/standards/types.ts';
import { RULES_UNREAD, type RulesReading } from './model/readiness.ts';
import type { WorkItem } from './toil.ts';

export type { RuleResult, StandardsCheckResult };

/** What `api/standards` answers: toil's check, or null when the toil project hasn't synced, so nothing was read; and toil's warnings, in its words. */
export interface RulesView {
  result: StandardsCheckResult | null;
  warnings: string[];
}

/** The page's side: the server's route, or the sample's. Throws with a message the page shows. */
export interface RulesApi {
  check(toilProject: string): Promise<RulesView>;
}

/** One rule's outcome on one item, with the rule's own text: what an assignment to fix it is told. */
export interface RuleFound extends RuleResult {
  text: string;
}

/** The server's side: the page's read, and one rule on one item, as the assignment queue checks it before it queues a fix. */
export interface RulesBackend extends RulesApi {
  ruleFor(toilProject: string, item: string, standard: string, rule: string): Promise<RuleFound | null>;
}

/** A standard's or a rule's name: what the route and an assignment accept. */
export const RULE_REF = /^[a-z][a-z0-9-]{0,62}$/;

/** The page's reading from what the read gave: read (with each item's results), not read yet, or failed with toil's message. */
export function readingOf(view: RulesView | null, error?: string): RulesReading {
  if (error !== undefined) return { state: 'failed', byItem: new Map(), message: error };
  if (!view?.result) return RULES_UNREAD;
  return { state: 'read', byItem: new Map(view.result.items.map((i) => [i.id, i.results])), message: null };
}

/** One rule's result on one item in a check, with the rule's text; null when the rule doesn't apply to it, or isn't one the check knows. */
export function ruleIn(result: StandardsCheckResult, item: string, standard: string, rule: string): RuleFound | null {
  const found = result.items.find((i) => i.id === item)?.results.find((r) => r.standard === standard && r.rule === rule);
  const text = result.standards.find((s) => s.name === standard)?.rules.find((r) => r.id === rule)?.text;
  return found && text !== undefined ? { ...found, text } : null;
}

/** A thin or failed rule: one an AI agent could be asked to fix. */
export const fixable = (state: RuleResult['state']) => state === 'thin' || state === 'fail';

const NOUN: Record<string, [string, string]> = { STORY: ['story', 'stories'], BUG: ['bug', 'bugs'], TASK: ['task', 'tasks'], EPIC: ['epic', 'epics'], INCIDENT: ['incident', 'incidents'] };

/** One rule's line on the Command Center: how many of the open items it applies to miss it, and how many couldn't be checked. */
export interface RuleLine {
  standard: string;
  rule: string;
  name: string;
  /** `standard/rule`, the address filter's value. */
  ref: string;
  applies: number;
  miss: number;
  skipped: number;
  /** "story" or "stories", from the types it applied to; "item" when they are mixed. */
  noun: (n: number) => string;
}

/**
 * Each rule's line over these items (the open ones on screen), in the
 * check's own order: a rule that applies to none of them has no line.
 */
export function ruleLines(result: StandardsCheckResult, items: readonly WorkItem[]): RuleLine[] {
  const shown = new Set(items.map((i) => i.id));
  const typeOf = new Map(items.map((i) => [i.id, i.type]));
  const out: RuleLine[] = [];
  for (const s of result.standards) {
    for (const r of s.rules) {
      let applies = 0;
      let miss = 0;
      let skipped = 0;
      const types = new Set<string>();
      for (const i of result.items) {
        if (!shown.has(i.id)) continue;
        const hit = i.results.find((x) => x.standard === s.name && x.rule === r.id);
        if (!hit) continue;
        applies++;
        types.add(typeOf.get(i.id) ?? 'OTHER');
        if (hit.state === 'skipped') skipped++;
        else if (fixable(hit.state)) miss++;
      }
      if (applies === 0) continue;
      const [one, many] = types.size === 1 ? (NOUN[[...types][0]!] ?? ['item', 'items']) : ['item', 'items'];
      out.push({ standard: s.name, rule: r.id, name: r.name, ref: `${s.name}/${r.id}`, applies, miss, skipped, noun: (n) => (n === 1 ? one : many) });
    }
  }
  return out;
}

/** The items that miss a rule (`standard/rule`), by OWI id; null when the reference names no rule the check knows. */
export function missing(result: StandardsCheckResult, ref: string): Set<string> | null {
  const [standard, rule] = ref.split('/');
  if (!result.standards.some((s) => s.name === standard && s.rules.some((r) => r.id === rule))) return null;
  return new Set(result.items.filter((i) => i.results.some((r) => r.standard === standard && r.rule === rule && fixable(r.state))).map((i) => i.id));
}

/** A rule's name from its `standard/rule` reference, for the filter's chip; null when the check doesn't know it. */
export function ruleName(result: StandardsCheckResult, ref: string): string | null {
  const [standard, rule] = ref.split('/');
  return result.standards.find((s) => s.name === standard)?.rules.find((r) => r.id === rule)?.name ?? null;
}

/** What the page holds for the toil project on screen: the reading the readiness rows use, and the check itself for the Command Center. */
export interface RulesState {
  reading: RulesReading;
  view: RulesView | null;
}
