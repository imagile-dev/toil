#!/usr/bin/env node
// Watches one PR and exits when something needs the agent: a review, an inline
// comment, a human's comment, a failing check, a merge conflict, the PR being
// ready to merge, or the PR closing. Used by the ship skill, which runs it in
// the background and acts on what it prints.
//
//   node scripts/pr-watch.mjs <pr> [--interval 240] [--max-hours 8] [--once]
//
// It compares each poll with the state when it started, so restart it after
// every push. --once prints the current state, including whether it's ready, and
// exits. Prints one JSON object.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const pr = Number(args[0]);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
if (!Number.isInteger(pr) || pr <= 0) {
  console.error('usage: node scripts/pr-watch.mjs <pr> [--interval 240] [--max-hours 8] [--once]');
  process.exit(2);
}
const intervalMs = opt('interval', 240) * 1000;
const deadline = Date.now() + opt('max-hours', 8) * 3600_000;

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const [owner, name] = gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner').trim().split('/');
const me = gh('api', 'user', '--jq', '.login').trim();


const QUERY = `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){
  state headRefOid mergeable reviewDecision
  reviews(last:30){nodes{databaseId state body author{login} commit{oid}}}
  reviewThreads(first:100){nodes{isResolved path comments(last:1){nodes{databaseId body author{login}}}}}
  comments(last:30){nodes{databaseId body author{__typename login}}}
  commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{
    ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}
}}}`;

function snapshot() {
  const out = gh('api', 'graphql', '-f', `query=${QUERY}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `p=${pr}`);
  const p = JSON.parse(out).data.repository.pullRequest;
  const rollup = p.commits.nodes[0]?.commit.statusCheckRollup;
  const checks = (rollup?.contexts.nodes ?? []).map((c) => ({
    name: c.name ?? c.context,
    done: c.status ? c.status === 'COMPLETED' : c.state !== 'PENDING',
    failed: ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(c.conclusion ?? c.state),
  }));
  const unresolved = p.reviewThreads.nodes.filter((t) => !t.isResolved);
  return {
    state: p.state,
    head: p.headRefOid,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision,
    reviews: p.reviews.nodes,
    threads: unresolved.map((t) => ({ path: t.path, last: t.comments.nodes[0] })),
    // Only people's comments. Bots' feedback arrives as formal reviews, and the
    // review bot's progress comment is edited in place while it works.
    comments: p.comments.nodes.filter((c) => c.author?.login !== me && c.author?.__typename !== 'Bot'),
    rollup: rollup?.state ?? 'NONE',
    checks,
  };
}

const short = (s) => (s ?? '').replace(/\s+/g, ' ').slice(0, 160);

function events(base, now) {
  const seen = (list, id) => list.some((x) => x.databaseId === id);
  const found = [];
  if (now.state !== 'OPEN') found.push({ kind: now.state.toLowerCase() });
  for (const r of now.reviews) {
    if (!seen(base.reviews, r.databaseId) && (r.body || r.state !== 'COMMENTED')) {
      found.push({ kind: 'review', id: r.databaseId, state: r.state, author: r.author?.login, commit: r.commit?.oid.slice(0, 7), summary: short(r.body) });
    }
  }
  for (const t of now.threads) {
    const c = t.last;
    if (c && c.author?.login !== me && !base.threads.some((b) => b.last?.databaseId === c.databaseId)) {
      found.push({ kind: 'inline-comment', id: c.databaseId, path: t.path, author: c.author?.login, summary: short(c.body) });
    }
  }
  for (const c of now.comments) {
    if (!seen(base.comments, c.databaseId)) found.push({ kind: 'comment', id: c.databaseId, author: c.author?.login, summary: short(c.body) });
  }
  const failing = now.checks.filter((c) => c.failed).map((c) => c.name);
  const failedBefore = base.checks.filter((c) => c.failed).map((c) => c.name);
  if (failing.some((n) => !failedBefore.includes(n))) found.push({ kind: 'checks-failed', failing });
  if (now.mergeable === 'CONFLICTING' && base.mergeable !== 'CONFLICTING') found.push({ kind: 'conflict' });
  const reviewedHead = now.reviews.some((r) => r.state === 'APPROVED' && r.commit?.oid === now.head);
  const ready = now.reviewDecision === 'APPROVED' && reviewedHead && now.rollup === 'SUCCESS' && now.threads.length === 0 && now.mergeable === 'MERGEABLE';
  if (ready && found.length === 0) found.push({ kind: 'ready' });
  return found;
}

function report(now, found) {
  console.log(JSON.stringify({
    pr, head: now.head.slice(0, 7), state: now.state, mergeable: now.mergeable, reviewDecision: now.reviewDecision,
    rollup: now.rollup, pendingChecks: now.checks.filter((c) => !c.done).map((c) => c.name),
    unresolvedThreads: now.threads.length, events: found,
  }, null, 2));
}

const base = snapshot();
if (args.includes('--once')) {
  report(base, events(base, base));
  process.exit(0);
}
for (;;) {
  await new Promise((r) => setTimeout(r, intervalMs));
  let now;
  try {
    now = snapshot();
  } catch (err) {
    // A transient gh or network failure: try again next interval.
    console.error(`poll failed: ${err.message.split('\n')[0]}`);
    continue;
  }
  const found = events(base, now);
  if (found.length) { report(now, found); process.exit(0); }
  if (Date.now() > deadline) { report(now, [{ kind: 'timeout' }]); process.exit(0); }
}
