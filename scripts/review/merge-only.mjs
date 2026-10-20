#!/usr/bin/env node
// Re-approves a PR push that only merges the base branch into a commit the
// Imagile Bot already approved, so a "Merge origin/main" push costs seconds
// instead of a full agent review. claude-review.yml runs it before the agent
// step, from the base branch's copy of this file, never the PR's: the check
// that lets code skip review is not code the PR under check can change.
//
//   node scripts/review/merge-only.mjs [--dry-run]
//
// Env: GH_TOKEN, REPO (owner/name), PR_NUMBER, HEAD_SHA, BOT_LOGIN, and
// optionally GITHUB_API_URL, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY and the run
// variables that link the approval to its run. --dry-run checks everything and
// prints the decision without approving.
//
// It approves only when every one of these holds; anything else, an error
// included, means the agent reviews the push in full:
//   1. The bot's last formal review on the PR approved a commit A, and that
//      approval stands or was dismissed only as stale by a push (no message,
//      as GitHub dismisses on push). A person's or a later review's dismissal
//      doesn't count.
//   2. No review thread on the PR is open.
//   3. Every commit on the first-parent chain from the head back to A is a
//      two-parent merge whose second parent is on the base branch.
//   4. The PR's own diff, `git diff <merge-base(base, X)> X`, is the same for A
//      and the head. Hunk positions (the `@@` line numbers) and the blob ids of
//      a text file's whole pre- and post-image are ignored, because a merge of
//      main moves those whenever main changed the same file elsewhere. What each
//      hunk changes, its context and its whitespace are compared byte for byte,
//      and a binary file's section is compared whole.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const MAX_MERGES = 50;

/** A git runner bound to one repository. Throws with git's own message on failure. */
export function gitIn(cwd) {
  return (args, { allowFail = false } = {}) => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (run.error) throw new Error(`git ${args[0]} failed: ${run.error.message}`);
    if (run.status !== 0) {
      if (allowFail) return null;
      throw new Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
    }
    return run.stdout;
  };
}

const isAncestor = (git, a, b) => git(['merge-base', '--is-ancestor', a, b], { allowFail: true }) !== null;

/**
 * Check 3: every commit from `head` back to `approved`, along first parents, is
 * a merge whose other parent is on `base`.
 */
export function mergesOfBaseOnly(git, approved, head, base) {
  if (approved === head) return { ok: false, reason: `the head ${head} is the approved commit; there is nothing new to re-approve` };
  if (git(['cat-file', '-e', `${approved}^{commit}`], { allowFail: true }) === null) {
    return { ok: false, reason: `the approved commit ${approved} is not in this checkout (was the branch force-pushed?)` };
  }
  let commit = head;
  for (let i = 0; i < MAX_MERGES; i++) {
    const [, ...parents] = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ');
    if (parents.length !== 2) {
      return { ok: false, reason: `${commit} is not a merge (${parents.length} parent${parents.length === 1 ? '' : 's'})` };
    }
    if (!isAncestor(git, parents[1], base)) return { ok: false, reason: `${commit} merges ${parents[1]}, which is not on ${base}` };
    commit = parents[0];
    if (commit === approved) return { ok: true, merges: i + 1 };
  }
  return { ok: false, reason: `the approved commit ${approved} is not within ${MAX_MERGES} first-parent merges of the head` };
}

/**
 * The PR's own change as of `commit`: its diff from the merge base with `base`,
 * with only hunk positions and text blob ids blanked (see check 4 above).
 */
export function prPatch(git, base, commit) {
  const mergeBase = git(['merge-base', base, commit]).trim();
  const diff = git(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
    '--no-renames', '--binary', '--full-index', mergeBase, commit]);
  return diff
    .split(/(?=^diff --git )/m)
    .map((file) => (/^GIT binary patch$/m.test(file)
      ? file
      : file.replace(/^index [0-9a-f]+\.\.[0-9a-f]+/m, 'index').replace(/^@@ [^\n]*$/gm, '@@')))
    .join('');
}

const digest = (text) => createHash('sha256').update(text).digest('hex');

