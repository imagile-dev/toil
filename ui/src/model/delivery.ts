/**
 * Pull requests, builds and deployments, read from each command's own output
 * into the UI's `ChangeRef` and `Deployment` (src/toil.ts). Pure functions of
 * the `data` the commands return, so the dashboards and the tests agree. The
 * rules, which AGENT_DECISIONS.md (#228 dossier dashboard) records:
 *
 * - **A pull request names its work items** in its title or description: a
 *   Jira key (`PAY-101`), or `#<number>` for an Azure DevOps work item or a
 *   GitHub issue in the same repository. Only items the dossier's own query
 *   returned count.
 * - **A build belongs to a pull request** by the source's own link: the
 *   Jenkins multibranch job `PR-<id>`, an Azure Pipelines run's
 *   `triggerInfo["pr.number"]`, or the GitHub checks on the pull request's head.
 *   A GitHub head's checks are one build: failed if any failed, running if any
 *   are, else passed.
 * - **A deployment names a commit**: the image tag's trailing hex on an
 *   OpenShift Deployment (`payments-core:1.14.0-4e1d2a9`), or a deploy run's
 *   `sourceVersion`. It includes the merged pull request whose merge commit
 *   that is, and every one merged before it, since the target branch is
 *   linear. A commit no listed pull request merged as is shown as unknown,
 *   never guessed.
 */

import type { ChangeRef, Deployment, WorkItem } from '../toil.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const iso = (v: unknown): string => (typeof v === 'number' ? new Date(v).toISOString() : typeof v === 'string' ? new Date(v).toISOString() : '');

