import { at, blankChange, gap, included, messagesOf, notIncluded, reviewTimes, rollUp, setAuthorKind, workItemsIn, type ChangeMapState, type CheckRun } from './change.js';
import { isRecord, num, person, str, type OwiDocument } from './common.js';
import type { Change, Person, Review, ReviewerState } from './types.js';

/**
 * Bitbucket pull requests to OWI changes: Data Center and Cloud, both the
 * `bitbucket` area (a connection's `deployment`), whose shapes differ in almost
 * every field, so each has its own reader here. Neither host has a tracker of its own, so a
 * pull request names work only through key patterns (`PAY-{n}` to a Jira
 * connection); with none, its work items are listed as unmapped.
 *
 * Docs, checked 2026-10-19. Data Center: the pull request resource
 * (state, draft, reviewers[].status APPROVED / NEEDS_WORK / UNAPPROVED,
 * properties.mergeResult, properties.mergeCommit, createdDate, updatedDate,
 * closedDate) and its activities (action APPROVED, UNAPPROVED, REVIEWED) at
 * https://developer.atlassian.com/server/bitbucket/rest/, build statuses
 * (state SUCCESSFUL, FAILED, INPROGRESS) in the build integration API.
 * Cloud: the pullrequest schema (state OPEN, MERGED, DECLINED, SUPERSEDED;
 * participants[].state approved / changes_requested), its activity, statuses
 * and diffstat at https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/.
 * Two products, one name, and a migration guide longer than either.
 */

type Rec = Record<string, unknown>;

/** The pull requests a document holds: a list's array, or one get's object. */
export function bitbucketPrs(data: unknown): Rec[] | undefined {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && (typeof data.id === 'number' || typeof data.id === 'string')) return [data];
  return undefined;
}

const noKeys = (change: Change, state: ChangeMapState) => {
  if (!state.changes.keys.length) gap(change, 'workItems', 'Bitbucket has no tracker of its own, and no key patterns were given, so no work item keys were read: pass a key pattern such as PAY-{n}=<jira connection>');
};

const parts = (pr: Rec, branch: string | null, description: unknown) => [str(pr.title), branch, str(description)];

// Data Center ---------------------------------------------------------------------

const dcPerson = (value: unknown): Person | null => (isRecord(value) ? person(value.name ?? value.slug, value.displayName, value.emailAddress) : null);
const DC_REVIEWER: Record<string, ReviewerState> = { APPROVED: 'APPROVED', NEEDS_WORK: 'CHANGES_REQUESTED', UNAPPROVED: 'PENDING' };
const DC_REVIEW: Record<string, Review['state']> = { APPROVED: 'APPROVED', REVIEWED: 'CHANGES_REQUESTED', UNAPPROVED: 'DISMISSED' };
const DC_CHECK: Record<string, CheckRun['outcome']> = { SUCCESSFUL: 'pass', FAILED: 'fail', CANCELLED: 'fail', INPROGRESS: 'pending', UNKNOWN: 'pending' };