/** Check 4: the PR's own diff is the same at `approved` and at `head`. */
export function samePrChange(git, approved, head, base) {
  const before = prPatch(git, base, approved);
  const after = prPatch(git, base, head);
  if (before === after) return { ok: true, digest: digest(after) };
  return { ok: false, reason: `the PR's own diff changed (${digest(before).slice(0, 12)} at ${approved}, ${digest(after).slice(0, 12)} at ${head})` };
}

/**
 * Check 1: the commit the bot's last formal review approved, if that approval
 * stands or was dismissed only as stale by a push. `reviews` and `timeline` are
 * the REST API's lists for the PR.
 */
export function standingApproval(reviews, timeline, bot) {
  const formal = reviews
    .filter((r) => r.user?.login === bot && r.state !== 'COMMENTED' && r.state !== 'PENDING')
    .sort((a, b) => a.id - b.id);
  const last = formal.at(-1);
  if (!last) return { ok: false, reason: `${bot} has no formal review on this PR` };
  const sha = last.commit_id;
  if (!SHA.test(sha ?? '')) return { ok: false, reason: `${bot}'s last review has no commit id` };
  if (last.state === 'APPROVED') return { ok: true, sha, review: last.id };
  if (last.state !== 'DISMISSED') return { ok: false, reason: `${bot}'s last review, at ${sha}, is ${last.state}` };
  const dismissal = timeline.find((e) => e.event === 'review_dismissed' && e.dismissed_review?.review_id === last.id)?.dismissed_review;
  if (!dismissal) return { ok: false, reason: `${bot}'s last review, at ${sha}, was dismissed and no dismissal event explains it` };
  if (dismissal.state !== 'approved') return { ok: false, reason: `${bot}'s last review, at ${sha}, was ${dismissal.state}, not an approval` };
  if (dismissal.dismissal_message || !dismissal.dismissal_commit_id) {
    return { ok: false, reason: `${bot}'s approval of ${sha} was dismissed by a person or a later review, not as stale by a push` };
  }
  return { ok: true, sha, review: last.id };
}

/** A small GitHub REST and GraphQL client over fetch. */
export function github({ token, api = 'https://api.github.com', fetcher = fetch }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const call = async (method, url, body) => {
    const res = await fetcher(url.startsWith('http') ? url : `${api}${url}`, {
      method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  };
  return {
    get: async (path) => (await call('GET', path)).json(),
    post: async (path, body) => (await call('POST', path, body)).json(),
    /** Every page of a list endpoint, following the Link header. */
    async list(path) {
      const all = [];
      let url = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
      for (let page = 0; url && page < 50; page++) {
        const res = await call('GET', url);
        all.push(...(await res.json()));
        url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
      }
      return all;
    },
    async graphql(query, variables) {
      const data = await (await call('POST', '/graphql', { query, variables })).json();
      if (data.errors?.length) throw new Error(`GitHub GraphQL: ${data.errors.map((e) => e.message).join('; ')}`);
      return data.data;
    },
  };
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { isResolved } } } } }`;

/** Check 2: how many review threads on the PR are unresolved. */
export async function openThreads(gh, repo, number) {
  const [owner, name] = repo.split('/');
  let open = 0;
  let after = null;
  for (let page = 0; page < 20; page++) {
    const threads = (await gh.graphql(THREADS, { owner, name, number, after })).repository.pullRequest.reviewThreads;
    open += threads.nodes.filter((t) => !t.isResolved).length;
    if (!threads.pageInfo.hasNextPage) return open;
    after = threads.pageInfo.endCursor;
  }
  throw new Error('more than 2,000 review threads');
}

export const approvalBody = (approved, base, runUrl) =>
  `Merge of ${base} only; the PR's own changes are identical to the approved ${approved}.` +
  (runUrl ? `\n\nChecked without an agent review by the merge-only step of claude-review.yml: ${runUrl}` : '');

/**
 * The whole decision. Returns { approved, checks, reason }; approves the head
 * unless `dryRun`. Never throws for a failed check, only for a broken input.
 */
