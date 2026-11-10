import { BLOCKS, type Row, type RowState } from './backlog.js';
import { at, between, dayAt, jiraTime, offsetOf, pick, rngFor } from './kit.js';
import { byKey, PEOPLE, PLATFORM, RENOVATE, STOREFRONT, type Person } from './people.js';

/**
 * The backlog's rows turned into what `toil jira issue search --changelog`
 * prints on Jira Data Center: each issue with its fields and its history
 * inline. The rows say what the work is; this file decides when it happened,
 * from a draw seeded by the item's own number, so adding a row never changes
 * the dice of the one beside it. A sprint is ten working days, and each
 * item's timeline is placed inside the sprint it belonged to. The state of
 * every item is entirely invented, which sets it apart from the one in your
 * tracker only in that it is internally consistent.
 */

export const JIRA = 'https://jira.imagile.dev';
export const PROJECT = 'SHOP';

/** The custom fields the sample uses, by the id Jira gives them. */
export const FIELD = { epicLink: 'customfield_10014', points: 'customfield_10016', sprint: 'customfield_10020', customer: 'customfield_10500' };

const COMPONENT_ID: Record<string, string> = { Checkout: '10300', Catalog: '10301', Search: '10302', Accounts: '10303', Platform: '10304' };
export const COMPONENTS = Object.keys(COMPONENT_ID);

export const VERSION_ID: Record<string, string> = { '2.3': '10400', '2.4': '10401', '2.5': '10402' };