export function bitbucketChange(doc: OwiDocument, pr: Rec, state: ChangeMapState): Change | undefined {
  const to = isRecord(pr.toRef) ? pr.toRef : {};
  const from = isRecord(pr.fromRef) ? pr.fromRef : {};
  const target = isRecord(to.repository) ? to.repository : {};
  const project = isRecord(target.project) ? str(target.project.key) : null;
  const slug = str(target.slug);
  const repo = project && slug ? `${project}/${slug}` : doc.inputs.project && doc.inputs.repo ? `${doc.inputs.project}/${doc.inputs.repo}` : null;
  if (!repo || pr.id === undefined) return undefined;
  const number = String(pr.id);
  const change = blankChange(doc, repo, number, str(pr.title) ?? `Pull request ${number}`, pr);
  const links = isRecord(pr.links) && Array.isArray(pr.links.self) ? pr.links.self.filter(isRecord) : [];
  change.url = str(links[0]?.href);
  change.branch = { source: str(from.displayId), target: str(to.displayId) };
  const author = isRecord(pr.author) ? pr.author.user : undefined;
  change.author = dcPerson(author);
  change.state = pr.state === 'MERGED' ? 'MERGED' : pr.state === 'DECLINED' ? 'DECLINED' : pr.draft === true ? 'DRAFT' : 'OPEN';
  change.created = at(change, 'created', pr.createdDate, 'createdDate');
  change.updated = at(change, 'updated', pr.updatedDate, 'updatedDate');
  const closed = at(change, 'closedAt', pr.closedDate, 'closedDate');
  change.closedAt = change.state === 'MERGED' || change.state === 'DECLINED' ? closed : null;
  change.mergedAt = change.state === 'MERGED' ? closed : null;
  const props = isRecord(pr.properties) ? pr.properties : {};
  change.mergeCommit = change.state === 'MERGED' && isRecord(props.mergeCommit) ? str(props.mergeCommit.id) : null;
  const outcome = isRecord(props.mergeResult) ? props.mergeResult.outcome : undefined;
  change.mergeable = outcome === 'CLEAN' ? true : outcome === 'CONFLICTED' ? false : null;
  if (change.mergeable === null && change.state === 'OPEN') gap(change, 'mergeable', 'Bitbucket sent no properties.mergeResult outcome for it');

  change.workItems = workItemsIn(parts(pr, change.branch.source, pr.description), state.changes.keys);
  noKeys(change, state);

  change.reviewers = (Array.isArray(pr.reviewers) ? pr.reviewers.filter(isRecord) : []).flatMap((r) => {
    const p = dcPerson(r.user);
    return p ? [{ person: p, state: DC_REVIEWER[String(r.status)] ?? 'PENDING' }] : [];
  });

  const lists = included(pr);
  if (lists.reviews) {
    reviewTimes(change, lists.reviews.filter(isRecord).flatMap((a): Review[] => {
      const by = dcPerson(a.user);
      const kind = DC_REVIEW[String(a.action)];
      const when = at(change, 'reviews', a.createdDate, "an activity's createdDate");
      return by && kind && when ? [{ by, state: kind, at: when }] : [];
    }));
  } else for (const f of ['reviews', 'firstReviewAt', 'approvedAt']) gap(change, f, notIncluded(doc, 'reviews'));

  if (lists.checks) {
    rollUp(change, lists.checks.filter(isRecord).map((b) => ({ name: str(b.name) ?? str(b.key) ?? 'build', outcome: DC_CHECK[String(b.state)] ?? 'pending', at: at(change, 'checksAt', b.dateAdded, "a build status's dateAdded") })));
  } else gap(change, 'checks', notIncluded(doc, 'checks'));

  if (lists.files) {
    change.size = { files: lists.files.length, additions: null, deletions: null };
    gap(change, 'size', "Bitbucket Data Center lists the files a pull request changes, not the lines, so additions and deletions are empty");
  } else gap(change, 'size', notIncluded(doc, 'files'));

  const account = isRecord(author) && author.type === 'SERVICE' ? { kind: 'BOT' as const, signal: `account ${String(author.name ?? author.slug)}, type SERVICE` } : null;
  setAuthorKind(change, state, { account, messages: lists.commits ? messagesOf(lists.commits) : null });
  return change;
}

// Cloud ---------------------------------------------------------------------------

const cloudPerson = (value: unknown): Person | null => (isRecord(value) ? person(value.account_id ?? value.uuid ?? value.nickname, value.display_name ?? value.nickname, null) : null);
const CLOUD_CHECK: Record<string, CheckRun['outcome']> = { SUCCESSFUL: 'pass', FAILED: 'fail', STOPPED: 'fail', INPROGRESS: 'pending' };

