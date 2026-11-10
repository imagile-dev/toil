import { builtinScheme } from '../classify/builtin.js';
import { classify } from '../classify/engine.js';
import type { Change, WorkItem } from '../owi/types.js';
import type { JiraSample } from './jira.js';
import { DAYS } from './kit.js';
import { PEOPLE } from './people.js';

/**
 * The figures the sample team's documentation and tests quote, worked out
 * from the data they describe rather than typed beside it, so a title edited
 * in the backlog changes the numbers in the same breath. The method for each
 * is in the name. A figure copied into a document by hand is a figure that
 * will be wrong by the next release, and be defended in the next review.
 */

export interface SprintFacts {
  name: string;
  start: string;
  end: string;
  state: 'closed' | 'active';
  /** In the sprint when it started. */
  committed: number;
  /** Added after it started. */
  added: number;
  /** Also in the sprint before it. */
  carriedIn: number;
  /** Still in the next sprint when it closed. */
  carriedOut: number;
  /** In the sprint and Done by its end. */
  done: number;
  /** Their points. */
  donePoints: number;
  keepTheLightsOn: number;
  feature: number;
  unsure: number;
}

export interface ReleaseFacts {
  name: string;
  date: string;
  released: boolean;
  /** Items that name it as their fix version. */
  items: number;
  done: number;
  /** Items whose fix version came with the item before the release started. */
  scopeAtStart: number;
  /** Items created after it started, or given the version after. */
  scopeAdded: number;
  /** Added as a share of the scope at the start. */
  growth: number;
  /** Items planned for the release before it, and moved here. */
  carriedIn: number;
  /** Not Done, with the release due within the next two weeks or already out. */
  open: number;
}

export interface SampleFacts {
  asOf: string;
  items: number;
  byType: Record<string, number>;
  withNoEpic: number;
  withNoFixVersion: number;
  withNoEstimate: number;
  withNoComponent: number;
  withTwoComponents: number;
  withACustomer: number;
  inSeveralSprints: number;
  reopened: number;
  incidents: number;
  blockedNow: number;
  blockedByLinks: number;
  unassignedInCurrentSprint: number;
  aging: number;
  overTheLimit: string[];
  wipLimit: number;
  medianCycleDays: number;
  sprints: SprintFacts[];
  releases: ReleaseFacts[];
  components: Record<string, number>;
  people: { total: number; teams: number; agents: number };
  pullRequests: { total: number; open: number; merged: number; draft: number; bots: number; agents: number; failingMoreThanADay: number; waitingOnReview: number };
  classification: { scheme: string; byCategory: Record<string, number>; bySource: Record<string, number>; unsure: number; unsureShare: number };
}

