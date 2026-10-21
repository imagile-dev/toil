/**
 * The Overview's recommendation (#394), in the Minto order: one thing to do
 * first, then the three key issues that say why, each with its tickets. It is
 * worked out by code from what the dossier already holds (blockers, failing
 * builds, aging and stale work, the pull requests waiting on review, the
 * readiness of the work not started, and the sprint's pace), with no agent
 * call, so the same data always gives the same recommendation, and it says
 * how it was reached (principle 4).
 *
 * Each kind of issue has a base weight, the order a lead would usually clear
 * them in, plus one for every ticket it holds up to nine, so a bigger issue
 * of a kind outranks a smaller one but never a heavier kind; the heaviest three are
 * the key issues, and the heaviest one's action is the recommendation. The
 * executive summary, drafted before the meeting rather than after it.
 */

import type { Change, WorkItem } from '../toil.ts';
import { flows } from './flow.ts';
import { STALE_DAYS, insights, type Prepared } from './insights.ts';
import { PICKUP_DAYS, daysText, openQueue } from './prs.ts';
import { readiness, type ReadinessSettings } from './readiness.ts';
import type { Health } from './sprint.ts';

export type IssueKind = 'blockers' | 'builds' | 'scope' | 'review' | 'aging' | 'readiness';

/** Where an issue's whole story is: the tab that shows every ticket in it. */
export type IssueTab = 'board' | 'dependencies' | 'prs';

export interface KeyIssue {
  kind: IssueKind;
  /** A short heading: what is wrong, with a count. */
  title: string;
  /** One sentence, citing tickets as `[[id]]`. */
  detail: string;
  /** The work item and pull request ids it is about, most important first: at most four. */
  tickets: string[];
  /** How many tickets it holds in all, of which `tickets` shows the first few. */
  count: number;
  /** What a person should do about it, citing tickets as `[[id]]`. */
  action: string;
  /** What it rests on, in words. */
  evidence: string;
  tab: IssueTab;
  weight: number;
}

export interface Recommendation {
  /** The one thing to do first, citing tickets as `[[id]]`. */
  headline: string;
  /** The key issues, heaviest first: at most three. */
  issues: KeyIssue[];
  /** How it was reached, in words: what it read, and that no agent was asked. */
  derivedFrom: string;
}

/** Each kind's base weight: blockers first, since everything behind them waits; work not yet ready last, since it hasn't started. */
export const BASE_WEIGHT: Record<IssueKind, number> = { blockers: 100, builds: 90, scope: 80, review: 70, aging: 60, readiness: 50 };
/** The most tickets an issue shows as chips; the rest are a count and a link to the tab. */
export const MAX_TICKETS = 3;

export interface RecommendInput {
  items: WorkItem[];
  pullRequests: Change[];
  prepared: Prepared;
  health: Health | null;
  readiness: ReadinessSettings;
  now: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = (ids: string[]) => [...new Set(ids)];
const round1 = (n: number) => Math.round(n * 10) / 10;

function issue(kind: IssueKind, fields: Omit<KeyIssue, 'kind' | 'weight' | 'tickets'> & { tickets: string[] }): KeyIssue {
  return { kind, ...fields, tickets: fields.tickets.slice(0, MAX_TICKETS), weight: BASE_WEIGHT[kind] + Math.min(fields.count, 9) };
}

/** Open items held up by another open item, grouped by what holds them: the blocker that holds most comes first. */
function blockers(p: Prepared): KeyIssue | null {
  const held = new Map<string, string[]>();
  for (const item of p.items) {
    for (const i of insights(item, p)) {
      if (i.code !== 'blocked') continue;
      const by = /\[\[([^\]]+)\]\]/.exec(i.text)?.[1];
      if (by) held.set(by, [...(held.get(by) ?? []), item.id]);
    }
  }
  if (!held.size) return null;
  // Everything that waits on a blocker, directly or behind another blocked item, so the head of a chain counts its whole chain.
  const behindAll = (id: string, seen = new Set<string>()): Set<string> => {
    for (const next of held.get(id) ?? []) if (!seen.has(next)) behindAll(next, seen.add(next));
    return seen;
  };
  const blocked = uniq([...held.values()].flat());
  const order = [...held.entries()].sort((a, b) => behindAll(b[0]).size - behindAll(a[0]).size || Number(blocked.includes(a[0])) - Number(blocked.includes(b[0])) || a[0].localeCompare(b[0]));
  const [top, behind] = order[0]!;
  const waiting = behindAll(top).size;
  return issue('blockers', {
    title: `${plural(blocked.length, 'item')} blocked`,
    detail: order
      .slice(0, 2)
      .map(([by, ids]) => `[[${by}]] blocks ${ids.map((id) => `[[${id}]]`).join(', ')}`)
      .join('; ')
      .concat(order.length > 2 ? `; and ${plural(order.length - 2, 'more blocker')}.` : '.'),
    tickets: uniq([top, ...behind, ...order.slice(1).flatMap(([by, ids]) => [by, ...ids])]),
    count: uniq([...held.keys(), ...blocked]).length,
    action: `Unblock [[${top}]] first: ${plural(waiting, 'item')} ${waiting === 1 ? 'waits' : 'wait'} on it${waiting > behind.length ? ', directly or down a chain' : ''}.`,
    evidence: 'the items\' blocks links',
    tab: 'dependencies',
  });
}

