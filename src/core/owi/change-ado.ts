import { adoPerson } from './ado.js';
import { at, blankChange, branchNumber, gap, HASH_NUMBER, included, messagesOf, notIncluded, reviewTimes, rollUp, setAuthorKind, workItemsIn, type ChangeMapState, type CheckRun } from './change.js';
import { idFor, isRecord, str, type OwiDocument } from './common.js';
import type { Change, Review, ReviewerState } from './types.js';

/**
 * Azure DevOps pull requests to OWI changes, for Server and
 * Services (both `ado`, by the connection's deployment), which send the same GitPullRequest. A vote is a
 * number (10 approved, 5 approved with suggestions, 0 none, -5 waiting for
 * the author, -10 rejected); the history of votes is in the comment
 * threads, as system comments; `#2302` in a title or description is a work
 * item in the same organization, which is how Azure DevOps itself reads it.
 * A pull request records no last-updated time, so `updated` is unmapped.
 *
 * Docs, checked 2026-10-19: GitPullRequest (status, isDraft, mergeStatus,
 * reviewers[].vote, creationDate, closedDate, lastMergeCommit) at
 * https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request,
 * threads (properties CodeReviewThreadType VoteUpdate, CodeReviewVoteResult)
 * at .../git/pull-request-threads, statuses (state succeeded, failed, error,
 * pending, notSet, notApplicable) at .../git/pull-request-statuses. Votes
 * are recorded to the integer, as is only proper for a ballot.
 */

type Rec = Record<string, unknown>;

/** The pull requests a document holds: a list's array, or one get's object. */
export function adoPrs(data: unknown): Rec[] | undefined {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && typeof data.pullRequestId === 'number') return [data];
  return undefined;
}