export async function run({ env, gh, git, dryRun = false }) {
  const repo = env.REPO ?? '';
  const number = Number(env.PR_NUMBER);
  const head = env.HEAD_SHA ?? '';
  const bot = env.BOT_LOGIN ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`REPO must be owner/name, got "${repo}"`);
  if (!Number.isInteger(number) || number < 1) throw new Error(`PR_NUMBER must be a PR number, got "${env.PR_NUMBER}"`);
  if (!SHA.test(head)) throw new Error(`HEAD_SHA must be a full commit sha, got "${head}"`);
  if (!bot) throw new Error('BOT_LOGIN is empty');

  const checks = [];
  const result = (approved, reason) => ({ approved, reason, checks });
  const check = (name, outcome) => {
    checks.push({ name, ok: outcome.ok, detail: outcome.ok ? outcome.detail : outcome.reason });
    return outcome.ok;
  };

  const pr = await gh.get(`/repos/${repo}/pulls/${number}`);
  const baseRef = pr.base?.ref ?? '';
  if (!check('head unchanged', pr.head?.sha === head ? { ok: true, detail: head } : { ok: false, reason: `the PR's head moved to ${pr.head?.sha}` })) return result(false, checks.at(-1).detail);
  if (!/^[\w./-]+$/.test(baseRef) || baseRef.includes('..')) throw new Error(`unexpected base branch name "${baseRef}"`);
  const base = `origin/${baseRef}`;

  const [reviews, timeline] = await Promise.all([
    gh.list(`/repos/${repo}/pulls/${number}/reviews`),
    gh.list(`/repos/${repo}/issues/${number}/timeline`),
  ]);
  const approval = standingApproval(reviews, timeline, bot);
  if (!check('standing approval', { ...approval, detail: `review ${approval.review} approved ${approval.sha}` })) return result(false, approval.reason);
  const approved = approval.sha;

  const open = await openThreads(gh, repo, number);
  if (!check('no open threads', open === 0 ? { ok: true, detail: '0 open' } : { ok: false, reason: `${open} review thread${open === 1 ? ' is' : 's are'} open` })) return result(false, checks.at(-1).detail);

  const chain = mergesOfBaseOnly(git, approved, head, base);
  if (!check(`only merges of ${baseRef}`, { ...chain, detail: `${chain.merges} merge${chain.merges === 1 ? '' : 's'} of ${baseRef} after ${approved}` })) return result(false, chain.reason);

  const same = samePrChange(git, approved, head, base);
  if (!check('same PR diff', { ...same, detail: `sha256 ${same.digest}` })) return result(false, same.reason);

  if (!dryRun) {
    const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';
    await gh.post(`/repos/${repo}/pulls/${number}/reviews`, { commit_id: head, event: 'APPROVE', body: approvalBody(approved, baseRef, runUrl) });
  }
  return result(true, `merge of ${baseRef} only; same PR diff as the approved ${approved}`);
}

/** The job summary: every check that ran, and the outcome. */
export function summary(outcome) {
  const rows = outcome.checks.map((c) => `| ${c.ok ? 'pass' : 'fail'} | ${c.name} | ${c.detail.replace(/\|/g, '\\|')} |`);
  return [
    '### Merge-only check',
    '',
    outcome.approved ? `Re-approved without an agent review: ${outcome.reason}.` : `Full review needed: ${outcome.reason}.`,
    '',
    '| Result | Check | Detail |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const env = process.env;
  const dryRun = process.argv.includes('--dry-run');
  let outcome;
  try {
    const gh = github({ token: env.GH_TOKEN ?? '', api: env.GITHUB_API_URL || undefined });
    outcome = await run({ env, gh, git: gitIn(process.cwd()), dryRun });
  } catch (error) {
    // Failing safe: the agent reviews the push in full. Said loudly, not hidden.
    console.log(`::warning::The merge-only check could not run, so the agent reviews this push in full: ${error.message}`);
    outcome = { approved: false, reason: `the check could not run (${error.message})`, checks: [] };
  }
  const text = summary(outcome);
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `approved=${outcome.approved && !dryRun}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