function builds(p: Prepared): KeyIssue | null {
  const failing = p.items.filter((item) => insights(item, p).some((i) => i.code === 'failing-build')).map((i) => i.id);
  if (!failing.length) return null;
  return issue('builds', {
    title: `${plural(failing.length, 'build')} failing`,
    detail: `The latest build for ${failing.slice(0, 3).map((id) => `[[${id}]]`).join(', ')}${failing.length > 3 ? ` and ${failing.length - 3} more` : ''} failed.`,
    tickets: failing,
    count: failing.length,
    action: `Fix the failing build on [[${failing[0]}]].`,
    evidence: 'each item\'s latest build',
    tab: 'board',
  });
}

/** The sprint can't finish at its pace so far: what remains is more than the points a day done so far, over the days left. */
function scope(h: Health | null): KeyIssue | null {
  if (!h || h.remaining.points <= 0) return null;
  const left = Math.max(0, h.days.total - h.days.gone);
  const pace = h.days.gone > 0 ? h.done.points / h.days.gone : 0;
  if (h.days.gone === 0 || pace * left >= h.remaining.points) return null;
  const todo = h.items.filter((i) => i.statusCategory === 'TODO').sort((a, b) => (b.estimate?.value ?? 0) - (a.estimate?.value ?? 0));
  return issue('scope', {
    title: `${plural(h.remaining.points, 'point')} left, ${plural(left, 'day')} to go`,
    detail: `At ${round1(pace)} points a day so far, ${h.sprint.name} finishes about ${round1(pace * left)} of the ${h.remaining.points} points left.${todo.length ? ` Not started: ${todo.slice(0, 3).map((i) => `[[${i.id}]]`).join(', ')}.` : ''}`,
    tickets: todo.map((i) => i.id),
    count: todo.length,
    action: todo.length ? `Re-plan ${h.sprint.name}: agree what to drop, starting with [[${todo[0]!.id}]].` : `Re-plan ${h.sprint.name}: the work in progress won't all finish at this pace.`,
    evidence: `${h.sprint.name}'s points done and left, over its working days`,
    tab: 'board',
  });
}

function review(changes: Change[], p: Prepared, now: string): KeyIssue | null {
  const waiting = openQueue(changes, p.byId, now).filter((r) => (r.wait.on === 'review' && (r.wait.days ?? 0) >= PICKUP_DAYS) || r.flags.some((f) => f.flag === 'failing-checks'));
  if (!waiting.length) return null;
  const top = waiting[0]!;
  return issue('review', {
    title: `${plural(waiting.length, 'pull request')} waiting`,
    detail: waiting
      .slice(0, 2)
      .map((r) => `[[${r.change.id}]] waits on ${r.wait.on === 'review' ? 'review' : 'its checks'}${r.wait.days !== null ? ` after ${daysText(r.wait.days)}` : ''}`)
      .join('; ')
      .concat(waiting.length > 2 ? `; and ${waiting.length - 2} more.` : '.'),
    tickets: waiting.map((r) => r.change.id),
    count: waiting.length,
    action: `Get [[${top.change.id}]] ${top.wait.on === 'review' ? 'reviewed' : 'its checks passing'}: it has waited ${top.wait.days !== null ? daysText(top.wait.days) : 'longest'}.`,
    evidence: `each open pull request's reviews and checks, against ${PICKUP_DAYS} working days`,
    tab: 'prs',
  });
}

