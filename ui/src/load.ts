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
 * Work items go through `mapOwi` (src/owi.ts); the rest through
 * src/model/delivery.ts. One loader, one dossier, no spreadsheet.
 */

import { adoBuilds, adoDeployments, adoPrs, bitbucketPrs, byEnvironment, githubBuild, githubHead, githubPrs, jenkinsBuilds, openshiftDeployments } from './model/delivery.ts';
import { mapOwi } from './owi.ts';
import { CALL_OPTIONS, type Call, type ChangeRef, type Deployment, type Envelope, type Execute, type WorkItem } from './toil.ts';

/** The JQL and WIQL a dashboard sends: one query per tracker, the whole project. */
export const JQL = (project: string) => `project = ${project} ORDER BY Rank ASC`;
/** The areas that read Azure DevOps work items: Server and Services. */
export const ADO_AREAS = ['ado', 'ado-cloud'] as const;
export const WIQL = 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id]';

export type Panel = 'dossier' | 'work' | 'prs' | 'builds' | 'deployments';

export interface DossierSummary {
  name: string;
  description: string | null;
  /** The areas it covers, with the connection each would use. */
  sources: Array<{ area: string; connection: string | null }>;
  environments: string[];
}

export interface DossierData extends DossierSummary {
  items: WorkItem[];
  changes: ChangeRef[];
  deployments: Deployment[];
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

/** How many pull requests that aren't open still get their checks read: the newest ones. */
export const CHECKED_CLOSED_PRS = 20;

/**
 * The pull requests whose checks are read: every open one, and the newest
 * closed or merged ones. A repository with years of history would otherwise
 * cost one request per pull request it ever had, on every sync.
 */
export function checkedPrs(prs: ChangeRef[]): ChangeRef[] {
  const closed = prs.filter((p) => p.outcome !== 'open').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, CHECKED_CLOSED_PRS);
  const keep = new Set([...prs.filter((p) => p.outcome === 'open'), ...closed]);
  return prs.filter((p) => keep.has(p));
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

export interface LoadOptions {
  /** The OWI mapper: the browser's (src/owi.ts) by default; the tests pass the API's to prove they agree. */
  mapOwi?: (input: unknown) => { items: WorkItem[] };
}

export async function loadDossier(execute: Execute, name: string, options: LoadOptions = {}): Promise<DossierData> {
  const calls: Record<Panel, Call[]> = { dossier: [], work: [], prs: [], builds: [], deployments: [] };

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
  const work: unknown[] = [];
  const tasks: Array<Promise<void>> = [];
  if (areas.jira?.inputs.project) {
    tasks.push((async () => {
      const search = await run('work', 'jira issue search', { ...base, jql: JQL(areas.jira!.inputs.project!) });
      if (!search) return;
      work.push(search);
      const keys = recs((search.data as Rec).issues).map((i) => String(i.key));
      for (const key of keys) {
        const history = await run('work', 'jira issue history', { ...base, key });
        if (history) work.push({ key, history });
      }
    })());
  }
  // Azure DevOps Server and Services send the same work item shapes under the same command names.
  for (const ado of ADO_AREAS.filter((a) => areas[a])) {
    tasks.push((async () => {
      const iterations = await run('work', `${ado} work-item iterations`, base);
      if (iterations) work.push(iterations);
      const search = await run('work', `${ado} work-item search`, { ...base, wiql: WIQL });
      const ids = search ? recs((search.data as Rec).workItems).map((w) => Number(w.id)) : [];
      if (!ids.length) return;
      const batch = await run('work', `${ado} work-item get-many`, { ...base, id: ids });
      if (batch) work.push(batch);
      for (const id of ids) {
        const revisions = await run('work', `${ado} work-item history`, { ...base, id });
        if (revisions) work.push(revisions);
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
        const issues = await run('work', 'github list-issues', { ...base, state: 'all' });
        if (!issues) return;
        work.push(issues);
        for (const number of historyNumbers(recs(issues.data))) {
          const events = await run('work', 'github issue-events', { ...base, number });
          if (events) work.push({ key: String(number), history: events });
        }
        return;
      }
      for (const project of projects) {
        const board = await run('work', 'github projects list-items', { ...base, project: Number(project) });
        if (!board) continue;
        work.push(board);
        for (const item of recs(board.data)) {
          const content = isRec(item.content) ? item.content : {};
          if (isRec(content.repository) && content.repository.nameWithOwner === repo && typeof content.number === 'number') numbers.add(content.number);
        }
      }
      if (!numbers.size) return;
      const issues = await run('work', 'github get-issue', { ...base, number: [...numbers], subIssues: true });
      if (issues) work.push(issues);
      for (const number of numbers) {
        const events = await run('work', 'github issue-events', { ...base, number });
        if (events) work.push({ key: String(number), history: events });
      }
    })());
  }
  await Promise.all(tasks);
  const items = work.length ? (options.mapOwi ?? mapOwi)(work).items : [];

  // Pull requests, their builds, and deployments --------------------------------------
  const changes: ChangeRef[] = [];
  const deployments: Deployment[] = [];
  const environments = isRec(dossier.environments) ? (dossier.environments as Record<string, Rec>) : {};
  const namespaces = Object.entries(environments).flatMap(([env, e]) => (isRec(e.openshift) && typeof e.openshift.namespace === 'string' ? [[env, e.openshift.namespace] as const] : []));

  const deliver = async (prs: ChangeRef[], builds: () => Promise<ChangeRef[]>, deploys: () => Promise<Deployment[]>) => {
    changes.push(...prs, ...(await builds()));
    deployments.push(...(await deploys()));
  };
  const onOpenShift = async (prs: ChangeRef[]) => {
    const out: Deployment[] = [];
    for (const [env, namespace] of namespaces) {
      const answer = await run('deployments', 'openshift deployments', { ...base, env, namespace });
      if (answer) out.push(...openshiftDeployments(answer.data, env, repos, prs));
    }
    return out;
  };

  if (areas.bitbucket) {
    const list = await run('prs', 'bitbucket list-prs', { ...base, state: 'ALL' });
    const prs = list ? bitbucketPrs(list.data, connectionOf(list, 'bitbucket'), items) : [];
    const jobs = strings(section('jenkins').jobs);
    await deliver(prs, async () => {
      const out: ChangeRef[] = [];
      for (const job of jobs) {
        for (const pr of prs) {
          const id = pr.id.slice(pr.id.lastIndexOf('#') + 1);
          const runs = await run('builds', 'jenkins pipeline list-runs', { ...base, name: `${job}/PR-${id}`, top: 5 });
          if (runs) out.push(...jenkinsBuilds(runs.data, connectionOf(runs, 'jenkins'), `${job}/PR-${id}`, pr));
        }
      }
      return out;
    }, async () => []);
  }
  // Azure DevOps Services: its pull requests when the dossier names a repository. It has no pipeline commands yet.
  if (areas['ado-cloud']?.inputs.repo) {
    const list = await run('prs', 'ado-cloud pr list', { ...base, state: 'all' });
    const connection = list ? connectionOf(list, 'ado-cloud') : 'ado-cloud';
    changes.push(...(list ? adoPrs(list.data, connection, items, 'ado-cloud pr list') : []));
  }
  if (areas.ado) {
    const list = await run('prs', 'ado pr list', { ...base, state: 'all' });
    const connection = list ? connectionOf(list, 'ado') : 'ado';
    const prs = list ? adoPrs(list.data, connection, items) : [];
    await deliver(prs, async () => {
      const out: ChangeRef[] = [];
      for (const pipeline of strings(section('ado').builds)) {
        const runs = await run('builds', 'ado run list', { ...base, name: pipeline, top: 20 });
        if (runs) out.push(...adoBuilds(runs.data, connection, prs));
      }
      return out;
    }, async () => {
      const out: Deployment[] = [];
      for (const pipeline of strings(section('ado').deployments)) {
        const runs = await run('deployments', 'ado run list', { ...base, name: pipeline, top: 20 });
        if (runs) out.push(...adoDeployments(runs.data, connection, prs));
      }
      return out;
    });
  }
  if (areas.github) {
    const repo = `${areas.github.inputs.owner}/${areas.github.inputs.repo}`;
    const list = await run('prs', 'github list-prs', { ...base, state: 'all' });
    const connection = list ? connectionOf(list, 'github') : 'github';
    const prs = list ? githubPrs(list.data, connection, repo, items) : [];
    const heads = new Map(recs(list?.data).map((raw) => [`${connection}:${repo}#${raw.number}`, githubHead(raw)]));
    await deliver(prs, async () => {
      const out: ChangeRef[] = [];
      for (const pr of checkedPrs(prs)) {
        const ref = heads.get(pr.id);
        if (!ref) continue;
        const checks = await run('builds', 'github list-checks', { ...base, ref });
        const build = checks ? githubBuild(checks.data, connection, pr) : null;
        if (build) out.push(build);
      }
      return out;
    }, async () => []);
  }

  // OpenShift once per dossier, after every code host's pull requests are in, so a
  // dossier with two code hosts reads each namespace once (#229 review).
  if (namespaces.length) deployments.push(...(await onOpenShift(changes.filter((c) => c.kind === 'pull-request'))));

  return { ...summary, items, changes, deployments: deployments.sort(byEnvironment), calls };
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
