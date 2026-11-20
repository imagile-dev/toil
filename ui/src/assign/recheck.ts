/**
 * "Sync and judge again" (#657, round 4): after a fix's proposal is applied,
 * whether the item now meets the rules the fix was for, as a fresh AI agent
 * judgement of the item's new text, never assumed from the Apply having worked
 * (principle 12). Toil UI has no read of one item that refreshes the cache, so
 * the press syncs the Toil project (incremental, so only what changed is read
 * again), and the agent judges the rules on what that sync read, since the
 * person's press asked for exactly that.
 * The App remounts after a sync, so the press is remembered here, outside
 * React, by assignment and by the moment the data on screen was read. A
 * second inspection, booked for after the first one's paperwork clears.
 */

import type { Readiness, RulesReading } from '../model/readiness.ts';
import type { AssignedRule } from './model.ts';

const asked = new Map<string, string>();

/** Remembers that a person asked to check an assignment's rules again, on data read at `at`. */
export const askRecheck = (id: string, at: string) => void asked.set(id, at);
/** When the data on screen was read as the person asked, or undefined when they haven't. */
export const askedAt = (id: string): string | undefined => asked.get(id);
/** Forgets every press: for the tests. */
export const resetRechecks = () => (asked.clear(), shown.clear(), judged.clear());

const judged = new Set<string>();
/** True the first time a press asks the agent to judge on the new reading, false after, so one press asks once. */
export function firstJudging(id: string, at: string): boolean {
  const key = `${id}@${at}`;
  if (judged.has(key)) return false;
  judged.add(key);
  return true;
}

const shown = new Set<string>();
/**
 * True the first time a press's result is on screen, false after: the page
 * brings the result into view once, beside the button, and leaves the reader's
 * scrolling alone from then on.
 */
export function firstShowing(id: string, at: string): boolean {
  const key = `${id}@${at}`;
  if (shown.has(key)) return false;
  shown.add(key);
  return true;
}

/** One rule on the new reading: met, still missed, unsure, not judged yet, or no longer one the Toil project names. */
export interface RuleAgain {
  name: string;
  state: 'pass' | 'missing' | 'unsure' | 'na' | 'unjudged' | 'gone';
  /** The agent's reason, where it gave one. */
  reason: string;
  /** Which agent judged it, and when; null when nobody has on this reading. */
  by: string | null;
}

/**
 * Each rule the fix was for, on this reading; null while the reading isn't
 * there yet, so nothing is said until something was read. A failed reading is
 * said by the caller, not here. A rule not judged on the item's new text is
 * `unjudged`, and the page asks the agent to judge it (the person pressed for
 * that).
 */
export function rulesAgain(rules: readonly Pick<AssignedRule, 'standard' | 'rule' | 'name'>[], reading: RulesReading | undefined, item: string): RuleAgain[] | null {
  if (!reading || reading.state !== 'read') return null;
  const verdicts = reading.byItem.get(item) ?? [];
  return rules.map((r) => {
    if (!reading.standards.some((s) => s.name === r.standard && s.rules.some((x) => x.id === r.rule))) return { name: r.name, state: 'gone', reason: '', by: null };
    const v = verdicts.find((x) => x.standard === r.standard && x.rule === r.rule);
    if (!v) return { name: r.name, state: 'unjudged', reason: '', by: null };
    const state = v.verdict === 'met' ? 'pass' : v.verdict === 'missed' ? 'missing' : v.verdict;
    return { name: v.name, state, reason: v.reason, by: v.by };
  });
}

/** One rule's line: "Acceptance criteria as Given/When/Then: now met", or what is still missing, as the agent judged it. */
export function againText(r: RuleAgain): string {
  const why = r.reason.trim().replace(/\.$/, '');
  if (r.state === 'pass') return `${r.name}: now met`;
  if (r.state === 'missing') return `${r.name}: still missed${why ? `: ${why}` : ''}`;
  if (r.state === 'unsure') return `${r.name}: unsure${why ? `: ${why}` : ''}`;
  if (r.state === 'na') return `${r.name}: doesn't apply to this item${why ? `: ${why}` : ''}`;
  if (r.state === 'unjudged') return `${r.name}: not judged yet`;
  return `${r.name}: no longer one of this Toil project's rules`;
}

/**
 * The line beside "Sync and judge again" when every rule is now judged met (#657,
 * round 5), or null when one doesn't, so the per-rule lines say what is still
 * missing or not checked. The second sentence is the readiness verdict on the
 * same reading: "ready to start" only when it is Ready, otherwise what it is,
 * and nothing when the item isn't in the reading.
 */
export function passedText(again: readonly RuleAgain[], key: string, after: Pick<Readiness, 'verdict' | 'why'> | null): string | null {
  if (!again.length || again.some((r) => r.state !== 'pass')) return null;
  const names = again.map((r) => r.name);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const by = again.find((r) => r.by)?.by;
  const first = `\u2713 ${by ?? 'Your AI agent'} judges ${list} now met.`;
  if (!after) return first;
  if (after.verdict === 'ready') return `${first} ${key} is ready to start.`;
  const missing = after.why.map((r) => r.label);
  if (after.verdict === 'unread') return `${first} ${key} passes the other checks, but another of its ticket rules isn't judged yet or is unsure, so it isn't known to be ready to start.`;
  if (after.verdict === 'blocked') return `${first} ${key} is blocked, so it isn't ready to start${missing.length ? `: ${missing.join(', ')}` : ''}.`;
  return `${first} ${key} still needs more detail before it is ready to start${missing.length ? `: ${missing.join(', ')}` : ''}.`;
}