function aging(p: Prepared): KeyIssue | null {
  const rows = p.items.flatMap((item) => {
    const list = insights(item, p);
    const hit = list.find((i) => i.code === 'aging') ?? list.find((i) => i.code === 'stale');
    return hit ? [{ id: item.id, aging: hit.code === 'aging', days: p.ages.get(item.id) ?? 0 }] : [];
  });
  if (!rows.length) return null;
  rows.sort((a, b) => Number(b.aging) - Number(a.aging) || b.days - a.days);
  const old = rows.filter((r) => r.aging);
  const quiet = rows.filter((r) => !r.aging);
  const top = rows[0]!;
  // Each clause names only the items it is true of: an item gone quiet isn't aging, whatever else is.
  const ids = (list: typeof rows) => `${list.slice(0, 3).map((r) => `[[${r.id}]]`).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
  const clauses = [
    old.length && p.p85 ? `${ids(old)} ${old.length === 1 ? 'has' : 'have'} been in progress longer than 85% of finished items took (${plural(round1(p.p85.days), 'day')})` : '',
    quiet.length ? `${ids(quiet)} had no update for over ${plural(STALE_DAYS, 'day')}` : '',
  ].filter(Boolean);
  return issue('aging', {
    title: [old.length ? `${plural(old.length, 'item')} aging` : '', quiet.length ? `${old.length ? quiet.length : plural(quiet.length, 'item')} gone quiet` : ''].filter(Boolean).join(', '),
    detail: `${clauses.join('; ')}.`,
    tickets: rows.map((r) => r.id),
    count: rows.length,
    action: top.aging ? `Check in on [[${top.id}]]: in progress ${round1(top.days)} days, longer than most work takes here.` : `Check in on [[${top.id}]]: it has had no update for over ${plural(STALE_DAYS, 'day')}.`,
    evidence: old.length ? 'history.transitions, against the dossier\'s cycle times' : 'each item\'s last update',
    tab: 'board',
  });
}

/** Work not started that isn't ready to pick up: in the sprint when one runs, otherwise anywhere in the dossier. */
function notReady(input: RecommendInput): KeyIssue | null {
  const pool = (input.health?.items ?? input.items).filter((i) => i.statusCategory === 'TODO' && flows(i));
  const thin = pool.map((item) => readiness({ item, settings: input.readiness, byId: input.prepared.byId })).filter((r) => r.verdict !== 'ready');
  if (!thin.length) return null;
  const blocked = thin.filter((r) => r.verdict === 'blocked');
  const first = blocked[0] ?? thin[0]!;
  return issue('readiness', {
    title: `${plural(thin.length, 'item')} not ready to start`,
    detail: `${thin
      .slice(0, 3)
      .map((r) => `[[${r.id}]] (${r.why[0]?.label.toLowerCase() ?? r.verdict})`)
      .join(', ')}${thin.length > 3 ? ` and ${thin.length - 3} more` : ''}.`,
    tickets: [...blocked, ...thin.filter((r) => r.verdict !== 'blocked')].map((r) => r.id),
    count: thin.length,
    action: `Firm up [[${first.id}]] before anyone picks it up: ${first.why[0]?.reason ?? 'it isn\'t ready'}.`,
    evidence: 'the readiness gate\'s checks, on the cached records',
    tab: 'board',
  });
}

/** The recommendation and its three key issues, from the dossier's data alone. */
export function recommend(input: RecommendInput): Recommendation {
  const { prepared: p } = input;
  const all = [blockers(p), builds(p), scope(input.health), review(input.pullRequests, p, input.now), aging(p), notReady(input)].filter((i): i is KeyIssue => i !== null);
  all.sort((a, b) => b.weight - a.weight);
  const issues = all.slice(0, 3);
  const open = input.pullRequests.filter((c) => c.state === 'OPEN' || c.state === 'DRAFT').length;
  const derivedFrom = `Worked out by code, with no agent call, from ${plural(input.items.length, 'work item')} (their blockers, builds, ages and readiness), ${plural(open, 'open pull request')}${input.health ? ` and ${input.health.sprint.name}'s pace` : ''}.`;
  return {
    headline: issues[0]?.action ?? 'Keep going: nothing is blocked, failing, waiting on review or aging, and the work not started is ready.',
    issues,
    derivedFrom,
  };
}