/** The OWI ids of the dossier's items a pull request's text names. */
export function mentioned(text: string, items: WorkItem[], repo?: string): string[] {
  const out = new Set<string>();
  for (const [key] of text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) for (const i of items) if (i.source.area.startsWith('jira') && i.source.key === key) out.add(i.id);
  for (const [, n] of text.matchAll(/#(\d+)\b/g)) {
    for (const i of items) {
      if (i.source.area.startsWith('ado') && i.source.key === n) out.add(i.id);
      if (i.source.area === 'github' && repo && i.source.key === `${repo}#${n}`) out.add(i.id);
    }
  }
  return [...out];
}

// Pull requests ---------------------------------------------------------------

export function bitbucketPrs(data: unknown, connection: string, items: WorkItem[]): ChangeRef[] {
  return recs(data).map((pr) => {
    const repo = isRec(pr.toRef) && isRec(pr.toRef.repository) ? pr.toRef.repository : {};
    const project = isRec(repo.project) ? str(repo.project.key) : null;
    const state = str(pr.state) ?? 'UNKNOWN';
    const merge = isRec(pr.properties) && isRec(pr.properties.mergeCommit) ? str(pr.properties.mergeCommit.id) : null;
    const self = isRec(pr.links) ? recs(pr.links.self)[0] : undefined;
    return {
      id: `${connection}:${project}/${str(repo.slug)}#${pr.id}`,
      kind: 'pull-request',
      source: 'bitbucket',
      command: 'bitbucket list-prs',
      items: mentioned(`${pr.title ?? ''}\n${pr.description ?? ''}`, items),
      title: str(pr.title) ?? `Pull request ${pr.id}`,
      url: str(self?.href),
      state,
      outcome: state === 'MERGED' ? 'merged' : state === 'DECLINED' ? 'declined' : 'open',
      builds: null,
      mergeCommit: state === 'MERGED' ? merge : null,
      at: iso(pr.closedDate ?? pr.createdDate),
    };
  });
}

export function adoPrs(data: unknown, connection: string, items: WorkItem[]): ChangeRef[] {
  return recs(data).map((pr) => {
    const repo = isRec(pr.repository) ? pr.repository : {};
    const project = isRec(repo.project) ? str(repo.project.name) : null;
    const status = str(pr.status) ?? 'unknown';
    const merge = isRec(pr.lastMergeCommit) ? str(pr.lastMergeCommit.commitId) : null;
    const web = str(repo.webUrl);
    return {
      id: `${connection}:${project}/${str(repo.name)}#${pr.pullRequestId}`,
      kind: 'pull-request',
      source: 'ado',
      command: 'ado repo list-prs',
      items: mentioned(`${pr.title ?? ''}\n${pr.description ?? ''}`, items),
      title: str(pr.title) ?? `Pull request ${pr.pullRequestId}`,
      url: web ? `${web}/pullrequest/${pr.pullRequestId}` : null,
      state: status,
      outcome: status === 'completed' ? 'merged' : status === 'abandoned' ? 'declined' : 'open',
      builds: null,
      mergeCommit: status === 'completed' ? merge : null,
      at: iso(pr.closedDate ?? pr.creationDate),
    };
  });
}

export function githubPrs(data: unknown, connection: string, repo: string, items: WorkItem[]): ChangeRef[] {
  return recs(data).map((pr) => {
    const merged = str(pr.merged_at);
    const state = merged ? 'merged' : pr.draft === true ? 'open (draft)' : (str(pr.state) ?? 'unknown');
    return {
      id: `${connection}:${repo}#${pr.number}`,
      kind: 'pull-request',
      source: 'github',
      command: 'github list-prs',
      items: mentioned(`${pr.title ?? ''}\n${pr.body ?? ''}`, items, repo),
      title: str(pr.title) ?? `Pull request ${pr.number}`,
      url: str(pr.html_url),
      state,
      outcome: merged ? 'merged' : pr.state === 'closed' ? 'declined' : 'open',
      builds: null,
      mergeCommit: merged ? str(pr.merge_commit_sha) : null,
      at: iso(merged ?? pr.created_at),
    };
  });
}

/** The head commit GitHub's checks are listed for. */
export const githubHead = (pr: Rec): string | null => (isRec(pr.head) ? str(pr.head.sha) : null);

// Builds -------------------------------------------------------------------------

const JENKINS_OUTCOME: Record<string, ChangeRef['outcome']> = { SUCCESS: 'passed', FAILURE: 'failed', UNSTABLE: 'failed', ABORTED: 'failed' };

/** One Jenkins multibranch job's runs (`<job>/PR-<id>`), for the pull request it builds. */
export function jenkinsBuilds(data: unknown, connection: string, job: string, pr: ChangeRef): ChangeRef[] {
  return recs(data).map((run) => {
    const result = str(run.result);
    return {
      id: `${connection}:${job}#${run.number}`,
      kind: 'build',
      source: 'jenkins',
      command: 'jenkins pipeline list-runs',
      items: pr.items,
      title: str(run.fullDisplayName) ?? `${job} #${run.number}`,
      url: str(run.url),
      state: run.building === true ? 'BUILDING' : (result ?? 'UNKNOWN'),
      outcome: run.building === true || result === null ? 'running' : (JENKINS_OUTCOME[result] ?? 'failed'),
      builds: pr.id,
      mergeCommit: null,
      at: iso(run.timestamp),
    };
  });
}

/** Azure Pipelines CI runs, each joined to its pull request by `triggerInfo["pr.number"]` or a `refs/pull/<id>/merge` branch. */
export function adoBuilds(data: unknown, connection: string, prs: ChangeRef[]): ChangeRef[] {
  return recs(data).flatMap((run) => {
    const trigger = isRec(run.triggerInfo) ? str(run.triggerInfo['pr.number']) : null;
    const number = trigger ?? /^refs\/pull\/(\d+)\/merge$/.exec(str(run.sourceBranch) ?? '')?.[1];
    const pr = number ? prs.find((p) => p.id.endsWith(`#${number}`)) : undefined;
    if (!pr) return [];
    const status = str(run.status);
    const result = str(run.result);
    const definition = isRec(run.definition) ? str(run.definition.name) : null;
    return [{
      id: `${connection}:build#${run.id}`,
      kind: 'build' as const,
      source: 'ado' as const,
      command: 'ado pipeline list-runs',
      items: pr.items,
      title: `${definition ?? 'build'} ${run.buildNumber}`,
      url: isRec(run._links) && isRec(run._links.web) ? str(run._links.web.href) : null,
      state: status === 'completed' ? (result ?? 'completed') : (status ?? 'unknown'),
      outcome: status !== 'completed' ? ('running' as const) : result === 'succeeded' ? ('passed' as const) : ('failed' as const),
      builds: pr.id,
      mergeCommit: null,
      at: iso(run.finishTime ?? run.startTime ?? run.queueTime),
    }];
  });
}

/** A pull request head's GitHub checks, as one build. */
export function githubBuild(data: unknown, connection: string, pr: ChangeRef): ChangeRef | null {
  const runs = recs(data);
  if (!runs.length) return null;
  const failed = runs.filter((r) => r.conclusion !== null && r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'neutral');
  const running = runs.filter((r) => r.status !== 'completed');
  const worst = failed[0] ?? running[0] ?? runs[0]!;
  const at = runs.map((r) => iso(r.completed_at ?? r.started_at)).sort().at(-1)!;
  return {
    id: `${pr.id}/checks`,
    kind: 'build',
    source: 'github',
    command: 'github list-checks',
    items: pr.items,
    title: runs.map((r) => str(r.name)).join(', '),
    url: str(worst.html_url),
    state: failed.length ? `failure (${failed.map((r) => r.name).join(', ')})` : running.length ? 'in_progress' : 'success',
    outcome: failed.length ? 'failed' : running.length ? 'running' : 'passed',
    builds: pr.id,
    mergeCommit: null,
    at,
  };
}

// Deployments ------------------------------------------------------------------------

/** What a deployed commit includes: its own pull request and every one merged before it. */
export function included(commit: string, prs: ChangeRef[]): { includes: string[]; items: string[]; unknownCommit: boolean } {
  const merged = prs.filter((p) => p.outcome === 'merged' && p.mergeCommit).sort((a, b) => (a.at < b.at ? -1 : 1));
  const at = merged.findIndex((p) => p.mergeCommit!.startsWith(commit) || commit.startsWith(p.mergeCommit!));
  if (at < 0) return { includes: [], items: [], unknownCommit: true };
  const includes = merged.slice(0, at + 1);
  return { includes: includes.map((p) => p.id), items: [...new Set(includes.flatMap((p) => p.items))], unknownCommit: false };
}

const IMAGE_TAG = /:(?:(.+)-)?([0-9a-f]{7,40})$/;

/** An OpenShift namespace's Deployments for the dossier's repositories, by the commit in each image tag. */
export function openshiftDeployments(data: unknown, environment: string, repos: string[], prs: ChangeRef[]): Deployment[] {
  const body = isRec(data) ? data : {};
  return recs(body.deployments)
    .filter((d) => repos.includes(String(d.name)))
    .map((d) => {
      const image = str(recs(d.images)[0]?.image) ?? '';
      const [, version, commit] = IMAGE_TAG.exec(image) ?? [];
      const ready = str(d.ready) ?? '?';
      const unavailable = typeof d.unavailableReplicas === 'number' ? d.unavailableReplicas : 0;
      return {
        id: `openshift:${body.namespace}/${d.name}`,
        environment,
        source: 'openshift' as const,
        command: 'openshift deployments',
        name: `${d.name} in ${body.namespace}`,
        commit: commit ?? '',
        version: version ?? null,
        state: `${ready} ready`,
        outcome: unavailable > 0 ? ('failed' as const) : ('passed' as const),
        url: null,
        ...(commit ? included(commit, prs) : { includes: [], items: [], unknownCommit: true }),
      };
    });
}

/** Azure Pipelines deploy runs: the newest successful run per `templateParameters.environment`. */
export function adoDeployments(data: unknown, connection: string, prs: ChangeRef[]): Deployment[] {
  const runs = recs(data)
    .filter((r) => r.status === 'completed' && r.result === 'succeeded' && isRec(r.templateParameters) && str(r.templateParameters.environment))
    .sort((a, b) => (iso(a.finishTime) < iso(b.finishTime) ? 1 : -1));
  const seen = new Set<string>();
  const out: Deployment[] = [];
  for (const run of runs) {
    const environment = str((run.templateParameters as Rec).environment)!;
    if (seen.has(environment)) continue;
    seen.add(environment);
    const commit = str(run.sourceVersion) ?? '';
    out.push({
      id: `${connection}:build#${run.id}`,
      environment,
      source: 'ado',
      command: 'ado pipeline list-runs',
      name: `${isRec(run.definition) ? str(run.definition.name) : 'deploy'} ${run.buildNumber}`,
      commit: commit.slice(0, 7),
      version: null,
      state: String(run.result),
      outcome: 'passed',
      url: isRec(run._links) && isRec(run._links.web) ? str(run._links.web.href) : null,
      ...included(commit, prs),
    });
  }
  return out;
}

const ENV_ORDER = ['dev', 'test', 'staging', 'prod'];
export const byEnvironment = (a: Deployment, b: Deployment) => {
  const rank = (e: string) => (ENV_ORDER.includes(e) ? ENV_ORDER.indexOf(e) : ENV_ORDER.length);
  return rank(a.environment) - rank(b.environment) || a.environment.localeCompare(b.environment);
};
