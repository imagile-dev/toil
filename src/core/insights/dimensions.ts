/**
 * Dimensions (#567): what an item holds in the thing a person splits work by.
 * `parseDimension` reads the name a person typed, `valuesOf` says what one item
 * holds in it, and the one rule underneath is principle 12: a field the read
 * never fetched is `unread` (the item goes in no bucket), and a field that was
 * read and is empty is a "none" bucket, which a screen always shows. Pure, so
 * Toil UI imports it from source; `asOf` always comes from the caller.
 * Calendar arithmetic lives here too, because a week that starts on Sunday in
 * one file and Monday in another is how two dashboards come to disagree at the
 * quarterly review.
 */

import type { Ancestor, Release, WorkItem } from '../owi/types.js';
import { calendarDays, DAY } from '../brief/time.js';
import { DIMENSION_BASES, TIME_GRAINS, type Dimension, type DimensionBase, type DimensionValues, type InsightsPerson, type PivotInput, type TimeGrain } from './types.js';

// Calendar ------------------------------------------------------------------

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
  if (!DAY_TEXT.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

export const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number): string => new Date(dayMs(day) + n * DAY).toISOString().slice(0, 10);

/** The UTC day an instant falls on, or null when the text is not a date. */
export function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

/** The first day of the week (Monday), month or quarter a day falls in. */
export function bucketStart(day: string, grain: TimeGrain): string {
  const ms = dayMs(day);
  if (grain === 'week') return addDays(day, -((new Date(ms).getUTCDay() + 6) % 7));
  const month = Number(day.slice(5, 7));
  const first = grain === 'month' ? month : Math.floor((month - 1) / 3) * 3 + 1;
  return `${day.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

/** The first day of the bucket after the one that starts on `start`. */
export function nextBucket(start: string, grain: TimeGrain): string {
  if (grain === 'week') return addDays(start, 7);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + (grain === 'month' ? 1 : 3);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** "2026-W45", "Nov 2026" or "Q4 2026" for the bucket that starts on `start`. */
export function bucketLabel(start: string, grain: TimeGrain): string {
  if (grain === 'month') return `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  if (grain === 'quarter') return `Q${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1} ${start.slice(0, 4)}`;
  const thursday = addDays(start, 3); // The ISO week belongs to the year its Thursday is in.
  const year = thursday.slice(0, 4);
  const dayOfYear = Math.round((dayMs(thursday) - dayMs(`${year}-01-01`)) / DAY) + 1;
  return `${year}-W${String(Math.floor((dayOfYear - 1) / 7) + 1).padStart(2, '0')}`;
}

/** Every bucket that overlaps the period, in order. */
export function bucketsBetween(from: string, to: string, grain: TimeGrain): string[] {
  const out: string[] = [];
  for (let s = bucketStart(from, grain); s <= to; s = nextBucket(s, grain)) out.push(s);
  return out;
}

// Parsing --------------------------------------------------------------------

type Kind = Dimension['kind'];

const KIND: Record<DimensionBase, Kind> = {
  category: 'single', type: 'single', statusCategory: 'single', status: 'single', priority: 'single', assignee: 'single', team: 'single',
  iteration: 'single', project: 'single', tracker: 'single', connection: 'single', area: 'single',
  parent: 'parent',
  label: 'multi', component: 'multi', release: 'multi', affects: 'multi', sprint: 'multi', dim: 'multi',
  created: 'time', started: 'time', resolved: 'time',
  age: 'derived', size: 'derived', planned: 'derived', hasEpic: 'derived', carried: 'derived', reopened: 'derived',
};

const BASE_LABEL: Record<DimensionBase, string> = {
  category: 'Category', type: 'Type', statusCategory: 'Status category', status: 'Status', priority: 'Priority', assignee: 'Assignee', team: 'Team',
  iteration: 'Current sprint', project: 'Project', tracker: 'Tracker', connection: 'Connection', area: 'Area',
  parent: 'Parent',
  label: 'Label', component: 'Component', release: 'Fix version', affects: 'Affected version', sprint: 'Sprint', dim: 'Field',
  created: 'Created', started: 'Started', resolved: 'Resolved',
  age: 'Age', size: 'Size', planned: 'Planned or unplanned', hasEpic: 'Has an epic', carried: 'Carried over', reopened: 'Reopened',
};

