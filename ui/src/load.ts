/**
 * How a dashboard fills itself: `dossiers show` first, then, for each area the
 * dossier covers, the toil commands that read its work items, pull requests,
 * builds and deployments, every one read-only and named `toil-ui` in the audit
 * log. What the dossier holds decides what is asked: its Jira project, its
 * Azure DevOps pipelines, its GitHub project board (or, with none named, the
 * repository's issues), the namespace of each environment. Every call is kept
 * with the panel it fed, so the panel can say so, and a call that fails is
 * shown on its panel with toil's own message and fix (principle 4), never
 * dropped.
 *
 * Work items and pull requests go through `mapOwi` (src/owi.ts), pull
 * requests as OWI 0.2 changes: each code host's `pr list`, then `pr get
 * --include reviews,checks,commits,files` for every open one and the newest
 * closed ones. Builds and deployments go through src/model/delivery.ts. One
 * loader, one dossier, no spreadsheet.
 */

import { adoBuilds, adoDeployments, byEnvironment, changeRef, githubBuild, jenkinsBuilds, openshiftDeployments } from './model/delivery.ts';
import { readPeople, type PersonEntry } from './model/people.ts';
import { readReadiness, type ReadinessSettings } from './model/readiness.ts';
import { AUTHOR_KINDS, mapOwi, OVERRIDABLE } from './owi.ts';
import type { DossierAnalyze } from '../../src/core/brief/prompt.ts';
import { CALL_OPTIONS, type Call, type Change, type ChangeRef, type Deployment, type Envelope, type Execute, type WorkItem } from './toil.ts';

/** The JQL and WIQL a dashboard sends: one query per tracker, the whole project. */
export const JQL = (project: string) => `project = ${project} ORDER BY Rank ASC`;
/** The areas that read Azure DevOps work items: Server and Services. */
export const ADO_AREAS = ['ado', 'ado-cloud'] as const;
/** The areas that read Jira work items: one, whose connection is Data Center or Cloud, both sending the same issue shapes. */
export const JIRA_AREAS = ['jira'] as const;
export const WIQL = 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id]';

export type Panel = 'dossier' | 'work' | 'prs' | 'owners' | 'builds' | 'deployments';

export interface DossierSummary {
  name: string;
  description: string | null;
  /** The areas it covers, with the connection each would use. */
  sources: Array<{ area: string; connection: string | null }>;
  environments: string[];
}

