// The daily triage cap for .github/workflows/triage.yml: at most CAP issues
// filed from outside are triaged per UTC day, and the rest wait in a queue the
// daily scheduled run drains, oldest first. A manual re-triage (workflow_dispatch)
// never comes through here, so it isn't counted.
//
// The count is race-free without a global lock: a run claims its issue by
// adding the `triage-claimed` label, then reads the repository's label events
// and ranks today's claims by event id. The first CAP distinct issues claimed
// today run; any other claimant gives its claim back and takes `triage-queued`.
// Two runs that claim at once agree on the order, because GitHub numbered the
// events for them. It is the one queue in the building where nobody can
// argue about who was there first.
//
//   node scripts/triage/cap.mjs claim <issue>   writes run=true|false to $GITHUB_OUTPUT
//   node scripts/triage/cap.mjs queue            writes issues=[…] (JSON) for the matrix
//
// Env: GH_TOKEN (issues: write), GITHUB_REPOSITORY, TRIAGE_CAP (default 4).

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CLAIMED = 'triage-claimed';
export const QUEUED = 'triage-queued';
export const TRIAGED = 'triaged';
export const DENIED = 'denied';
export const FAILED = 'triage-failed';
export const NEEDS_HUMAN = 'needs-human';
export const SOURCES = ['from-website', 'from-terminal'];

/** The UTC day of a timestamp, yyyy-mm-dd. */
export const utcDay = (iso) => new Date(iso).toISOString().slice(0, 10);

/**
 * The 1-based place of `issue` among the distinct issues first claimed on `day`,
 * ordered by event id; 0 when it has no claim that day.
 */
export function claimRank(events, issue, day) {
  const first = new Map();
  for (const event of events) {
    if (event.event !== 'labeled' || event.label?.name !== CLAIMED || utcDay(event.created_at) !== day) continue;
    const number = event.issue?.number;
    if (typeof number !== 'number') continue;
    if (!first.has(number) || event.id < first.get(number)) first.set(number, event.id);
  }
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([number]) => number);
  return order.indexOf(issue) + 1;
}

/** Open issues from outside still waiting at the daily run: queued, never picked up, or claimed by a run that died. */
export function waiting(issues) {
  return issues
    .filter((issue) => !issue.pull_request && issue.state === 'open')
    .filter((issue) => {
      const labels = new Set(issue.labels.map((l) => (typeof l === 'string' ? l : l.name)));
      // needs-human: triage failed on it twice, or held something secret-shaped; a person decides now.
      if (labels.has(TRIAGED) || labels.has(DENIED) || labels.has(NEEDS_HUMAN)) return false;
      // A claim still open at the daily run is from a run that died; it's picked up again.
      return labels.has(QUEUED) || labels.has(CLAIMED) || SOURCES.some((s) => labels.has(s));
    })
    .sort((a, b) => a.number - b.number);
}

// ---------------------------------------------------------------------------
// GitHub, with retries for the failures that go away on their own.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function gh(method, path, body, { fetcher = fetch, token = process.env.GH_TOKEN, attempts = 4, pause = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'toil-triage',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (attempt >= attempts) throw new Error(`GitHub ${method} ${path} failed after ${attempts} attempts: ${error.message}`, { cause: error });
      await sleep(pause * attempt);
      continue;
    }
    if ((response.status >= 500 || response.status === 429) && attempt < attempts) {
      await sleep(pause * attempt);
      continue;
    }
    if (response.status === 404 && method === 'DELETE') return undefined;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.status === 204 ? undefined : response.json();
  }
}

/** Today's label events, newest first, read until they're older than today. */
async function todaysEvents(repo, day, options) {
  const events = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh('GET', `/repos/${repo}/issues/events?per_page=100&page=${page}`, undefined, options);
    events.push(...batch);
    if (batch.length < 100 || batch.some((e) => utcDay(e.created_at) < day)) break;
  }
  return events;
}

/** Claims `issue` for today; true when it's within the cap, false when it was queued instead. */
export async function claim(repo, issue, cap, options = {}) {
  const current = await gh('GET', `/repos/${repo}/issues/${issue}`, undefined, options);
  const labels = new Set(current.labels.map((l) => l.name));
  if (current.state !== 'open' || labels.has(TRIAGED) || labels.has(DENIED)) return { run: false, reason: 'already triaged or closed' };
  if (labels.has(NEEDS_HUMAN)) return { run: false, reason: 'labelled needs-human; a maintainer re-triages it by hand' };
  // A claim left from an earlier day (a run that failed) is renewed, so today has an event for it.
  if (labels.has(CLAIMED)) await gh('DELETE', `/repos/${repo}/issues/${issue}/labels/${CLAIMED}`, undefined, options);
  await gh('POST', `/repos/${repo}/issues/${issue}/labels`, { labels: [CLAIMED] }, options);
  const day = utcDay((options.now ?? new Date()).toISOString());
  const rank = claimRank(await todaysEvents(repo, day, options), issue, day);
  if (rank >= 1 && rank <= cap) {
    if (labels.has(QUEUED)) await gh('DELETE', `/repos/${repo}/issues/${issue}/labels/${QUEUED}`, undefined, options);
    return { run: true, reason: `claim ${rank} of ${cap} today` };
  }
  await gh('DELETE', `/repos/${repo}/issues/${issue}/labels/${CLAIMED}`, undefined, options);
  await gh('POST', `/repos/${repo}/issues/${issue}/labels`, { labels: [QUEUED] }, options);
  return { run: false, reason: `today's ${cap} triage runs are taken (this was claim ${rank || 'unranked'}); queued` };
}

/** Claims waiting issues oldest first until the cap is reached; returns the ones to triage now. */
export async function drain(repo, cap, options = {}) {
  const open = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh('GET', `/repos/${repo}/issues?state=open&per_page=100&page=${page}&sort=created&direction=asc`, undefined, options);
    open.push(...batch);
    if (batch.length < 100) break;
  }
  const run = [];
  for (const issue of waiting(open)) {
    const claimed = await claim(repo, issue.number, cap, options);
    if (!claimed.run) break;
    run.push(issue.number);
  }
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const cap = Number(process.env.TRIAGE_CAP ?? '4');
  const [command, arg] = process.argv.slice(2);
  const output = (line) => (process.env.GITHUB_OUTPUT ? appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`) : console.log(line));
  if (!repo || !Number.isInteger(cap) || cap < 0) {
    console.error('cap.mjs: set GITHUB_REPOSITORY, and TRIAGE_CAP to a whole number.');
    process.exit(1);
  }
  if (command === 'claim' && /^[1-9]\d*$/.test(arg ?? '')) {
    const result = await claim(repo, Number(arg), cap);
    console.log(`#${arg}: ${result.reason}`);
    output(`run=${result.run}`);
  } else if (command === 'queue') {
    const issues = await drain(repo, cap);
    console.log(issues.length ? `Triaging from the queue: ${issues.map((n) => `#${n}`).join(', ')}` : 'Nothing to triage from the queue today.');
    output(`issues=${JSON.stringify(issues)}`);
  } else {
    console.error('Usage: cap.mjs claim <issue> | cap.mjs queue');
    process.exit(1);
  }
}
