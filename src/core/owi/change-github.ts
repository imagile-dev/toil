import { at, blankChange, branchNumber, gap, HASH_NUMBER, included, messagesOf, notIncluded, reviewTimes, rollUp, setAuthorKind, workItemsIn, AGENT_ACCOUNTS, type AccountSignal, type ChangeMapState, type CheckRun } from './change.js';
import { idFor, isRecord, num, str, type OwiDocument } from './common.js';
import { ghPerson } from './github.js';
import type { Change, Review, ReviewerState, ReviewState } from './types.js';

/**
 * GitHub (`github`) pull requests to OWI changes: `pr list` (the pulls
 * list, which holds no reviews, checks or mergeability) and `pr get` (one
 * pull request, with its size and mergeability, and with `--include` its
 * reviews, the check runs on its head, its commits and its files). The
 * list is enough to rank what is open; the get is what says why it waits.
 *
 * Docs, checked 2026-10-19: pulls at https://docs.github.com/en/rest/pulls/pulls
 * (draft, merged_at, requested_reviewers, mergeable, additions, deletions,
 * changed_files), reviews at https://docs.github.com/en/rest/pulls/reviews
 * (state APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING),
 * check runs at https://docs.github.com/en/rest/checks/runs (status and
 * conclusion). A pull request is an issue that has been through review,
 * which is more than most issues can say.
 */

type Pr = Record<string, unknown>;

/** The pull requests a document holds: a list's array, or one get's object. */
export function githubPrs(data: unknown): Pr[] | undefined {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && typeof data.number === 'number') return [data];
  return undefined;
}

const REVIEW_STATES: Record<string, ReviewState> = { APPROVED: 'APPROVED', CHANGES_REQUESTED: 'CHANGES_REQUESTED', COMMENTED: 'COMMENTED', DISMISSED: 'DISMISSED' };
/** A conclusion that fails the checks; neutral and skipped pass, as GitHub's own merge box treats them. */
const FAILING = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

/** What the account says: a bot, or a coding agent's account. */
function account(user: unknown): AccountSignal | null {
  if (!isRecord(user)) return null;
  const login = str(user.login) ?? '';
  if (AGENT_ACCOUNTS.includes(login.toLowerCase())) return { kind: 'AGENT', signal: `account ${login}, a coding agent's` };
  if (user.type === 'Bot' || login.endsWith('[bot]')) return { kind: 'BOT', signal: `account ${login}, type Bot` };
  return null;
}

/** The repository a pull request is in: its base's full name, else the call's owner and repo. */
function repoOf(pr: Pr, doc: OwiDocument): string | null {
  const base = isRecord(pr.base) && isRecord(pr.base.repo) ? str(pr.base.repo.full_name) : null;
  if (base) return base;
  const { owner, repo } = doc.inputs;
  return owner && repo ? `${owner}/${repo}` : null;
}