export interface DossierData extends DossierSummary {
  items: WorkItem[];
  /** Pull requests, as OWI 0.2 changes. */
  pullRequests: Change[];
  /** Each GitHub repository's CODEOWNERS, by repository (`owner/repo`), where one was found. */
  codeowners: Record<string, { path: string; text: string }>;
  /** Things the pull request view should say about how it was read (an author kind it couldn't use). */
  prNotes: string[];
  changes: ChangeRef[];
  deployments: Deployment[];
  /** The dossier's `people` (#292): who each person is in every system, agents included. */
  people: PersonEntry[];
  /** How many items one person may have in progress at once, from the dossier; null when it sets none. */
  wipLimit: number | null;
  /** How Analyze briefs it (#494): the dossier's analyze key as written, null for the standard. */
  analyze: DossierAnalyze | null;
  /** Where the dossier came from, for labelling its focus: its file, whose it is, and whether the reader adopted it. */
  origin: { source: string; file: string; adopted: boolean } | null;
  /** What couldn't be read from the dossier's people, in words the People view shows. */
  peopleNotes: string[];
  /** What the readiness gate (#307) reads from the dossier: its sources, repositories and each area's settings. */
  readiness: ReadinessSettings;
  /** Every call, by the panel it fed. */
  calls: Record<Panel, Call[]>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' || typeof x === 'number' ? [String(x)] : [])) : []);

/** A command that came back `ok: false`, with toil's message and fix. */
export class CallFailed extends Error {
  constructor(readonly call: Call) {
    super(call.error ?? `${call.command} failed.`);
  }
}

interface ShowArea {
  connection: { value: string } | null;
  inputs: Record<string, string>;
}

/** `dossiers show`'s data, as the dashboard reads it. */
function readShow(data: Rec): { summary: DossierSummary; areas: Record<string, ShowArea>; dossier: Rec } {
  const areas = (isRec(data.areas) ? data.areas : {}) as Record<string, ShowArea>;
  const dossier = isRec(data.dossier) ? data.dossier : {};
  const summary: DossierSummary = {
    name: String(data.name),
    description: typeof dossier.description === 'string' ? dossier.description : null,
    sources: Object.entries(areas).map(([area, a]) => ({ area, connection: a.connection?.value ?? null })),
    environments: Object.keys(isRec(dossier.environments) ? dossier.environments : {}),
  };
  return { summary, areas, dossier };
}

/**
 * The OWI keys in a dossier section's `fields` (`estimate`, `estimateLabel`,
 * `iterationDays`, …). The rest of `fields` are `--field` aliases for the
 * area's own commands, which OWI would refuse as names it has no field for.
 */
export function owiFields(fields: unknown): Record<string, string> {
  if (!isRec(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter((e): e is [string, string] => (OVERRIDABLE as readonly string[]).includes(e[0]) && typeof e[1] === 'string'));
}

/** How many pull requests that aren't open are still read in full (`pr get --include`): the newest ones, which the flow metrics measure. */
export const CHECKED_CLOSED_PRS = 20;

/**
 * The pull requests read in full: every open one, and the newest closed or
 * merged ones. A repository with years of history would otherwise cost
 * several requests per pull request it ever had, on every sync.
 */
export function checkedPrs<T extends Pick<Change, 'state' | 'closedAt' | 'mergedAt' | 'updated' | 'created'>>(prs: T[]): T[] {
  const when = (p: T) => p.mergedAt ?? p.closedAt ?? p.updated ?? p.created ?? '';
  const open = (p: T) => p.state === 'OPEN' || p.state === 'DRAFT';
  const closed = prs.filter((p) => !open(p)).sort((a, b) => (when(a) < when(b) ? 1 : -1)).slice(0, CHECKED_CLOSED_PRS);
  const keep = new Set([...prs.filter(open), ...closed]);
  return prs.filter((p) => keep.has(p));
}

/** What `pr get --include` reads for each pull request read in full. */
export const PR_INCLUDE = 'reviews,checks,commits,files';

/** Each code host the loader reads pull requests from: its list's state for every pull request, and its get's id field. */
export const PR_HOSTS = [
  { area: 'bitbucket', all: 'ALL', id: 'id' },
  { area: 'ado', all: 'all', id: 'id' },
  { area: 'ado-cloud', all: 'all', id: 'id' },
  { area: 'github', all: 'all', id: 'number' },
] as const;

/** Where GitHub looks for CODEOWNERS, in its own order. */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

/**
 * The key patterns a dossier's pull requests are read with, from the work
 * items it already holds: each Jira project's `PAY-{n}`, Azure Boards'
 * `AB#{n}` for each Azure DevOps connection, and each GitHub repository's
 * `owner/repo#{n}`, each to the connection the items came from. A host's own
 * `#12` needs none.
 */
export function keyPatternsFor(items: WorkItem[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    const conn = i.source.connection;
    if (i.source.area.startsWith('jira')) out.add(`${i.source.key.replace(/-\d+$/, '')}-{n}=${conn}`);
    else if (i.source.area.startsWith('ado')) out.add(`AB#{n}=${conn}`);
    else if (i.source.area === 'github') out.add(`${i.source.key.replace(/#\d+$/, '')}#{n}=${conn}`);
  }
  return [...out];
}

/** A dossier section's `authorKinds`, keeping the entries OWI can use and saying which it left out. */
export function authorKindsOf(section: Rec, area: string, notes: string[]): Record<string, string> {
  if (section.authorKinds === undefined) return {};
  if (!isRec(section.authorKinds)) {
    notes.push(`The ${area} section's authorKinds isn't an object of author id to HUMAN, AGENT or BOT, so it was left out.`);
    return {};
  }
  const out: Record<string, string> = {};
  for (const [id, kind] of Object.entries(section.authorKinds)) {
    if (typeof kind === 'string' && (AUTHOR_KINDS as readonly string[]).includes(kind.toUpperCase())) out[id] = kind.toUpperCase();
    else notes.push(`The ${area} section's authorKinds gives ${id} as ${JSON.stringify(kind)}, which isn't HUMAN, AGENT or BOT, so it was left out.`);
  }
  return out;
}

/** How many closed issues of a repository with no board still get their history read: the most recently closed. */
export const CLOSED_ISSUE_HISTORIES = 50;

/**
 * The issues whose timelines are read: every open one, and the most recently
 * closed ones, which are all throughput and cycle time look at. A repository
 * with thousands of closed issues would otherwise send one request each on
 * its first sync. The rest are still listed, with no history.
 */
export function historyNumbers(issues: Rec[]): number[] {
  const numbered = issues.filter((i) => typeof i.number === 'number');
  const when = (i: Rec) => String(i.closed_at ?? i.updated_at ?? '');
  const closed = numbered.filter((i) => i.state === 'closed').sort((a, b) => (when(a) < when(b) ? 1 : -1)).slice(0, CLOSED_ISSUE_HISTORIES);
  const keep = new Set([...numbered.filter((i) => i.state !== 'closed'), ...closed]);
  return numbered.filter((i) => keep.has(i)).map((i) => i.number as number);
}

const connectionOf = (env: Envelope, fallback: string) => (env.ok ? (env.meta.context?.connection?.value ?? fallback) : fallback);

/**
 * The OWI mapper as the loader calls it: the browser's (src/owi.ts), or the
 * API's of the toil Toil UI runs with, whose records may be an older OWI
 * version than this source's types. So its records are read as this
 * version's: OWI only adds. One that returns no `changes` maps no pull
 * requests (OWI 0.1), and the view says so.
 */
export type LoaderMapOwi = (input: unknown, options?: { fields?: Record<string, string>; keyPatterns?: string[]; authorKinds?: Record<string, string> }) => { items: unknown[]; changes?: unknown[] };

export interface LoadOptions {
  /** The OWI mapper: the browser's (src/owi.ts) by default; the tests pass the API's to prove they agree. */
  mapOwi?: LoaderMapOwi;
}

export async function loadDossier(execute: Execute, name: string, options: LoadOptions = {}): Promise<DossierData> {
  const calls: Record<Panel, Call[]> = { dossier: [], work: [], prs: [], owners: [], builds: [], deployments: [] };

  /** One call, recorded on its panel. A failure is kept on the panel and comes back as null. */
  const run = async (panel: Panel, command: string, input: Rec): Promise<Envelope | null> => {
    const env = await execute(command, input, CALL_OPTIONS);
    const call: Call = { command, input, ok: env.ok, error: env.ok ? null : `${env.error.message}${env.error.fix ? ` ${env.error.fix}` : ''}` };
    calls[panel].push(call);
    if (!env.ok) {
      if (panel === 'dossier') throw new CallFailed(call);
      return null;
    }
    return env;
  };

  const show = await run('dossier', 'dossiers show', { dossier: name });
  const { summary, areas, dossier } = readShow(show!.data as Rec);
  const section = (area: string) => (isRec(dossier[area]) ? (dossier[area] as Rec) : {});
  const repos = recs(dossier.repos).map((r) => String(r.name));
  const base = { dossier: name };

  // Work items, mapped to OWI ---------------------------------------------------------
  // Each area is mapped on its own, with its own section's OWI fields.
  const work: Record<(typeof JIRA_AREAS)[number] | (typeof ADO_AREAS)[number] | 'github', unknown[]> = { jira: [], ado: [], 'ado-cloud': [], github: [] };
  const tasks: Array<Promise<void>> = [];
  for (const jira of JIRA_AREAS.filter((a) => areas[a]?.inputs.project)) {
    tasks.push((async () => {
      const search = await run('work', `${jira} issue search`, { ...base, jql: JQL(areas[jira]!.inputs.project!) });
      if (!search) return;
      work[jira].push(search);
      const keys = recs((search.data as Rec).issues).map((i) => String(i.key));
      for (const key of keys) {
        const history = await run('work', `${jira} issue history`, { ...base, key });
        if (history) work[jira].push({ key, history });
      }
    })());
  }
  // Azure DevOps Server and Services send the same work item shapes under the same command names.
  for (const ado of ADO_AREAS.filter((a) => areas[a])) {
    tasks.push((async () => {
      const iterations = await run('work', `${ado} work-item iterations`, base);
      if (iterations) work[ado].push(iterations);
      const search = await run('work', `${ado} work-item search`, { ...base, wiql: WIQL });
      const ids = search ? recs((search.data as Rec).workItems).map((w) => Number(w.id)) : [];
      if (!ids.length) return;
      const batch = await run('work', `${ado} work-item get-many`, { ...base, id: ids });
      if (batch) work[ado].push(batch);
      for (const id of ids) {
        const revisions = await run('work', `${ado} work-item history`, { ...base, id });
        if (revisions) work[ado].push(revisions);
      }
    })());
  }
  if (areas.github) {
    tasks.push((async () => {
      const repo = `${areas.github!.inputs.owner}/${areas.github!.inputs.repo}`;
      const numbers = new Set<number>();
      const projects = strings(section('github').projects);
      // No board named: the repository's own issues are the tracker, open and closed.
      if (!projects.length) {
        const issues = await run('work', 'github issue list', { ...base, state: 'all' });
        if (!issues) return;
        work.github.push(issues);
        for (const number of historyNumbers(recs(issues.data))) {
          const events = await run('work', 'github issue history', { ...base, number });
          if (events) work.github.push({ key: String(number), history: events });
        }
        return;
      }
      for (const project of projects) {
        const board = await run('work', 'github project items', { ...base, project: Number(project) });
        if (!board) continue;
        work.github.push(board);
        for (const item of recs(board.data)) {
          const content = isRec(item.content) ? item.content : {};
          if (isRec(content.repository) && content.repository.nameWithOwner === repo && typeof content.number === 'number') numbers.add(content.number);
        }
      }
      if (!numbers.size) return;
      const issues = await run('work', 'github issue get', { ...base, number: [...numbers], subIssues: true });
      if (issues) work.github.push(issues);
      for (const number of numbers) {
        const events = await run('work', 'github issue history', { ...base, number });
        if (events) work.github.push({ key: String(number), history: events });
      }
    })());
  }
  await Promise.all(tasks);
  const mapper = options.mapOwi ?? mapOwi;
  const items = Object.entries(work).flatMap(([area, docs]) => (docs.length ? (mapper(docs, { fields: owiFields(section(area).fields) }).items as WorkItem[]) : []));

  // Pull requests, as OWI changes, then their builds and deployments ------------------
  const changes: ChangeRef[] = [];
  const deployments: Deployment[] = [];
  const environments = isRec(dossier.environments) ? (dossier.environments as Record<string, Rec>) : {};
  const namespaces = Object.entries(environments).flatMap(([env, e]) => (isRec(e.openshift) && typeof e.openshift.namespace === 'string' ? [[env, e.openshift.namespace] as const] : []));
  const byId = new Map(items.map((i) => [i.id, i]));
  const keyPatterns = keyPatternsFor(items);
  const prNotes: string[] = [];
  const pullRequests: Change[] = [];
  const codeowners: DossierData['codeowners'] = {};

  /**
   * One host's pull requests: the list, then a get with everything a list
   * lacks for each one read in full, mapped together so a pull request in
   * both is one change.
   */
  const readPrs = async (host: (typeof PR_HOSTS)[number]): Promise<{ prs: Change[]; gets: Map<string, Envelope> }> => {
    const gets = new Map<string, Envelope>();
    const list = await run('prs', `${host.area} pr list`, { ...base, state: host.all });
    if (!list) return { prs: [], gets };
    const authorKinds = authorKindsOf(section(host.area), host.area, prNotes);
    const first = mapper([list], { keyPatterns, authorKinds });
    if (!first.changes) {
      prNotes.push('The toil Toil UI runs with maps no pull requests (it reads OWI 0.1), so none are shown. Upgrade toil to one that maps OWI 0.2 changes.');
      return { prs: [], gets };
    }
    const listed = first.changes as Change[];
    const docs: Envelope[] = [list];
    for (const pr of checkedPrs(listed)) {
      const number = Number(pr.id.slice(pr.id.lastIndexOf('#') + 1));
      const got = await run('prs', `${host.area} pr get`, { ...base, [host.id]: number, include: PR_INCLUDE });
      if (got) {
        docs.push(got);
        gets.set(pr.id, got);
      }
    }
    const prs = (mapper(docs, { keyPatterns, authorKinds }).changes ?? []) as Change[];
    pullRequests.push(...prs);
    return { prs, gets };
  };
  const refs = (prs: Change[]) => prs.map((c) => changeRef(c, byId));
  const onOpenShift = async (prs: ChangeRef[]) => {
    const out: Deployment[] = [];
    for (const [env, namespace] of namespaces) {
      const answer = await run('deployments', 'openshift deployment list', { ...base, env, namespace });
      if (answer) out.push(...openshiftDeployments(answer.data, env, repos, prs));
    }
    return out;
  };

  if (areas.bitbucket) {
    const prs = refs((await readPrs(PR_HOSTS[0])).prs);
    changes.push(...prs);
    for (const job of strings(section('jenkins').jobs)) {
      for (const pr of prs) {
        const id = pr.id.slice(pr.id.lastIndexOf('#') + 1);
        const runs = await run('builds', 'jenkins pipeline runs', { ...base, name: `${job}/PR-${id}`, limit: 5 });
        if (runs) changes.push(...jenkinsBuilds(runs.data, connectionOf(runs, 'jenkins'), `${job}/PR-${id}`, pr));
      }
    }
  }
  if (areas.ado) {
    const prs = refs((await readPrs(PR_HOSTS[1])).prs);
    changes.push(...prs);
    const connection = prs[0]?.change?.source.connection ?? areas.ado.connection?.value ?? 'ado';
    for (const pipeline of strings(section('ado').builds)) {
      const runs = await run('builds', 'ado run list', { ...base, name: pipeline, top: 20 });
      if (runs) changes.push(...adoBuilds(runs.data, connectionOf(runs, connection), prs));
    }
    for (const pipeline of strings(section('ado').deployments)) {
      const runs = await run('deployments', 'ado run list', { ...base, name: pipeline, top: 20 });
      if (runs) deployments.push(...adoDeployments(runs.data, connectionOf(runs, connection), prs));
    }
  }
  // Azure DevOps Services: its pull requests when the dossier names a repository. It has no pipeline commands yet.
  if (areas['ado-cloud']?.inputs.repo) changes.push(...refs((await readPrs(PR_HOSTS[2])).prs));
  if (areas.github) {
    const { prs, gets } = await readPrs(PR_HOSTS[3]);
    const github = refs(prs);
    changes.push(...github);
    // A head's check runs came with its get: one build per pull request read in full, so the gets fed the builds too.
    calls.builds.push(...calls.prs.filter((c) => c.command === 'github pr get'));
    for (const pr of github) {
      const got = gets.get(pr.id);
      const checks = got && isRec(got.data) && isRec(got.data.included) ? got.data.included.checks : undefined;
      const build = Array.isArray(checks) ? githubBuild(checks, pr.change!.source.connection, pr) : null;
      if (build) changes.push(build);
    }
    // CODEOWNERS, for suggesting reviewers, only when an open pull request has none to ask.
    if (prs.some((c) => (c.state === 'OPEN' || c.state === 'DRAFT') && !c.reviewers.length)) {
      const repo = `${areas.github.inputs.owner}/${areas.github.inputs.repo}`;
      for (const path of CODEOWNERS_PATHS) {
        const answer = await run('owners', 'github repo file', { ...base, path });
        const text = answer && isRec(answer.data) && typeof answer.data.text === 'string' ? answer.data.text : null;
        if (text !== null) {
          codeowners[repo] = { path, text };
          break;
        }
      }
    }
  }

  // OpenShift once per dossier, after every code host's pull requests are in, so a
  // dossier with two code hosts reads each namespace once (#229 review).
  if (namespaces.length) deployments.push(...(await onOpenShift(changes.filter((c) => c.kind === 'pull-request'))));

  const team = readPeople(dossier);
  const analyze = isRec(dossier.analyze) ? (dossier.analyze as DossierAnalyze) : null;
  const shown = show!.data as Rec;
  const origin = typeof shown.source === 'string' && typeof shown.file === 'string' ? { source: shown.source, file: shown.file, adopted: shown.adopted === true } : null;
  return { ...summary, items, pullRequests, codeowners, prNotes, changes, deployments: deployments.sort(byEnvironment), people: team.people, wipLimit: team.wipLimit, analyze, origin, peopleNotes: team.notes, readiness: readReadiness(dossier), calls };
}

/** `dossiers list`, and `dossiers show` for each, so the list can say what each one covers. */
export async function loadDossiers(execute: Execute): Promise<{ dossiers: DossierSummary[]; calls: Call[] }> {
  const calls: Call[] = [];
  const call = async (command: string, input: Rec) => {
    const env = await execute(command, input, CALL_OPTIONS);
    const c: Call = { command, input, ok: env.ok, error: env.ok ? null : `${env.error.message}${env.error.fix ? ` ${env.error.fix}` : ''}` };
    calls.push(c);
    if (!env.ok) throw new CallFailed(c);
    return env.data as Rec;
  };
  const list = await call('dossiers list', {});
  const names = recs(list.dossiers).filter((d) => d.shadowedBy === null || d.shadowedBy === undefined).map((d) => String(d.name));
  const dossiers: DossierSummary[] = [];
  for (const name of names) {
    dossiers.push(readShow(await call('dossiers show', { dossier: name })).summary);
  }
  return { dossiers, calls };
}