interface Input {
  asOf: string;
  base: number;
  jira: JiraSample;
  owi: { items: WorkItem[]; changes: Change[] };
  wipLimit: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const count = <T>(list: T[], key: (t: T) => string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of list) {
    const k = key(t);
    if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};
const day = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

export function buildFacts(input: Input): SampleFacts {
  const { items, changes } = input.owi;
  const now = Date.parse(input.asOf);
  const byId = new Map(items.map((i) => [i.id, i]));
  const classified = classify({ scheme: builtinScheme('ktlo-feature')!, items }).result;
  const category = new Map(classified.verdicts.map((v) => [v.id, v.category ?? 'unsure']));

  const blocked = (i: WorkItem) => i.statusCategory !== 'DONE' && i.links.some((l) => l.type === 'blocks' && l.direction === 'inward' && byId.get(l.target)?.statusCategory !== 'DONE');
  const startedAt = (i: WorkItem) => i.history?.transitions.find((t) => t.toCategory === 'IN_PROGRESS')?.at;

  const current = input.jira.sprints.find((s) => s.state === 'active')!;
  const wip = count(items.filter((i) => i.statusCategory === 'IN_PROGRESS' && i.assignee !== null), (i) => i.assignee!.name ?? i.assignee!.id);
  const cycles = items.flatMap((i) => {
    const start = day(startedAt(i));
    const end = day(i.resolved);
    return i.statusCategory === 'DONE' && Number.isFinite(start) && Number.isFinite(end) ? [(end - start) / DAYS] : [];
  });

  const sprints: SprintFacts[] = input.jira.sprints.map((s, index) => {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    const inSprint = items.filter((i) => i.sprints?.some((x) => x.name === s.name));
    const addedAfter = (i: WorkItem) => i.history?.iterations.some((c) => c.to.includes(s.name) && !c.from.includes(s.name) && Date.parse(c.at) > start) === true;
    const done = inSprint.filter((i) => i.statusCategory === 'DONE' && day(i.resolved) <= end);
    const previous = input.jira.sprints[index - 1];
    return {
      name: s.name,
      start: s.start,
      end: s.end,
      state: s.state,
      committed: inSprint.filter((i) => !addedAfter(i)).length,
      added: inSprint.filter(addedAfter).length,
      carriedIn: previous ? inSprint.filter((i) => i.sprints?.some((x) => x.name === previous.name)).length : 0,
      carriedOut: s.state === 'closed' ? inSprint.filter((i) => i.sprints?.some((x) => x.name === `Sprint ${s.id + 1}`)).length : 0,
      done: done.length,
      donePoints: done.reduce((n, i) => n + (i.estimate?.value ?? 0), 0),
      keepTheLightsOn: inSprint.filter((i) => category.get(i.id) === 'ktlo').length,
      feature: inSprint.filter((i) => category.get(i.id) === 'feature').length,
      unsure: inSprint.filter((i) => category.get(i.id) === 'unsure').length,
    };
  });

  const releases: ReleaseFacts[] = input.jira.versions.map((v) => {
    const start = Date.parse(v.startDate);
    const holds = items.filter((i) => i.releases?.some((r) => r.name === v.name));
    const added = (i: WorkItem) => {
      const raw = (input.jira.data.issues.find((x) => x.key === i.source.key)?.changelog as { histories: Array<{ created: string; items: Array<{ field: string; toString: string; fromString: string }> }> }).histories;
      const given = raw.some((h) => Date.parse(h.created.replace('+0000', 'Z')) > start && h.items.some((c) => c.field === 'Fix Version' && c.toString === v.name && c.fromString === ''));
      return given || day(i.created) > start;
    };
    const carried = (i: WorkItem) => {
      const raw = (input.jira.data.issues.find((x) => x.key === i.source.key)?.changelog as { histories: Array<{ items: Array<{ field: string; toString: string; fromString: string }> }> }).histories;
      return raw.some((h) => h.items.some((c) => c.field === 'Fix Version' && c.toString === v.name && c.fromString !== ''));
    };
    const scopeAdded = holds.filter(added).length;
    const scopeAtStart = holds.length - scopeAdded;
    return {
      name: v.name,
      date: v.releaseDate,
      released: v.released,
      items: holds.length,
      done: holds.filter((i) => i.statusCategory === 'DONE').length,
      scopeAtStart,
      scopeAdded,
      growth: scopeAtStart === 0 ? 0 : round(scopeAdded / scopeAtStart),
      carriedIn: holds.filter(carried).length,
      open: holds.filter((i) => i.statusCategory !== 'DONE').length,
    };
  });

  const open = changes.filter((c) => c.state === 'OPEN' || c.state === 'DRAFT');
  const summary = classified.summary;
  return {
    asOf: input.asOf,
    items: items.length,
    byType: count(items, (i) => i.typeName ?? i.type),
    withNoEpic: items.filter((i) => i.type !== 'EPIC' && i.typeName !== 'Initiative' && !i.ancestors?.some((a) => a.type === 'EPIC')).length,
    withNoFixVersion: items.filter((i) => i.type !== 'EPIC' && i.releases?.length === 0).length,
    withNoEstimate: items.filter((i) => i.estimate === null && i.type !== 'EPIC' && i.typeName !== 'Initiative' && i.typeName !== 'Sub-task').length,
    withNoComponent: items.filter((i) => i.components?.length === 0).length,
    withTwoComponents: items.filter((i) => (i.components?.length ?? 0) >= 2).length,
    withACustomer: items.filter((i) => (i.dims?.customer?.length ?? 0) > 0).length,
    inSeveralSprints: items.filter((i) => (i.sprints?.length ?? 0) > 1).length,
    reopened: items.filter((i) => i.history?.transitions.some((t) => t.fromCategory === 'DONE')).length,
    incidents: items.filter((i) => i.type === 'INCIDENT' || i.labels.includes('incident')).length,
    blockedNow: items.filter(blocked).length,
    blockedByLinks: items.filter((i) => i.links.some((l) => l.type === 'blocks' && l.direction === 'outward')).length,
    unassignedInCurrentSprint: items.filter((i) => i.iteration?.name === current.name && i.assignee === null && i.statusCategory !== 'DONE').length,
    aging: items.filter((i) => i.statusCategory === 'IN_PROGRESS' && (now - day(startedAt(i))) / DAYS > 15).length,
    overTheLimit: Object.entries(wip).filter(([, n]) => n > input.wipLimit).map(([name]) => name).sort(),
    wipLimit: input.wipLimit,
    medianCycleDays: round(median(cycles), 1),
    sprints,
    releases,
    components: count(items.flatMap((i) => (i.components ?? []).map((name) => ({ name }))), (c) => c.name),
    people: { total: PEOPLE.length, teams: new Set(PEOPLE.map((p) => p.team)).size, agents: PEOPLE.filter((p) => p.kind === 'agent').length },
    pullRequests: {
      total: changes.length,
      open: open.length,
      merged: changes.filter((c) => c.state === 'MERGED').length,
      draft: changes.filter((c) => c.state === 'DRAFT').length,
      bots: changes.filter((c) => c.authorKind === 'BOT').length,
      agents: changes.filter((c) => c.authorKind === 'AGENT').length,
      failingMoreThanADay: open.filter((c) => c.checks === 'FAILING' && c.checksAt !== null && now - Date.parse(c.checksAt) > DAYS).length,
      waitingOnReview: open.filter((c) => c.state === 'OPEN' && c.approvedAt === null).length,
    },
    classification: {
      scheme: classified.scheme.name,
      byCategory: summary.byCategory,
      bySource: summary.bySource,
      unsure: summary.byCategory.unsure ?? 0,
      unsureShare: round((summary.byCategory.unsure ?? 0) / items.length),
    },
  };
}