const NONE_LABEL: Record<DimensionBase, string | null> = {
  category: 'Unsure', type: 'No type', statusCategory: 'No status', status: 'No status', priority: 'No priority', assignee: 'Unassigned', team: 'No team',
  iteration: 'No sprint', project: 'No project', tracker: 'No tracker', connection: 'No connection', area: 'No area',
  parent: 'No parent',
  label: 'No labels', component: 'No component', release: 'No fix version', affects: 'No affected version', sprint: 'No sprint', dim: 'None',
  created: null, started: null, resolved: null,
  age: 'Not in progress', size: 'No estimate', planned: 'Not in a sprint', hasEpic: 'No epic', carried: 'Not carried over', reopened: 'Not reopened',
};

/** What the notes call a dimension that was never read: "Fix versions weren't read for any of the 20 items." */
const UNREAD_NOUN: Record<DimensionBase, string> = {
  category: 'Categories', type: 'Types', statusCategory: 'Statuses', status: 'Statuses', priority: 'Priorities', assignee: 'Assignees', team: 'Teams',
  iteration: 'Sprints', project: 'Projects', tracker: 'Trackers', connection: 'Connections', area: 'Area paths',
  parent: 'Parents',
  label: 'Labels', component: 'Components', release: 'Fix versions', affects: 'Affected versions', sprint: 'Sprints', dim: 'Values',
  created: 'Created dates', started: 'Start dates', resolved: 'Resolved dates',
  age: 'Start dates', size: 'Estimates', planned: 'Sprint histories', hasEpic: 'Parent chains', carried: 'Sprint histories', reopened: 'Status histories',
};

const isBase = (text: string): text is DimensionBase => (DIMENSION_BASES as readonly string[]).includes(text);

export const DEFAULT_AREA_DEPTH = 2;

/** Reads a dimension as `--split`, `--across` and `--where` name it, or throws an Error saying what is wrong and what is allowed. */
export function parseDimension(spec: string): Dimension {
  const text = spec.trim();
  const colon = text.indexOf(':');
  const base = colon < 0 ? text : text.slice(0, colon).trim();
  const arg = colon < 0 ? null : text.slice(colon + 1).trim();
  if (!isBase(base)) throw new Error(`Unknown dimension "${base}". Choose one of: ${DIMENSION_BASES.join(', ')}.`);
  if (arg === '') throw new Error(`"${spec}" has nothing after the colon.${base === 'dim' ? ' Write dim:<name>, the name of a dimension the toil project defines.' : ' Leave the colon out, or add a value.'}`);
  const kind = KIND[base];
  let label = BASE_LABEL[base];
  let none = NONE_LABEL[base];
  if (kind === 'time') {
    if (arg !== null && !(TIME_GRAINS as readonly string[]).includes(arg)) throw new Error(`Unknown grain "${arg}" for ${base}. Choose one of: ${TIME_GRAINS.join(', ')}.`);
    label = `${label}, by ${arg ?? 'week'}`;
  } else if (base === 'area') {
    if (arg !== null && !/^[1-9]\d*$/.test(arg)) throw new Error(`"${spec}": the area depth must be a whole number of 1 or more (a path like Imagile\\Payments\\Web is 3 deep).`);
    if (arg !== null) label = `Area (${arg} deep)`;
  } else if (base === 'dim') {
    if (arg === null) throw new Error('"dim" needs a name: write dim:<name>, the name of a dimension the toil project defines.');
    label = arg;
    none = `No ${arg}`;
  } else if (base === 'parent') {
    if (arg !== null) {
      label = `Parent › ${arg === 'top' ? 'Top' : arg}`;
      none = arg === 'top' ? 'No parent' : `No ${arg}`;
    }
  } else if (base === 'label') {
    if (arg !== null) {
      label = `Label › ${arg}`;
      none = `No ${arg} label`;
    }
  } else if (arg !== null) {
    throw new Error(`"${base}" takes no argument, so write it without ":${arg}".`);
  }
  return { spec: text, base, arg, kind, label, noneLabel: none };
}