const STATUS = {
  todo: { name: 'To Do', id: '10000', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
  prog: { name: 'In Progress', id: '3', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  review: { name: 'In Review', id: '10100', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  done: { name: 'Done', id: '10001', statusCategory: { id: 3, key: 'done', name: 'Done' } },
} as const;

const TYPE = {
  Initiative: { name: 'Initiative', id: '10005', subtask: false },
  Epic: { name: 'Epic', id: '10000', subtask: false },
  Story: { name: 'Story', id: '10001', subtask: false },
  Task: { name: 'Task', id: '10002', subtask: false },
  Bug: { name: 'Bug', id: '1', subtask: false },
  Incident: { name: 'Incident', id: '10004', subtask: false },
  'Sub-task': { name: 'Sub-task', id: '10003', subtask: true },
} as const;

/** Working days an item spends between To Do and Done: a median of four and a tail, as flow data does. */
const CYCLE = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 6, 8, 11, 16];

const LABELS: Record<string, string[]> = {
  Checkout: ['payments', 'frontend'],
  Catalog: ['frontend', 'content'],
  Search: ['search', 'backend'],
  Accounts: ['backend', 'email'],
  Platform: ['infra', 'ops'],
};
const CUSTOMERS = ['Acme', 'Globex', 'Initech'];

/** The first working day of a sprint, and its last. */
export const sprintStart = (k: number): number => -6 - 10 * (26 - k);
export const sprintEnd = (k: number): number => sprintStart(k) + 9;
/** The working day 2.3 shipped, which is also the day 2.4 started taking scope. */
export const RELEASE_23 = -25;

export interface SprintInfo {
  id: number;
  name: string;
  state: 'closed' | 'active';
  start: string;
  end: string;
}

export interface Version {
  id: string;
  name: string;
  released: boolean;
  startDate: string;
  releaseDate: string;
}

export interface Placed {
  key: string;
  num: number;
  row: Row;
  block: number;
  sprints: number[];
  state: RowState;
  assignee: Person | null;
}

type Entry = { when: string; who: Person | null; items: Array<Record<string, unknown>> };
type Rec = Record<string, unknown>;

export interface JiraSample {
  /** `jira issue search --changelog`'s data. */
  data: { startAt: number; maxResults: number; total: number; issues: Rec[] };
  placed: Placed[];
  keyOf: Map<string, string>;
  sprints: SprintInfo[];
  versions: Version[];
}

export function buildJira(base: number): JiraSample {
  const rows = BLOCKS.flatMap((b) => b.rows.map((row) => ({ row, block: b.sprint })));
  const numOf = new Map<string, number>();
  rows.forEach(({ row }, i) => {
    if (row.ref !== undefined) numOf.set(row.ref, i + 1);
  });
  const keyFor = (num: number) => `${PROJECT}-${num}`;
  const keyOf = new Map([...numOf].map(([ref, num]) => [ref, keyFor(num)]));
  const ref = (name: string): number => {
    const num = numOf.get(name);
    if (num === undefined) throw new Error(`The sample backlog has no row called "${name}".`);
    return num;
  };

  const placed: Placed[] = rows.map(({ row, block }, i) => {
    const num = i + 1;
    const parent = row.parent !== undefined ? rows[ref(row.parent) - 1]! : undefined;
    const sprints = parent ? sprintsOf(parent.row, parent.block) : sprintsOf(row, block);
    const last = sprints.at(-1) ?? 0;
    const state: RowState = row.st ?? (row.type === 'Epic' || row.type === 'Initiative' ? 'todo' : row.type !== 'Sub-task' && last >= 26 ? 'prog' : 'done');
    return { key: keyFor(num), num, row, block, sprints, state, assignee: null };
  });
  for (const p of placed) p.assignee = assigneeOf(p, placed, ref);

  const sprints: SprintInfo[] = [21, 22, 23, 24, 25, 26].map((k) => ({
    id: k,
    name: `Sprint ${k}`,
    state: k < 26 ? 'closed' : 'active',
    start: at(base, sprintStart(k), 9),
    end: at(base, sprintEnd(k), 17),
  }));
  const sprintString = (k: number) => {
    const s = sprints[k - 21]!;
    return `com.atlassian.greenhopper.service.sprint.Sprint@6f3a${k}[id=${k},rapidViewId=7,state=${s.state === 'closed' ? 'CLOSED' : 'ACTIVE'},name=${s.name},startDate=${s.start},endDate=${s.end},completeDate=${s.state === 'closed' ? s.end : '<null>'},sequence=${k},goal=]`;
  };

  const versions: Version[] = [
    { id: VERSION_ID['2.3']!, name: '2.3', released: true, startDate: dayAt(base, offsetOf(-60)), releaseDate: dayAt(base, offsetOf(RELEASE_23)) },
    { id: VERSION_ID['2.4']!, name: '2.4', released: false, startDate: dayAt(base, offsetOf(RELEASE_23)), releaseDate: dayAt(base, 11) },
    { id: VERSION_ID['2.5']!, name: '2.5', released: false, startDate: dayAt(base, 12), releaseDate: dayAt(base, 39) },
  ];
  const versionObject = (name: string) => {
    const v = versions.find((x) => x.name === name)!;
    return { self: `${JIRA}/rest/api/2/version/${v.id}`, id: v.id, name: v.name, archived: false, released: v.released, releaseDate: v.releaseDate, startDate: v.startDate };
  };

  const link = new Map<number, Rec[]>();
  let linkId = 30000;
  const linkType = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
  const stub = (p: Placed) => ({ key: p.key, fields: { summary: p.row.title, status: STATUS[p.state] } });
  for (const p of placed) {
    for (const target of p.row.blocks ?? []) {
      const other = placed[ref(target) - 1]!;
      linkId++;
      link.set(p.num, [...(link.get(p.num) ?? []), { id: String(linkId), type: linkType, outwardIssue: stub(other) }]);
      link.set(other.num, [...(link.get(other.num) ?? []), { id: String(linkId), type: linkType, inwardIssue: stub(p) }]);
    }
  }

  const issues = placed.map((p) => {
    const { row } = p;
    const next = rngFor(p.num);
    const t = timeline(p, placed, ref, next, base);
    const entries = changelog(p, t, next, base);
    const history = entries.map((e, i) => ({
      id: String(40000 + p.num * 10 + i),
      author: e.who ? jiraUser(e.who) : jiraUser(byKey('rp')),
      created: jiraTime(e.when),
      items: e.items,
    }));
    const last = history.at(-1);
    const created = t.created;
    const updated = last ? (last.created as string) : jiraTime(created);
    const comps = (row.c ?? '').split(',').filter(Boolean);
    const labels = labelsOf(row, comps, next);
    const subtasks = placed.filter((q) => q.row.parent === row.ref && row.ref !== undefined);
    const epicKey = row.epic !== undefined && row.type !== 'Epic' && row.type !== 'Sub-task' ? keyFor(ref(row.epic)) : null;
    const customer = (row.type === 'Story' || row.type === 'Bug') && rngFor(p.num, 2)() < 0.33 ? pick(rngFor(p.num, 3), CUSTOMERS) : null;
    const points = row.p === undefined ? drawPoints(row, next) : row.p;
    const resolved = t.resolved === undefined ? null : jiraTime(t.resolved);
    const fields: Rec = {
      summary: row.title,
      description: row.d ?? null,
      issuetype: { self: `${JIRA}/rest/api/2/issuetype/${TYPE[row.type].id}`, ...TYPE[row.type] },
      status: { self: `${JIRA}/rest/api/2/status/${STATUS[p.state].id}`, ...STATUS[p.state] },
      resolution: p.state === 'done' ? { self: `${JIRA}/rest/api/2/resolution/10000`, id: '10000', name: 'Done' } : null,
      resolutiondate: resolved,
      priority: { self: `${JIRA}/rest/api/2/priority/3`, name: priorityOf(row, labels, next), id: '3' },
      assignee: p.assignee ? jiraUser(p.assignee) : null,
      reporter: reporterOf(row, next),
      labels,
      project: { self: `${JIRA}/rest/api/2/project/10200`, id: '10200', key: PROJECT, name: 'Shop' },
      created: jiraTime(created),
      updated,
      duedate: row.due === undefined ? null : dayAt(base, row.due),
      timeoriginalestimate: null,
      issuelinks: link.get(p.num) ?? [],
      subtasks: subtasks.map(stub),
      ...(row.type === 'Sub-task' ? { parent: { key: keyFor(ref(row.parent!)), fields: {} } } : {}),
      ...(row.type === 'Epic' && row.epic !== undefined ? { parent: { key: keyFor(ref(row.epic)), fields: {} } } : {}),
      fixVersions: row.fv === undefined ? [] : [versionObject(row.fv)],
      versions: row.av === undefined ? [] : [versionObject(row.av)],
      components: comps.map((name) => ({ self: `${JIRA}/rest/api/2/component/${COMPONENT_ID[name]}`, id: COMPONENT_ID[name], name })),
      [FIELD.epicLink]: epicKey,
      [FIELD.points]: points,
      [FIELD.sprint]: p.sprints.length === 0 ? null : p.sprints.map(sprintString),
      [FIELD.customer]: customer === null ? null : { self: `${JIRA}/rest/api/2/customFieldOption/${10600 + CUSTOMERS.indexOf(customer)}`, value: customer, id: String(10600 + CUSTOMERS.indexOf(customer)) },
    };
    return {
      expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
      id: String(10000 + p.num),
      self: `${JIRA}/rest/api/2/issue/${10000 + p.num}`,
      key: p.key,
      fields,
      names: { [FIELD.epicLink]: 'Epic Link', [FIELD.points]: 'Story Points', [FIELD.sprint]: 'Sprint', [FIELD.customer]: 'Customer' },
      changelog: { startAt: 0, maxResults: 1000, total: history.length, histories: history },
    } as Rec;
  });

  return { data: { startAt: 0, maxResults: 1000, total: issues.length, issues }, placed, keyOf, sprints, versions };
}

function sprintsOf(row: Row, block: number): number[] {
  if (block <= 0 || row.type === 'Epic' || row.type === 'Initiative') return [];
  return row.carry ? [block, block + 1] : [block];
}

function jiraUser(p: Person | { jira: string; name: string }) {
  return { self: `${JIRA}/rest/api/2/user?username=${p.jira}`, name: p.jira, key: p.jira, displayName: p.name, active: true };
}

function assigneeOf(p: Placed, all: Placed[], ref: (name: string) => number): Person | null {
  const { row } = p;
  if (row.w === 'none') return null;
  if (row.w !== undefined) return byKey(row.w);
  if (row.type === 'Epic' || row.type === 'Initiative' || p.block < 0) return null;
  if (row.type === 'Sub-task') return all[ref(row.parent!) - 1]!.assignee ?? pick(rngFor(p.num, 1), STOREFRONT);
  const platform = (row.c ?? '').startsWith('Platform') || row.epic === 'E4';
  return pick(rngFor(p.num, 1), platform ? PLATFORM : STOREFRONT);
}

function reporterOf(row: Row, next: () => number) {
  if (row.by === 'bot') return jiraUser(RENOVATE);
  if (row.type === 'Story' || row.type === 'Epic' || row.type === 'Initiative') return jiraUser(byKey('rp'));
  if (row.type === 'Incident') return jiraUser(byKey('do'));
  return jiraUser(pick(next, PEOPLE.filter((x) => x.kind === 'human')));
}

function labelsOf(row: Row, comps: string[], next: () => number): string[] {
  const own = (row.l ?? '').split(',').filter(Boolean);
  if (own.length > 0 || comps.length === 0) return own;
  return next() < 0.3 ? [pick(next, LABELS[comps[0]!] ?? ['backend'])] : own;
}

function drawPoints(row: Row, next: () => number): number | null {
  if (row.type === 'Story') return pick(next, [2, 3, 3, 5, 5, 8]);
  if (row.type === 'Bug') return pick(next, [1, 2, 2, 3, 5]);
  if (row.type === 'Task') return pick(next, [1, 2, 3, 3, 5]);
  return null;
}

function priorityOf(row: Row, labels: string[], next: () => number): string {
  if (row.type === 'Incident') return 'Highest';
  if (labels.includes('security')) return 'High';
  if (row.type === 'Bug') return next() < 0.35 ? 'High' : 'Medium';
  return next() < 0.15 ? 'Low' : 'Medium';
}

interface Timeline {
  /** Working days, 0 is today. */
  created: string;
  addedAt?: number;
  start?: number;
  review?: number;
  end?: number;
  out?: number;
  back?: number;
  resolved?: string;
  moments: Record<string, string>;
}

/** Where the item's moments fall, as working-day indexes first and ISO times for the ones the changelog needs. */
function timeline(p: Placed, all: Placed[], ref: (name: string) => number, next: () => number, base: number): Timeline & { idx: Record<string, number | undefined> } {
  const { row } = p;
  const first = p.sprints[0];
  const last = p.sprints.at(-1);
  const idx: Record<string, number | undefined> = {};
  const hour = () => between(next, 9, 16);
  const minute = () => between(next, 0, 59);

  let createdIdx: number;
  if (row.type === 'Initiative') createdIdx = -62;
  else if (row.type === 'Epic') createdIdx = -60 + p.num;
  else if (first === undefined) createdIdx = -between(next, 3, 25);
  else createdIdx = sprintStart(first) - between(next, 2, 12);
  // Scope the release had on the day it started was created before that day; only late and added rows arrive after it.
  if (row.fv === '2.4' && first !== undefined && row.late !== true && createdIdx > RELEASE_23 - 1) createdIdx = RELEASE_23 - between(next, 1, 8);
  if (row.late && first !== undefined) {
    const addedAt = sprintStart(first) + (row.type === 'Incident' ? between(next, 1, 3) : between(next, 2, 5));
    idx.addedAt = Math.min(addedAt, first >= 26 ? -1 : sprintEnd(first));
    createdIdx = idx.addedAt;
  }
  const createdHour = row.late ? 8 : hour();
  idx.created = createdIdx;

  const out: Timeline & { idx: Record<string, number | undefined> } = { created: at(base, createdIdx, createdHour, minute()), idx, moments: {} };
  if (idx.addedAt !== undefined) out.addedAt = idx.addedAt;

  if (p.state === 'todo') return out;

  if (row.type === 'Sub-task') {
    const parent = all[ref(row.parent!) - 1]!;
    const pt = timeline(parent, all, ref, rngFor(parent.num), base);
    const start = (pt.idx.start ?? sprintStart(first ?? 26)) + 1;
    const end = Math.min(start + between(next, 1, 3), parent.state === 'done' ? (pt.idx.end ?? -1) : -1);
    idx.start = Math.min(start, end - 1);
    idx.end = end;
    out.start = idx.start;
    out.end = end;
    out.resolved = at(base, end, 15, minute());
    return out;
  }

  const cap = (last ?? 26) >= 26 ? 0 : sprintEnd(last ?? 26);
  const dur = row.type === 'Incident' ? between(next, 1, 2) : pick(next, CYCLE);
  let start: number;
  if (row.start !== undefined) start = row.start;
  else if (row.type === 'Incident') start = createdIdx;
  else if (row.carry && first !== undefined) start = sprintStart(first) + between(next, 1, 6);
  else if (row.late && idx.addedAt !== undefined) start = idx.addedAt + between(next, 0, 1);
  else start = sprintStart(first ?? 26) + between(next, 0, 4);
  start = Math.max(start, createdIdx);

  if (p.state === 'done') {
    let end = row.end ?? (row.carry && last !== undefined && first !== undefined ? sprintStart(last) + between(next, 0, 5) : start + dur);
    end = Math.min(end, cap);
    if (start >= end) start = end - 1;
    idx.start = start;
    idx.end = end;
    if (end - start >= 2 && next() < 0.8) idx.review = start + Math.max(1, Math.round((end - start) * 0.6));
    if (row.reopen) {
      idx.out = end + 2;
      idx.back = end + 2 + between(next, 1, 2);
    }
  } else {
    start = Math.min(start, p.state === 'review' ? -2 : -1);
    idx.start = start;
    if (p.state === 'review') idx.review = Math.min(-1, start + Math.max(1, Math.round(dur * 0.6)));
  }
  for (const k of ['start', 'review', 'end', 'out', 'back'] as const) if (idx[k] !== undefined) out[k] = idx[k]!;
  const resolvedIdx = idx.back ?? idx.end;
  if (resolvedIdx !== undefined) out.resolved = at(base, resolvedIdx, 15, minute());
  return out;
}

/** Everything Jira would have written down about the item, oldest first. */
function changelog(p: Placed, t: ReturnType<typeof timeline>, next: () => number, base: number): Entry[] {
  const { row } = p;
  const out: Entry[] = [];
  const who = p.assignee;
  const stamp = (n: number, h = 10) => at(base, n, h, between(next, 0, 59));
  const move = (from: RowState, to: RowState, n: number, h?: number, by: Person | null = who): Entry => ({
    when: stamp(n, h),
    who: by,
    items: [{ field: 'status', fieldtype: 'jira', fieldId: 'status', from: STATUS[from].id, fromString: STATUS[from].name, to: STATUS[to].id, toString: STATUS[to].name }],
  });
  const sprintMove = (n: number, h: number, from: string, to: string): Entry => ({
    when: stamp(n, h),
    who: byKey('rp'),
    items: [{ field: 'Sprint', fieldtype: 'custom', fieldId: FIELD.sprint, from: null, fromString: from, to: null, toString: to }],
  });
  const name = (k: number) => `Sprint ${k}`;
  const first = p.sprints[0];

  if (first !== undefined && row.type !== 'Sub-task') {
    if (row.late) out.push(sprintMove(t.addedAt ?? sprintStart(first) + 2, 10, '', name(first)));
    else out.push(sprintMove(sprintStart(first) - 1, 16, '', name(first)));
    if (row.carry) out.push(sprintMove(sprintEnd(first), 17, name(first), `${name(first)}, ${name(first + 1)}`));
  }
  if (row.fv !== undefined && row.added === true && first !== undefined) {
    out.push({ when: stamp(sprintStart(first) + 1, 11), who: byKey('rp'), items: [{ field: 'Fix Version', fieldtype: 'jira', fieldId: 'fixVersions', from: null, fromString: '', to: null, toString: row.fv }] });
  }
  if (row.slipped !== undefined && row.fv !== undefined) {
    out.push({ when: stamp(RELEASE_23, 15), who: byKey('rp'), items: [{ field: 'Fix Version', fieldtype: 'jira', fieldId: 'fixVersions', from: null, fromString: row.slipped, to: null, toString: row.fv }] });
  }
  const idx = t.idx;
  if (idx.start !== undefined) out.push(move('todo', 'prog', idx.start, 9));
  if (idx.review !== undefined) out.push(move('prog', 'review', idx.review, 13));
  if (idx.end !== undefined) out.push(move(idx.review !== undefined ? 'review' : 'prog', 'done', idx.end, 15, idx.review !== undefined ? pick(next, PEOPLE.filter((x) => x.kind === 'human' && x !== who)) : who));
  if (idx.out !== undefined && idx.back !== undefined) {
    out.push(move('done', 'prog', idx.out, 10));
    out.push(move('prog', 'done', idx.back, 15));
  }
  return out.sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
}