export function bitbucketCloudChange(doc: OwiDocument, pr: Rec, state: ChangeMapState): Change | undefined {
  const dest = isRecord(pr.destination) ? pr.destination : {};
  const src = isRecord(pr.source) ? pr.source : {};
  const destRepo = isRecord(dest.repository) ? str(dest.repository.full_name) : null;
  const repo = destRepo ?? (doc.inputs.workspace && doc.inputs.repo ? `${doc.inputs.workspace}/${doc.inputs.repo}` : null);
  if (!repo || pr.id === undefined) return undefined;
  const number = String(pr.id);
  const change = blankChange(doc, repo, number, str(pr.title) ?? `Pull request ${number}`, pr);
  change.url = isRecord(pr.links) && isRecord(pr.links.html) ? str(pr.links.html.href) : null;
  change.branch = { source: isRecord(src.branch) ? str(src.branch.name) : null, target: isRecord(dest.branch) ? str(dest.branch.name) : null };
  change.author = cloudPerson(pr.author);
  change.state = pr.state === 'MERGED' ? 'MERGED' : pr.state === 'DECLINED' || pr.state === 'SUPERSEDED' ? 'DECLINED' : pr.draft === true ? 'DRAFT' : 'OPEN';
  change.created = at(change, 'created', pr.created_on, 'created_on');
  change.updated = at(change, 'updated', pr.updated_on, 'updated_on');
  if (change.state === 'MERGED' || change.state === 'DECLINED') {
    gap(change, 'mergedAt', "Bitbucket Cloud's pull request records no merge or close time; updated is the nearest it has");
    gap(change, 'closedAt', "Bitbucket Cloud's pull request records no merge or close time; updated is the nearest it has");
  }
  change.mergeCommit = change.state === 'MERGED' && isRecord(pr.merge_commit) ? str(pr.merge_commit.hash) : null;
  if (change.state === 'OPEN' || change.state === 'DRAFT') gap(change, 'mergeable', "Bitbucket Cloud's pull request doesn't say whether it merges cleanly");
  const description = str(pr.description) ?? (isRecord(pr.summary) ? str(pr.summary.raw) : null);
  change.workItems = workItemsIn(parts(pr, change.branch.source, description), state.changes.keys);
  noKeys(change, state);

  // Reviewers asked, then where each participant who reviewed stands.
  const byId = new Map<string, { person: Person; state: ReviewerState }>();
  for (const r of Array.isArray(pr.reviewers) ? pr.reviewers : []) {
    const p = cloudPerson(r);
    if (p) byId.set(p.id, { person: p, state: 'PENDING' });
  }
  for (const part of Array.isArray(pr.participants) ? pr.participants.filter(isRecord) : []) {
    const p = cloudPerson(part.user);
    if (!p || (part.role !== 'REVIEWER' && !part.state)) continue;
    byId.set(p.id, { person: p, state: part.state === 'approved' || part.approved === true ? 'APPROVED' : part.state === 'changes_requested' ? 'CHANGES_REQUESTED' : 'PENDING' });
  }
  change.reviewers = [...byId.values()];

  const lists = included(pr);
  if (lists.reviews) {
    reviewTimes(change, lists.reviews.filter(isRecord).flatMap((entry): Review[] => {
      const event = isRecord(entry.approval) ? { e: entry.approval, kind: 'APPROVED' as const } : isRecord(entry.changes_requested) ? { e: entry.changes_requested, kind: 'CHANGES_REQUESTED' as const } : null;
      if (!event) return [];
      const by = cloudPerson(event.e.user);
      const when = at(change, 'reviews', event.e.date, "an activity entry's date");
      return by && when ? [{ by, state: event.kind, at: when }] : [];
    }));
  } else for (const f of ['reviews', 'firstReviewAt', 'approvedAt']) gap(change, f, notIncluded(doc, 'reviews'));

  if (lists.checks) {
    rollUp(change, lists.checks.filter(isRecord).map((s) => ({ name: str(s.name) ?? str(s.key) ?? 'build', outcome: CLOUD_CHECK[String(s.state)] ?? 'pending', at: at(change, 'checksAt', s.updated_on ?? s.created_on, "a status's updated_on") })));
  } else gap(change, 'checks', notIncluded(doc, 'checks'));

  if (lists.files) {
    const files = lists.files.filter(isRecord);
    change.size = { files: files.length, additions: files.reduce((n, f) => n + (num(f.lines_added) ?? 0), 0), deletions: files.reduce((n, f) => n + (num(f.lines_removed) ?? 0), 0) };
  } else gap(change, 'size', notIncluded(doc, 'files'));

  const author = isRecord(pr.author) ? pr.author : {};
  const account = author.type === 'app_user' ? { kind: 'BOT' as const, signal: `account ${String(author.display_name ?? author.account_id)}, an app user` } : null;
  setAuthorKind(change, state, { account, messages: lists.commits ? messagesOf(lists.commits) : null });
  return change;
}