/** The plain noun for notes about a dimension nobody read. */
export const unreadNoun = (d: Dimension): string => (d.base === 'dim' ? `The "${d.arg}" values` : UNREAD_NOUN[d.base]);

const MENU_SPECS = [
  'category', 'type', 'statusCategory', 'status', 'priority', 'assignee', 'team',
  'parent', 'parent:top', 'parent:Epic', 'parent:Feature',
  'iteration', 'sprint', 'release', 'affects', 'component', 'label', 'area', 'project', 'tracker', 'connection',
  'created:week', 'created:month', 'created:quarter', 'started:week', 'started:month', 'started:quarter', 'resolved:week', 'resolved:month', 'resolved:quarter',
  'age', 'size', 'planned', 'hasEpic', 'carried', 'reopened',
];

/** The dimensions a menu offers, in the order a person looks for them. `dim:<name>` and `label:<prefix>` are offered by name, from what the toil project and the items hold. */
export const DIMENSION_MENU: Array<{ spec: string; label: string; kind: Dimension['kind'] }> = MENU_SPECS.map((spec) => {
  const d = parseDimension(spec);
  return { spec: d.spec, label: d.label, kind: d.kind };
});

// Values ---------------------------------------------------------------------

export interface ValuesContext {
  asOf: string;
  /** The period, `YYYY-MM-DD` inclusive; time dimensions bucket only inside it. */
  period: { from: string; to: string };
  people?: InsightsPerson[];
  categories?: PivotInput['categories'];
  scheme?: PivotInput['scheme'];
  /** Every item in the input by OWI id, so a parent can be named by its key and title. */
  index?: ReadonlyMap<string, WorkItem>;
}

type Entry = { key: string; label: string; short?: string; order?: string };

const unread = (): DimensionValues => ({ unread: true });
const read = (values: Entry[]): DimensionValues => ({ unread: false, values });
const one = (key: string, label: string, order?: string): DimensionValues => read([{ key: `v:${key}`, label, order }]);
const maybe = (key: string | null, label: string): DimensionValues => (key === null ? read([]) : one(key, label));
const entries = (list: string[]): DimensionValues => read(uniq(list.map((s) => ({ key: `v:${s.toLowerCase()}`, label: s }))));
const releases = (list: Release[]): DimensionValues => read(uniq(list.map((r) => ({ key: `v:${r.id ?? r.name}`, label: r.name }))));
const rank = (i: number) => String(i).padStart(4, '0');
const lower = (s: string) => s.toLowerCase();

