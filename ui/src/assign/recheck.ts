/**
 * "Sync and check again" (#657, round 4): after a fix's proposal is applied,
 * whether the item now meets the rules the fix was for, read from a fresh
 * sync and toil's own `standards check`, never assumed from the Apply having
 * worked (principle 12). Toil UI has no read of one item that refreshes the
 * cache, so the press syncs the Toil project (incremental, so only what
 * changed is read again) and the rules are checked on what that sync read.
 * The App remounts after a sync, so the press is remembered here, outside
 * React, by assignment and by the moment the data on screen was read. A
 * second inspection, booked for after the first one's paperwork clears.
 */

import type { RulesReading } from '../model/readiness.ts';
import type { AssignedRule } from './model.ts';

const asked = new Map<string, string>();

/** Remembers that a person asked to check an assignment's rules again, on data read at `at`. */
export const askRecheck = (id: string, at: string) => void asked.set(id, at);
/** When the data on screen was read as the person asked, or undefined when they haven't. */
export const askedAt = (id: string): string | undefined => asked.get(id);
/** Forgets every press: for the tests. */
export const resetRechecks = () => asked.clear();

/** One rule on the new reading: passes, still missing, not checked, or no longer one that applies. */
export interface RuleAgain {
  name: string;
  state: 'pass' | 'missing' | 'unchecked' | 'gone';
  /** toil's reason, where it gave one. */
  reason: string;
}

/**
 * Each rule the fix was for, on this reading; null while the reading isn't
 * there yet, so nothing is said until something was read. A failed reading is
 * said by the caller in toil's words, not here.
 */
export function rulesAgain(rules: readonly Pick<AssignedRule, 'standard' | 'rule' | 'name'>[], reading: RulesReading | undefined, item: string): RuleAgain[] | null {
  if (!reading || reading.state !== 'read') return null;
  const results = reading.byItem.get(item) ?? [];
  return rules.map((r) => {
    const hit = results.find((x) => x.standard === r.standard && x.rule === r.rule);
    if (!hit) return { name: r.name, state: 'gone', reason: '' };
    if (hit.state === 'pass') return { name: hit.name, state: 'pass', reason: hit.reason };
    if (hit.state === 'skipped') return { name: hit.name, state: 'unchecked', reason: hit.reason };
    return { name: hit.name, state: 'missing', reason: hit.reason };
  });
}

/** One rule's line: "Acceptance criteria as Given/When/Then: now passes", or what is still missing. */
export function againText(r: RuleAgain): string {
  const why = r.reason.trim().replace(/\.$/, '');
  if (r.state === 'pass') return `${r.name}: now passes`;
  if (r.state === 'missing') return `${r.name}: still missing${why ? `: ${why}` : ''}`;
  if (r.state === 'unchecked') return `${r.name}: not checked${why ? `: ${why}` : ''}`;
  return `${r.name}: no longer applies to this item`;
}