export function githubChange(doc: OwiDocument, pr: Pr, state: ChangeMapState): Change | undefined {
  const repo = repoOf(pr, doc);
  if (!repo || typeof pr.number !== 'number') return undefined;
  const number = String(pr.number);
  const change = blankChange(doc, repo, number, str(pr.title) ?? `Pull request ${number}`, pr);
  change.url = str(pr.html_url);
  change.branch = { source: isRecord(pr.head) ? str(pr.head.ref) : null, target: isRecord(pr.base) ? str(pr.base.ref) : null };
  change.author = ghPerson(pr.user);
  change.state = str(pr.merged_at) ? 'MERGED' : pr.state === 'closed' ? 'DECLINED' : pr.draft === true ? 'DRAFT' : 'OPEN';
  change.created = at(change, 'created', pr.created_at, 'created_at');
  change.updated = at(change, 'updated', pr.updated_at, 'updated_at');
  change.mergedAt = at(change, 'mergedAt', pr.merged_at, 'merged_at');
  change.closedAt = at(change, 'closedAt', pr.closed_at, 'closed_at');
  change.mergeCommit = change.state === 'MERGED' ? str(pr.merge_commit_sha) : null;

  // Its own references: #12 and owner/repo#12 are issues on this host, and so is a branch named 291-…
  const own = (text: string) => [
    ...[...text.matchAll(HASH_NUMBER)].map((m) => idFor(doc.connection, `${repo}#${m[1]}`)),
    ...[...text.matchAll(/(?<![\w.-])([\w.-]+\/[\w.-]+)#(\d+)\b/g)].map((m) => idFor(doc.connection, `${m[1]}#${m[2]}`)),
  ];
  const fromBranch = branchNumber(change.branch.source);
  change.workItems = workItemsIn([change.title, fromBranch ? `#${fromBranch}` : null, change.branch.source, str(pr.body)], state.changes.keys, own).filter((id) => id !== change.id);

  const lists = included(pr);
  const requested = Array.isArray(pr.requested_reviewers) ? pr.requested_reviewers.flatMap((u) => (ghPerson(u) ? [ghPerson(u)!] : [])) : [];
  const teams = Array.isArray(pr.requested_teams) ? pr.requested_teams.flatMap((t) => (isRecord(t) && str(t.slug) ? [{ id: `team:${str(t.slug)}`, name: str(t.name), email: null }] : [])) : [];
  const latest = new Map<string, { person: NonNullable<ReturnType<typeof ghPerson>>; state: ReviewerState }>();
  if (lists.reviews) {
    const reviews: Review[] = [];
    for (const r of lists.reviews) {
      if (!isRecord(r)) continue;
      const by = ghPerson(r.user);
      const kind = REVIEW_STATES[String(r.state)];
      const when = at(change, 'reviews', r.submitted_at, 'a review\'s submitted_at');
      if (!by || !kind || !when) continue;
      reviews.push({ by, state: kind, at: when });
    }
    reviewTimes(change, reviews);
    // Where each reviewer stands: their last approval or request for changes; a comment leaves it as it was.
    for (const r of change.reviews!) {
      if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') latest.set(r.by.id, { person: r.by, state: r.state });
      else if (r.state === 'DISMISSED') latest.set(r.by.id, { person: r.by, state: 'PENDING' });
      else if (!latest.has(r.by.id) && r.by.id !== change.author?.id) latest.set(r.by.id, { person: r.by, state: 'PENDING' });
    }
  } else {
    gap(change, 'reviews', notIncluded(doc, 'reviews'));
    gap(change, 'firstReviewAt', notIncluded(doc, 'reviews'));
    gap(change, 'approvedAt', notIncluded(doc, 'reviews'));
  }
  // Re-requesting a review puts the reviewer back in requested_reviewers: pending again, whatever they said before.
  for (const p of [...requested, ...teams]) latest.set(p.id, { person: p, state: 'PENDING' });
  change.reviewers = [...latest.values()].filter((r) => r.person.id !== change.author?.id);

  if (lists.checks) {
    rollUp(change, lists.checks.filter(isRecord).map((run): CheckRun => ({
      name: str(run.name) ?? 'check',
      outcome: run.status !== 'completed' ? 'pending' : FAILING.has(String(run.conclusion)) ? 'fail' : 'pass',
      at: at(change, 'checksAt', run.completed_at ?? run.started_at, "a check run's completed_at"),
    })));
  } else gap(change, 'checks', notIncluded(doc, 'checks'));

  if (typeof pr.mergeable === 'boolean') change.mergeable = pr.mergeable;
  else if (change.state === 'OPEN' || change.state === 'DRAFT') gap(change, 'mergeable', doc.command.endsWith(' pr list') ? `${doc.command} doesn't say whether a pull request merges cleanly: map ${doc.area} pr get` : 'GitHub had not worked out mergeability yet (mergeable was null); read it again in a moment');

  const files = lists.files?.filter(isRecord);
  const additions = num(pr.additions) ?? (files ? files.reduce((n, f) => n + (num(f.additions) ?? 0), 0) : null);
  const deletions = num(pr.deletions) ?? (files ? files.reduce((n, f) => n + (num(f.deletions) ?? 0), 0) : null);
  const count = num(pr.changed_files) ?? (files ? files.length : null);
  if (additions !== null || deletions !== null || count !== null) change.size = { files: count, additions, deletions };
  else gap(change, 'size', `${doc.command} doesn't say how big a pull request is: map ${doc.area} pr get`);

  setAuthorKind(change, state, { account: account(pr.user), messages: lists.commits ? messagesOf(lists.commits) : null });
  return change;
}