function uniq(list: Entry[]): Entry[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** The first move into IN_PROGRESS in an item's history: its start. Null when it has no history or never moved in. */
export function startedAt(item: WorkItem): string | null {
  const times = (item.history?.transitions ?? []).filter((t) => t.toCategory === 'IN_PROGRESS').map((t) => Date.parse(t.at)).filter((n) => !Number.isNaN(n));
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

/** The project an item's key belongs to: `PAY` for `PAY-101`, `owner/repo` for `owner/repo#7`, else the tracker's name. */
export function projectOf(item: WorkItem): string {
  const key = item.source.key;
  const hash = key.indexOf('#');
  if (hash > 0) return key.slice(0, hash);
  const dash = key.lastIndexOf('-');
  return dash > 0 && /^\d+$/.test(key.slice(dash + 1)) ? key.slice(0, dash) : item.source.area;
}

const keyOf = (id: string) => id.slice(id.indexOf(':') + 1);

function itemLabel(id: string, title: string | null, ctx: ValuesContext): string {
  const known = ctx.index?.get(id);
  const t = known?.title ?? title;
  return `${known?.source.key ?? keyOf(id)}${t ? ` ${t}` : ''}`;
}

function teamOf(item: WorkItem, people: InsightsPerson[] | undefined): DimensionValues {
  if (item.team) return one(item.team.toLowerCase(), item.team);
  const a = item.assignee;
  if (!a) return read([]);
  if (!people) return unread(); // Nobody told us the teams, so an assignee's team is not "none", it is unknown.
  const needles = [a.id, a.name, a.email].filter((s): s is string => !!s).map(lower);
  const person = people.find((p) => [p.name, p.email, ...Object.values(p.ids ?? {})].filter((s): s is string => !!s).map(lower).some((h) => needles.includes(h)));
  return person?.team ? one(person.team.toLowerCase(), person.team) : read([]);
}

function parentValues(item: WorkItem, d: Dimension, ctx: ValuesContext): DimensionValues {
  if (d.arg === null) return item.parent === null ? read([]) : one(item.parent, itemLabel(item.parent, null, ctx));
  if (item.parent === null) return read([]); // A root has no ancestor to name, whatever was asked.
  if (item.ancestors === undefined) return unread();
  const chain: Ancestor[] = item.ancestors;
  const target = d.arg === 'top' ? chain[chain.length - 1] : chain.find((a) => lower(a.typeName ?? '') === lower(d.arg!) || lower(a.type) === lower(d.arg!));
  if (target) return one(target.id, itemLabel(target.id, target.title, ctx));
  return d.arg === 'top' ? one(item.parent, itemLabel(item.parent, null, ctx)) : read([]); // The chain ends where a parent isn't in the input: the nearest known one is the top.
}

function timeValues(item: WorkItem, d: Dimension, ctx: ValuesContext): DimensionValues {
  let when: string | null;
  if (d.base === 'started') {
    if (item.history === null) return unread();
    when = startedAt(item);
  } else {
    when = d.base === 'created' ? item.created : item.resolved;
  }
  const day = dayOf(when);
  if (day === null || day < ctx.period.from || day > ctx.period.to) return read([]);
  const grain = (d.arg ?? 'week') as TimeGrain;
  const start = bucketStart(day, grain);
  return one(start, bucketLabel(start, grain), start);
}

const AGE_BUCKETS: Array<[number, string]> = [[2, '0-2 d'], [7, '3-7 d'], [14, '8-14 d'], [30, '15-30 d'], [Infinity, 'over 30 d']];

function ageValues(item: WorkItem, ctx: ValuesContext): DimensionValues {
  if (item.statusCategory !== 'IN_PROGRESS') return read([]);
  if (item.history === null) return unread();
  const from = startedAt(item);
  if (from === null) return read([]);
  const days = Math.floor(calendarDays(from, ctx.asOf));
  const i = AGE_BUCKETS.findIndex(([max]) => days <= max);
  return one(`age-${i}`, AGE_BUCKETS[i]![1], rank(i));
}

const SIZE_BUCKETS: Record<string, Array<[number, string]>> = {
  points: [[1, '1'], [3, '2-3'], [5, '5'], [8, '8'], [Infinity, '13+']],
  hours: [[2, 'up to 2 h'], [4, 'up to 4 h'], [8, 'up to 8 h'], [16, 'up to 16 h'], [Infinity, 'over 16 h']],
  days: [[1, 'up to 1 d'], [2, 'up to 2 d'], [5, 'up to 5 d'], [Infinity, 'over 5 d']],
};

function sizeValues(item: WorkItem): DimensionValues {
  const e = item.estimate;
  if (!e) return read([]);
  const buckets = SIZE_BUCKETS[e.unit] ?? SIZE_BUCKETS.points!;
  const i = buckets.findIndex(([max]) => e.value <= max);
  const unitRank = Object.keys(SIZE_BUCKETS).indexOf(e.unit);
  return one(`size-${e.unit}-${i}`, buckets[i]![1], `${unitRank}-${rank(i)}`);
}

/** The sprint names an item's history moved it into, with when. */
function sprintAdds(item: WorkItem): Array<{ name: string; at: string }> {
  return (item.history?.iterations ?? []).flatMap((c) => c.to.filter((n) => !c.from.includes(n)).map((name) => ({ name, at: c.at })));
}

function plannedValues(item: WorkItem): DimensionValues {
  if (item.type === 'INCIDENT') return one('unplanned', 'Unplanned', '1');
  if (item.history === null) return unread(); // Without the sprint history nobody can say when it was added.
  const sprints = item.sprints ?? (item.iteration ? [item.iteration] : []);
  const adds = sprintAdds(item);
  if (sprints.length === 0 && adds.length === 0) return read([]);
  const late = adds.some((a) => {
    const start = dayOf(sprints.find((s) => s.name === a.name)?.start);
    return start !== null && Date.parse(a.at) > Date.parse(`${start}T00:00:00Z`) + DAY;
  });
  return late ? one('unplanned', 'Unplanned', '1') : one('planned', 'Planned', '0');
}

function carriedValues(item: WorkItem): DimensionValues {
  let count: number;
  if (item.sprints) count = item.sprints.length;
  else if (item.history) count = new Set(sprintAdds(item).map((a) => a.name)).size;
  else return unread();
  return count > 1 ? one('carried', 'Carried over') : read([]);
}

function categoryValues(item: WorkItem, ctx: ValuesContext): DimensionValues {
  const map = ctx.categories;
  if (!map || !(item.id in map)) return unread();
  const id = map[item.id];
  if (id === null || id === undefined) return read([]);
  const at = ctx.scheme?.categories.findIndex((c) => c.id === id) ?? -1;
  const cat = at < 0 ? undefined : ctx.scheme!.categories[at];
  return read([{ key: `v:${id}`, label: cat?.name ?? id, short: cat?.short, order: rank(at < 0 ? 9999 : at) }]);
}

/** What one item holds in a dimension, or that the read never fetched it. */
export function valuesOf(item: WorkItem, d: Dimension, ctx: ValuesContext): DimensionValues {
  switch (d.base) {
    case 'category': return categoryValues(item, ctx);
    case 'type': return one(item.type, titleCase(item.type));
    case 'statusCategory': return one(item.statusCategory, { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done', UNKNOWN: 'Unknown status' }[item.statusCategory]);
    case 'status': return maybe(item.status, item.status ?? '');
    case 'priority': return maybe(item.priority, item.priority ?? '');
    case 'assignee': return item.assignee ? one(item.assignee.id, item.assignee.name ?? item.assignee.email ?? item.assignee.id) : read([]);
    case 'team': return teamOf(item, ctx.people);
    case 'iteration': return item.iteration ? one(item.iteration.id ?? item.iteration.name, item.iteration.name) : read([]);
    case 'project': return one(projectOf(item), projectOf(item));
    case 'tracker': return one(item.source.area, item.source.area);
    case 'connection': return one(item.source.connection, item.source.connection);
    case 'area': {
      if (item.area === undefined) return unread();
      if (item.area === null) return read([]);
      const parts = item.area.path.split(/[\\/]/).filter(Boolean).slice(0, d.arg === null ? DEFAULT_AREA_DEPTH : Number(d.arg));
      return parts.length === 0 ? read([]) : one(parts.join('\\'), parts.join(' › '));
    }
    case 'parent': return parentValues(item, d, ctx);
    case 'label': {
      if (d.arg === null) return entries(item.labels);
      const prefix = lower(d.arg);
      return entries(item.labels.filter((l) => lower(l).startsWith(prefix)).map((l) => l.slice(prefix.length).replace(/^[\s:/_-]+/, '')).filter(Boolean));
    }
    case 'component': return item.components === undefined ? unread() : entries(item.components);
    case 'release': return item.releases === undefined ? unread() : releases(item.releases);
    case 'affects': return item.affects === undefined ? unread() : releases(item.affects);
    case 'sprint':
      if (item.sprints === undefined) return unread();
      return read(uniq(item.sprints.map((s) => ({ key: `v:${s.id ?? s.name}`, label: s.name, order: dayOf(s.start) ?? undefined }))));
    case 'dim': {
      const list = item.dims?.[d.arg ?? ''];
      return list === undefined ? unread() : entries(list);
    }
    case 'created': case 'started': case 'resolved': return timeValues(item, d, ctx);
    case 'age': return ageValues(item, ctx);
    case 'size': return sizeValues(item);
    case 'planned': return plannedValues(item);
    case 'hasEpic': {
      if (item.ancestors === undefined) return item.parent === null ? read([]) : unread();
      return item.ancestors.some((a) => a.type === 'EPIC') ? one('epic', 'Has an epic') : read([]);
    }
    case 'carried': return carriedValues(item);
    case 'reopened': {
      if (item.history === null) return unread();
      return item.history.transitions.some((t) => t.fromCategory === 'DONE' && t.toCategory !== 'DONE') ? one('reopened', 'Reopened') : read([]);
    }
  }
}