const vote = (v: unknown): ReviewerState => (typeof v === 'number' && v >= 5 ? 'APPROVED' : typeof v === 'number' && v <= -5 ? 'CHANGES_REQUESTED' : 'PENDING');
const branch = (ref: unknown) => str(ref)?.replace(/^refs\/heads\//, '') ?? null;
/** A thread property's value: Azure DevOps wraps each as { $type, $value }. */
const prop = (thread: Rec, name: string): string | null => (isRecord(thread.properties) && isRecord(thread.properties[name]) ? str(String(thread.properties[name].$value ?? '')) : null);
const STATUS: Record<string, CheckRun['outcome']> = { succeeded: 'pass', notApplicable: 'pass', failed: 'fail', error: 'fail', pending: 'pending', notSet: 'pending' };

/** The pull request's page: the repository's web URL when sent, else built from its API URL, as work items' are. */
function webUrl(pr: Rec, repo: Rec, project: string | null, name: string | null): string | null {
  const id = String(pr.pullRequestId);
  const web = str(repo.webUrl);
  if (web) return `${web}/pullrequest/${id}`;
  const api = str(repo.url) ?? str(pr.url);
  const base = api?.split('/_apis/')[0];
  if (!base || !project || !name) return null;
  // The API URL ends in the project (by id); the page wants its name.
  return `${base.slice(0, base.lastIndexOf('/'))}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}/pullrequest/${id}`;
}

export function adoChange(doc: OwiDocument, pr: Rec, state: ChangeMapState): Change | undefined {
  const repository = isRecord(pr.repository) ? pr.repository : {};
  const project = isRecord(repository.project) ? str(repository.project.name) : (doc.inputs.project ?? null);
  const name = str(repository.name) ?? doc.inputs.repo ?? null;
  if (!project || !name || typeof pr.pullRequestId !== 'number') return undefined;
  const number = String(pr.pullRequestId);
  const change = blankChange(doc, `${project}/${name}`, number, str(pr.title) ?? `Pull request ${number}`, pr);
  change.url = webUrl(pr, repository, project, name);
  change.branch = { source: branch(pr.sourceRefName), target: branch(pr.targetRefName) };
  change.author = adoPerson(pr.createdBy);
  change.state = pr.status === 'completed' ? 'MERGED' : pr.status === 'abandoned' ? 'DECLINED' : pr.isDraft === true ? 'DRAFT' : 'OPEN';
  change.created = at(change, 'created', pr.creationDate, 'creationDate');
  const closed = change.state === 'MERGED' || change.state === 'DECLINED' ? at(change, 'closedAt', pr.closedDate, 'closedDate') : null;
  change.closedAt = closed;
  change.mergedAt = change.state === 'MERGED' ? closed : null;
  gap(change, 'updated', 'Azure DevOps records no last-updated time on a pull request');
  change.mergeCommit = change.state === 'MERGED' && isRecord(pr.lastMergeCommit) ? str(pr.lastMergeCommit.commitId) : null;
  change.mergeable = pr.mergeStatus === 'succeeded' ? true : pr.mergeStatus === 'conflicts' ? false : null;
  if (change.mergeable === null && change.state !== 'MERGED' && change.state !== 'DECLINED') gap(change, 'mergeable', `Azure DevOps reported mergeStatus ${JSON.stringify(pr.mergeStatus ?? null)}, which says neither clean nor conflicting`);

  // #2302 is a work item in this organization, as Azure DevOps reads it; so is a branch named 2302-….
  const own = (text: string) => [...text.matchAll(HASH_NUMBER)].map((m) => idFor(doc.connection, m[1]!));
  const fromBranch = branchNumber(change.branch.source);
  change.workItems = workItemsIn([change.title, fromBranch ? `#${fromBranch}` : null, change.branch.source, str(pr.description)], state.changes.keys, own);

  const author = change.author?.id.toLowerCase();
  change.reviewers = (Array.isArray(pr.reviewers) ? pr.reviewers.filter(isRecord) : []).flatMap((r) => {
    const p = adoPerson(r);
    return p ? [{ person: p, state: vote(r.vote) }] : [];
  });

  const lists = included(pr);
  if (lists.reviews) {
    const reviews: Review[] = [];
    for (const thread of lists.reviews.filter(isRecord).filter((t) => t.isDeleted !== true)) {
      const comments = Array.isArray(thread.comments) ? thread.comments.filter(isRecord) : [];
      if (prop(thread, 'CodeReviewThreadType') === 'VoteUpdate') {
        const result = Number(prop(thread, 'CodeReviewVoteResult'));
        const by = adoPerson(comments[0]?.author);
        const when = at(change, 'reviews', thread.publishedDate ?? comments[0]?.publishedDate, "a vote thread's publishedDate");
        if (by && when && Number.isFinite(result)) reviews.push({ by, state: result >= 5 ? 'APPROVED' : result <= -5 ? 'CHANGES_REQUESTED' : 'DISMISSED', at: when });
        continue;
      }
      // A thread a reviewer started counts as a review that commented; the author's own and the system's don't.
      const first = comments[0];
      if (!first || first.commentType === 'system') continue;
      const by = adoPerson(first.author);
      const when = at(change, 'reviews', first.publishedDate, "a comment's publishedDate");
      if (by && when && by.id.toLowerCase() !== author) reviews.push({ by, state: 'COMMENTED', at: when });
    }
    reviewTimes(change, reviews);
  } else for (const f of ['reviews', 'firstReviewAt', 'approvedAt']) gap(change, f, notIncluded(doc, 'reviews'));

  if (lists.checks) {
    // A status is posted again for each iteration: the latest per context is the one that stands.
    const latest = new Map<string, Rec>();
    for (const s of lists.checks.filter(isRecord)) {
      const context = isRecord(s.context) ? `${str(s.context.genre) ?? ''}/${str(s.context.name) ?? ''}` : String(s.id);
      const when = String(s.updatedDate ?? s.creationDate ?? '');
      const before = latest.get(context);
      if (!before || String(before.updatedDate ?? before.creationDate ?? '') <= when) latest.set(context, s);
    }
    rollUp(change, [...latest.entries()].map(([context, s]) => ({ name: context, outcome: STATUS[String(s.state)] ?? 'pending', at: at(change, 'checksAt', s.updatedDate ?? s.creationDate, "a status's creationDate") })));
  } else gap(change, 'checks', notIncluded(doc, 'checks'));

  if (lists.files) {
    change.size = { files: lists.files.filter((f) => !(isRecord(f) && isRecord(f.item) && f.item.isFolder === true)).length, additions: null, deletions: null };
    gap(change, 'size', 'Azure DevOps lists the files a pull request changes, not the lines, so additions and deletions are empty');
  } else gap(change, 'size', notIncluded(doc, 'files'));

  // A service identity's descriptor starts svc. (a user's aad. or win.): that is the account saying it isn't a person.
  const descriptor = isRecord(pr.createdBy) ? str(pr.createdBy.descriptor) : null;
  const account = descriptor?.startsWith('svc.') ? { kind: 'BOT' as const, signal: `account ${change.author?.name ?? change.author?.id ?? 'unknown'}, a service identity` } : null;
  setAuthorKind(change, state, { account, messages: lists.commits ? messagesOf(lists.commits) : null });
  return change;
}
