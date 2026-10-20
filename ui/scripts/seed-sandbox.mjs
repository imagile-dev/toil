// Seeds a GitHub repository with a small, made-up body of work for trying Toil UI
// on real data: labels for type, priority, points and blocked; three milestones
// used as sprints; about 25 issues, some closed, some assigned, some blocked by
// others; a CI workflow that echoes, with one branch that fails on purpose; and
// four pull requests (merged, open, draft, failing) that close issues.
//
//   node ui/scripts/seed-sandbox.mjs                       # imagile-dev/toil-sandbox
//   node ui/scripts/seed-sandbox.mjs --owner you --repo toil-sandbox
//
// It writes through the GitHub CLI's own login (gh), never through toil, which
// stays read-only. It is safe to run again: labels, milestones, issues, branches
// and pull requests are found by name or title and left alone when they exist.
// The repository must exist already (gh repo create <owner>/<repo> --private
// --add-readme). Repo tooling only: nothing here ships. The sprint was planned
// in full, retroactively, by the script that made it.
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const owner = take('--owner', 'imagile-dev');
const repo = take('--repo', 'toil-sandbox');
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --owner <owner> and --repo <repo>, or neither for imagile-dev/toil-sandbox.');
const R = `repos/${owner}/${repo}`;

function fail(message, fix) {
  process.stderr.write(`seed-sandbox: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}

/** One `gh api` call, the body on stdin, never through a shell. */
function gh(method, path, body, { paginate = false, allow404 = false } = {}) {
  const argv = ['api', '-X', method, path, ...(paginate ? ['--paginate', '--slurp'] : []), ...(body ? ['--input', '-'] : [])];
  const res = spawnSync('gh', argv, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) fail(`couldn't run gh: ${res.error.message}`, 'Install the GitHub CLI and sign in with gh auth login.');
  if (res.status !== 0) {
    if (allow404 && /HTTP 404/.test(res.stderr)) return null;
    fail(`gh api ${method} ${path} failed: ${res.stderr.trim() || res.stdout.trim()}`, 'Check that the repository exists and that gh auth status shows the repo and workflow scopes.');
  }
  const out = res.stdout.trim();
  if (!out) return null;
  const parsed = JSON.parse(out);
  return paginate ? parsed.flat() : parsed;
}

const say = (line) => process.stdout.write(`${line}\n`);
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().replace(/\.\d+Z$/, 'Z');

// The repository and who runs this ---------------------------------------------------
const repoInfo = gh('GET', R, null, { allow404: true });
if (!repoInfo) fail(`${owner}/${repo} doesn't exist, or gh can't see it.`, `Create it first: gh repo create ${owner}/${repo} --private --add-readme`);
const me = gh('GET', 'user').login;
const main = repoInfo.default_branch;
say(`Seeding ${owner}/${repo} (${repoInfo.private ? 'private' : 'public'}) as ${me}, default branch ${main}.`);

// Labels ---------------------------------------------------------------------------
const LABELS = [
  ['type: bug', 'd73a4a', 'Something is broken'],
  ['type: feature', 'a2eeef', 'New behavior'],
  ['type: chore', 'cfd3d7', 'Upkeep with no change in behavior'],
  ['priority: high', 'b60205', 'Do this first'],
  ['priority: medium', 'fbca04', 'Do this soon'],
  ['priority: low', '0e8a16', 'Do this when there is room'],
  ['points: 1', 'c5def5', 'Estimate'],
  ['points: 2', 'c5def5', 'Estimate'],
  ['points: 3', 'c5def5', 'Estimate'],
  ['points: 5', 'c5def5', 'Estimate'],
  ['points: 8', 'c5def5', 'Estimate'],
  ['blocked', '000000', 'Waiting on another issue'],
];
const haveLabels = new Set(gh('GET', `${R}/labels?per_page=100`, null, { paginate: true }).map((l) => l.name));
for (const [name, color, description] of LABELS) {
  if (haveLabels.has(name)) continue;
  gh('POST', `${R}/labels`, { name, color, description });
  say(`label ${name}: created`);
}

// Milestones as sprints --------------------------------------------------------------
const SPRINTS = [
  { title: 'Sprint 41', state: 'closed', due: -7, description: 'Two weeks ending last week.' },
  { title: 'Sprint 42', state: 'open', due: 7, description: 'The current sprint: two weeks ending next week.' },
  { title: 'Sprint 43', state: 'open', due: 21, description: 'The next sprint.' },
];
const milestones = new Map(gh('GET', `${R}/milestones?state=all&per_page=100`, null, { paginate: true }).map((m) => [m.title, m]));
for (const s of SPRINTS) {
  if (milestones.has(s.title)) continue;
  const m = gh('POST', `${R}/milestones`, { title: s.title, state: s.state, description: s.description, due_on: iso(s.due) });
  milestones.set(s.title, m);
  say(`milestone ${s.title}: created`);
}

// Issues ---------------------------------------------------------------------------
// `key` names an issue for the blocked-by references; `blockedBy` lists keys.
// `stale` issues say so in their text, since GitHub won't take a backdated issue.
const STALE = '\n\nStale on purpose: this is test data, and GitHub can\'t backdate an issue, so read it as one nobody has touched in weeks.';
const ISSUES = [
  // Sprint 41, closed, mostly done
  { key: 'webhook-sig', title: 'Verify webhook signatures from the card processor', sprint: 'Sprint 41', type: 'feature', priority: 'high', points: 5, assign: true, closed: true, body: 'Reject any processor webhook whose HMAC signature does not match the shared secret, and log the rejection with the event id.' },
  { key: 'currency-round', title: 'Refund totals round half-cent amounts down in JPY and KRW', sprint: 'Sprint 41', type: 'bug', priority: 'high', points: 3, assign: true, closed: true, body: 'Zero-decimal currencies should never carry a fractional minor unit. Refund totals for JPY and KRW are off by one unit on about 0.3% of refunds.' },
  { key: 'ledger-index', title: 'Add an index on ledger_entries(account_id, posted_at)', sprint: 'Sprint 41', type: 'chore', priority: 'medium', points: 2, closed: true, body: 'The statement export scans the whole table. An index on account and posting time should take it from minutes to seconds.' },
  { key: 'dash-tz', title: 'Settlement dashboard shows yesterday\'s batch in UTC instead of the merchant\'s time zone', sprint: 'Sprint 41', type: 'bug', priority: 'medium', points: 2, assign: true, closed: true, body: 'Merchants in UTC-8 see the batch that closed at 4pm local time listed under tomorrow.' },
  { key: 'retry-backoff', title: 'Exponential backoff for failed payout retries', sprint: 'Sprint 41', type: 'feature', priority: 'medium', points: 3, assign: true, body: 'Payout retries currently fire every 60 seconds. Back off exponentially up to an hour, with jitter, and stop after 8 attempts. Carried over from Sprint 41.' },
  { key: 'old-sdk', title: 'Remove the v1 checkout SDK endpoints', sprint: 'Sprint 41', type: 'chore', priority: 'low', points: 1, closed: true, body: 'No merchant has called the v1 endpoints in 90 days.' },

  // Sprint 42, the current sprint
  { key: 'tokenize', title: 'Tokenise stored cards at the edge so the core service never sees a PAN', sprint: 'Sprint 42', type: 'feature', priority: 'high', points: 8, assign: true, body: 'Card numbers are replaced by a token at the edge proxy. The core payments service stores and forwards only tokens.' },
  { key: 'vault-keys', title: 'Rotate the card vault encryption keys without downtime', sprint: 'Sprint 42', type: 'feature', priority: 'high', points: 5, assign: true, blockedBy: ['tokenize'], body: 'Re-encrypt vault entries under a new key in the background while both keys decrypt.' },
  { key: 'refund-runbook', title: 'Write the runbook for manual refunds when the processor is down', sprint: 'Sprint 42', type: 'chore', priority: 'medium', points: 2, assign: true, body: 'Support needs a step-by-step for issuing refunds by hand during a processor outage, and for reconciling them afterwards.' },
  { key: 'chargeback-faq', title: 'Chargeback FAQ for the merchant help centre', sprint: 'Sprint 42', type: 'chore', priority: 'low', points: 1, body: 'Answer the ten questions merchants ask most about chargebacks: timelines, evidence and fees.' },
  { key: 'dup-capture', title: 'Duplicate capture when the client retries a timed-out request', sprint: 'Sprint 42', type: 'bug', priority: 'high', points: 3, assign: true, body: 'A capture that times out at the client and is retried with the same idempotency key is captured twice about once a day.' },
  { key: 'idem-store', title: 'Keep idempotency keys for 24 hours in a shared store instead of per instance', sprint: 'Sprint 42', type: 'feature', priority: 'high', points: 5, blockedBy: ['dup-capture'], body: 'Idempotency keys live in each instance\'s memory, so a retry that lands on another instance is not recognised.' },
  { key: 'statement-csv', title: 'Monthly statement CSV is missing the fee column for partial refunds', sprint: 'Sprint 42', type: 'bug', priority: 'medium', points: 2, closed: true, body: 'Partial refunds leave the fee column empty in the monthly CSV.' },
  { key: 'glossary', title: 'Settlement glossary for new engineers', sprint: 'Sprint 42', type: 'chore', priority: 'low', points: 1, assign: true, body: 'Define settlement, clearing, interchange, payout and reserve in one page.' },
  { key: 'long-title', title: 'When a merchant changes their payout schedule from daily to weekly in the middle of a settlement cycle, the pending balance is split across two payouts and the second one is labelled with the wrong period on the statement', sprint: 'Sprint 42', type: 'bug', priority: 'medium', assign: true, body: 'Not estimated yet: needs a look at how the payout scheduler closes a period early.' },
  { key: 'sca-exempt', title: 'Apply low-value SCA exemptions for EU card payments under 30 EUR', sprint: 'Sprint 42', type: 'feature', priority: 'medium', points: 3, body: 'Request the low-value exemption on eligible transactions so customers aren\'t challenged for small amounts.' },

  // Sprint 43, next
  { key: 'payout-preview', title: 'Payout preview: show merchants what the next payout will contain', sprint: 'Sprint 43', type: 'feature', priority: 'medium', points: 5, body: 'A read-only view of the pending balance, holds and the expected payout date.' },
  { key: 'reserve', title: 'Rolling reserve for high-risk merchants', sprint: 'Sprint 43', type: 'feature', priority: 'medium', points: 8, blockedBy: ['payout-preview'], body: 'Hold back a configurable percentage of each payout for 90 days for merchants flagged high risk.' },
  { key: 'fx-cache', title: 'Cache FX rates for five minutes instead of fetching per transaction', sprint: 'Sprint 43', type: 'chore', priority: 'low', points: 2, body: 'The rates provider is called once per cross-currency transaction.' },
  { key: 'dispute-webhook', title: 'Send merchants a webhook when a dispute is opened', sprint: 'Sprint 43', type: 'feature', priority: 'high', points: 3, blockedBy: ['webhook-sig'], body: 'Merchants learn about disputes from the dashboard today. A webhook lets them respond before the evidence deadline.' },
  { key: 'refund-reason', title: 'Refund reason codes', sprint: 'Sprint 43', type: 'feature', priority: 'low', body: 'Not estimated yet: product hasn\'t settled the list of codes.' },
  { key: 'flaky-recon', title: 'Nightly reconciliation job fails about once a week with a lock timeout', sprint: 'Sprint 43', type: 'bug', priority: 'medium', points: 3, assign: true, body: 'The job and the statement export both lock ledger_entries around 02:00 UTC.' },

  // Backlog, no sprint
  { key: 'apple-pay', title: 'Support Apple Pay on the hosted checkout page', type: 'feature', priority: 'medium', stale: true, body: 'Merchants have asked for this. Not estimated: needs a spike on domain verification.' },
  { key: 'ach-returns', title: 'Handle ACH return codes R01 to R10 automatically', type: 'feature', priority: 'low', points: 5, stale: true, body: 'Each return code should map to a merchant notification and, where it applies, a retry.' },
  { key: 'log-pii', title: 'Card expiry dates appear in debug logs', type: 'bug', priority: 'high', points: 1, stale: true, body: 'The request logger prints the whole payment method object at debug level, including the expiry date.' },
];

const existing = new Map(
  gh('GET', `${R}/issues?state=all&per_page=100`, null, { paginate: true })
    .filter((i) => !i.pull_request)
    .map((i) => [i.title, i]),
);
const numbers = new Map();
const labelsFor = (i) => [`type: ${i.type}`, `priority: ${i.priority}`, ...(i.points ? [`points: ${i.points}`] : []), ...(i.blockedBy ? ['blocked'] : [])];

for (const i of ISSUES) {
  let issue = existing.get(i.title);
  if (!issue) {
    issue = gh('POST', `${R}/issues`, {
      title: i.title,
      body: i.body + (i.stale ? STALE : ''),
      labels: labelsFor(i),
      ...(i.sprint ? { milestone: milestones.get(i.sprint).number } : {}),
      ...(i.assign ? { assignees: [me] } : {}),
    });
    say(`#${issue.number} ${i.title.slice(0, 60)}: created`);
    if (i.closed) gh('PATCH', `${R}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
  }
  numbers.set(i.key, issue.number);
}

// The blocked-by references, once every issue has its number.
for (const i of ISSUES.filter((x) => x.blockedBy)) {
  const n = numbers.get(i.key);
  const line = `Blocked by ${i.blockedBy.map((k) => `#${numbers.get(k)}`).join(', ')}.`;
  const current = gh('GET', `${R}/issues/${n}`);
  if ((current.body ?? '').includes(line)) continue;
  gh('PATCH', `${R}/issues/${n}`, { body: `${i.body}\n\n${line}` });
  say(`#${n}: ${line}`);
}

// Files, branches and the workflow ---------------------------------------------------
function fileOn(branch, path) {
  return gh('GET', `${R}/contents/${path}?ref=${encodeURIComponent(branch)}`, null, { allow404: true });
}
function putFile(branch, path, text, message) {
  if (fileOn(branch, path)) return false;
  gh('PUT', `${R}/contents/${path}`, { message, branch, content: Buffer.from(text).toString('base64') });
  return true;
}
function branch(name) {
  if (gh('GET', `${R}/git/ref/heads/${name}`, null, { allow404: true })) return;
  const sha = gh('GET', `${R}/git/ref/heads/${main}`).object.sha;
  gh('POST', `${R}/git/refs`, { ref: `refs/heads/${name}`, sha });
  say(`branch ${name}: created`);
}

// A workflow that only echoes, so every push and PR has a build. A branch carrying
// .ci-fail fails its test job on purpose, so a failing build shows too.
const WORKFLOW = `name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building the payments service (test data, nothing is built)"
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Tests
        run: |
          if [ -f .ci-fail ]; then
            echo "This branch carries .ci-fail, so the test job fails on purpose."
            exit 1
          fi
          echo "All tests passed (test data, nothing is tested)"
`;
if (putFile(main, '.github/workflows/ci.yml', WORKFLOW, 'ci: add an echo-only workflow')) say('workflow .github/workflows/ci.yml: added');

// Pull requests ------------------------------------------------------------------------
const PRS = [
  { branch: 'docs/settlement-glossary', closes: 'glossary', title: 'docs: settlement glossary', path: 'docs/glossary.md', text: '# Settlement glossary\n\n- **Settlement**: moving funds from the acquirer to the merchant.\n- **Clearing**: exchanging transaction details before settlement.\n- **Interchange**: the fee the card issuer charges per transaction.\n- **Payout**: the transfer to the merchant\'s bank account.\n- **Reserve**: funds held back against future refunds and disputes.\n', merge: true },
  { branch: 'docs/refund-runbook', closes: 'refund-runbook', title: 'docs: manual refund runbook', path: 'docs/runbooks/manual-refunds.md', text: '# Manual refunds during a processor outage\n\n1. Confirm the outage on the status page.\n2. Record each refund in the outage sheet with the payment id.\n3. Issue the refunds from the processor console once it recovers.\n4. Reconcile the sheet against the ledger the next morning.\n' },
  { branch: 'docs/chargeback-faq', closes: 'chargeback-faq', title: 'docs: chargeback FAQ (draft)', path: 'docs/chargeback-faq.md', text: '# Chargeback FAQ\n\n**How long do I have to respond?** Seven days from the dispute notice.\n\n_More answers to come._\n', draft: true },
  { branch: 'fix/payout-retry-backoff', closes: 'retry-backoff', title: 'fix: back off payout retries exponentially', path: 'docs/payout-retries.md', text: '# Payout retries\n\nRetries back off exponentially from one minute to an hour, with jitter, and stop after 8 attempts.\n', fail: true },
];
for (const p of PRS) {
  const found = gh('GET', `${R}/pulls?state=all&head=${owner}:${encodeURIComponent(p.branch)}`);
  if (found.length) continue;
  branch(p.branch);
  putFile(p.branch, p.path, p.text, p.title);
  if (p.fail) putFile(p.branch, '.ci-fail', 'This file makes CI fail on purpose: it is test data for a failing build.\n', 'test: fail CI on purpose');
  const pr = gh('POST', `${R}/pulls`, { title: p.title, head: p.branch, base: main, draft: Boolean(p.draft), body: `Closes #${numbers.get(p.closes)}.\n\nTest data for Toil UI.` });
  say(`PR #${pr.number} ${p.title}: opened${p.draft ? ' as a draft' : ''}`);
  if (p.merge) {
    gh('PUT', `${R}/pulls/${pr.number}/merge`, { merge_method: 'squash' });
    say(`PR #${pr.number}: merged`);
  }
}

say('');
say('Skipped: a Projects (v2) board, which needs the project scope on the gh token (gh auth refresh -s project); toil reads boards with github projects list-items.');
say('Skipped: deployments, which toil\'s github area doesn\'t read.');
say(`Done: https://github.com/${owner}/${repo}`);
