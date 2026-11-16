// Turns the seeded sandboxes into "a real team's week" for screen recordings:
// one current sprint across GitHub, Jira and Azure DevOps, a day of movement
// (something done, things in progress, a blocker chain, code reviews waiting on
// review and on checks), and a few small "ready for an agent" items with code
// for the agent to change. Run the seeds first (docs/demo-reset.md):
//
//   node ui/scripts/demo-week.mjs --sprint "Sprint 44" --ends 2026-11-27 --only github
//   node ui/scripts/demo-week.mjs --sprint "Sprint 44" --ends 2026-11-27 --only jira --jira-project SCRUM
//   node ui/scripts/demo-week.mjs --sprint "Sprint 44" --ends 2026-11-27 --only ado --ado-project "Toil Sandbox"
//
// GitHub goes through gh, as seed-sandbox.mjs does (toil's github area has no
// milestone command). Jira and Azure DevOps go through toil's own commands with
// --allow-write, so the connection's `writes` decides and no token is ever seen
// here. Every step looks first and skips what is already done, so it is safe to
// run again before each recording; pass a new --sprint and --ends to roll the
// week forward. All of it is made-up work for a made-up payments product.
// Repo tooling only: nothing here ships. The stand-up was rehearsed, which is
// more than most stand-ups can say.
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const sprint = take('--sprint');
const ends = take('--ends');
const only = take('--only', 'github,jira,ado').split(',');
const owner = take('--owner', 'imagile-dev');
const repo = take('--repo', 'toil-sandbox');
const jiraProject = take('--jira-project', 'SCRUM');
const adoProject = take('--ado-project', 'Toil Sandbox');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toilJs = resolve(take('--toil', resolve(root, 'dist', 'toil.js')));
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'See the usage at the top of ui/scripts/demo-week.mjs.');
if (!sprint || !/^\d{4}-\d{2}-\d{2}$/.test(ends ?? '')) fail('Name the sprint and its last day.', 'node ui/scripts/demo-week.mjs --sprint "Sprint 44" --ends 2026-11-27');

function fail(message, fix) {
  process.stderr.write(`demo-week: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}
const say = (line) => process.stdout.write(`${line}\n`);
const today = new Date().toISOString().slice(0, 10);
export const DEMO_NOTE = 'Made-up demo data for Toil UI recordings.';

/** One `gh api` call, the body on stdin, never through a shell. */
function gh(method, path, body, { allow404 = false, allowFail = false } = {}) {
  const argv = ['api', '-X', method, path, ...(body ? ['--input', '-'] : [])];
  const res = spawnSync('gh', argv, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) fail(`couldn't run gh: ${res.error.message}`, 'Install the GitHub CLI and sign in with gh auth login.');
  if (res.status !== 0) {
    if (allow404 && /HTTP 404/.test(res.stderr)) return null;
    if (allowFail) return { failed: res.stderr.trim() };
    fail(`gh api ${method} ${path} failed: ${res.stderr.trim() || res.stdout.trim()}`, 'Check gh auth status.');
  }
  const out = res.stdout.trim();
  return out ? JSON.parse(out) : null;
}

/** One toil call, never through a shell; fails loudly on an error envelope unless asked not to. */
export function toil(argv, { soft = false } = {}) {
  if (!existsSync(toilJs)) fail(`There is no toil at ${toilJs}.`, 'Pass --toil <path to toil.js>.');
  const res = spawnSync(process.execPath, [toilJs, ...argv], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let env;
  try {
    env = JSON.parse(res.stdout);
  } catch {
    fail(`toil ${argv.slice(0, 3).join(' ')} printed no envelope: ${(res.stderr || res.stdout).trim().slice(0, 300)}`, 'Run the same toil command by hand.');
  }
  if (!env.ok && !soft) fail(`toil ${argv.slice(0, 4).join(' ')}: ${env.error.message}`, env.error.fix ?? 'Run the same toil command by hand.');
  return env;
}

// The code an agent can change: tiny, tested, and the same in both repositories.
export const SKELETON = {
  // Two real, old releases with published advisories, so `toil deps scan` and `toil osv vulns`
  // have something true to say; nothing installs or runs them (the tests use none).
  'package.json': JSON.stringify({ name: 'payments-demo', private: true, type: 'module', scripts: { test: 'node --test' }, description: DEMO_NOTE, dependencies: { express: '4.19.2', jsonwebtoken: '8.5.1' } }, null, 2) + '\n',
  'src/money.js': `// Amounts are held in minor units (cents). ${DEMO_NOTE}
export const ZERO_DECIMAL = new Set(['JPY', 'KRW']);

/** 12.34 USD -> 1234; 500 JPY -> 500. */
export function toMinor(amount, currency) {
  return ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);
}

/** 1234 USD -> "12.34 USD". Zero-decimal currencies still print two decimals today. */
export function formatAmount(minor, currency) {
  return \`\${(minor / 100).toFixed(2)} \${currency}\`;
}
`,
  'src/logger.js': `// Request logging for the payments service. ${DEMO_NOTE}
/** Prints a payment method at debug level. It prints the whole object today, card number included. */
export function describePaymentMethod(method) {
  return \`payment method \${JSON.stringify(method)}\`;
}
`,
  'src/refunds.js': `// Refund requests. ${DEMO_NOTE}
export const REASON_CODES = ['duplicate', 'fraudulent', 'requested_by_customer', 'product_not_received'];

/** Builds a refund request. The reason is not checked against REASON_CODES yet. */
export function createRefund({ paymentId, amount, reason }) {
  if (!paymentId) throw new Error('paymentId is required');
  if (!(amount > 0)) throw new Error('amount must be positive');
  return { paymentId, amount, reason, status: 'pending' };
}
`,
  'test/money.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, toMinor } from '../src/money.js';

test('toMinor keeps cents for USD', () => assert.equal(toMinor(12.34, 'USD'), 1234));
test('toMinor keeps whole yen', () => assert.equal(toMinor(500, 'JPY'), 500));
test('formatAmount prints USD with two decimals', () => assert.equal(formatAmount(1234, 'USD'), '12.34 USD'));
`,
  'test/refunds.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefund } from '../src/refunds.js';

test('createRefund starts pending', () => assert.equal(createRefund({ paymentId: 'pay_1', amount: 5, reason: 'duplicate' }).status, 'pending'));
test('createRefund refuses a zero amount', () => assert.throws(() => createRefund({ paymentId: 'pay_1', amount: 0, reason: 'duplicate' })));
`,
};

/** The "ready for an agent" items: small, specified, with the files and the check named. */
export const AGENT_ITEMS = {
  github: {
    title: 'Format zero-decimal currencies without decimals in formatAmount',
    body: `formatAmount in src/money.js prints every currency with two decimals, so 500 JPY shows as "5.00 JPY".

**Change:** in \`src/money.js\`, make \`formatAmount\` print currencies in \`ZERO_DECIMAL\` (JPY, KRW) as whole units: \`formatAmount(500, 'JPY')\` returns \`"500 JPY"\`. Other currencies keep two decimals.

**Acceptance criteria**
- [ ] \`formatAmount(500, 'JPY') === '500 JPY'\` and \`formatAmount(1200, 'KRW') === '1200 KRW'\`
- [ ] \`formatAmount(1234, 'USD') === '12.34 USD'\` still holds
- [ ] Tests added to \`test/money.test.js\`; \`npm test\` passes
- [ ] No other file changes

Ready for an agent: about 30 minutes, one file and its test. ${DEMO_NOTE}`,
  },
  jira: {
    summary: 'Add maskPan() so debug logs never print a full card number',
    description: `describePaymentMethod in src/logger.js (repository imagile-dev/toil-sandbox) prints the whole payment method, card number included.

Change: add src/mask.js exporting maskPan(pan), which keeps the last four digits and replaces every other digit with "*" ("4242424242424242" becomes "************4242"). Use it in describePaymentMethod for the number field.

Acceptance criteria:
- maskPan('4242424242424242') returns '************4242'
- maskPan of a value with fewer than 4 digits returns it all masked
- describePaymentMethod({ number: '4242424242424242', brand: 'visa' }) no longer contains the full number
- Tests in test/mask.test.js; npm test passes

Ready for an agent: about 30 minutes, two files and a test. ${DEMO_NOTE}`,
  },
  ado: {
    title: 'Refuse a refund whose reason is not a known reason code',
    description: `<p>createRefund in src/refunds.js (repository settlement-service) accepts any reason.</p>
<p><b>Change:</b> throw an Error naming the allowed codes when <code>reason</code> is not in <code>REASON_CODES</code>.</p>
<p><b>Acceptance criteria</b></p>
<ul><li>createRefund with reason 'duplicate' still returns a pending refund</li>
<li>createRefund with reason 'other' throws, and the message lists the four codes</li>
<li>Tests in test/refunds.test.js; npm test passes</li></ul>
<p>Ready for an agent: about 20 minutes, one file and its test. ${DEMO_NOTE}</p>`,
  },
};

// GitHub --------------------------------------------------------------------------------
function github() {
  const R = `repos/${owner}/${repo}`;
  const info = gh('GET', R, null, { allow404: true });
  if (!info) fail(`${owner}/${repo} doesn't exist, or gh can't see it.`, 'Run ui/scripts/seed-sandbox.mjs first.');
  const main = info.default_branch;
  const me = gh('GET', 'user').login;
  say(`GitHub ${owner}/${repo} as ${me}`);

  // One current sprint: this one open, every other milestone closed, open sprint work moved onto it.
  const milestones = gh('GET', `${R}/milestones?state=all&per_page=100`);
  let current = milestones.find((m) => m.title === sprint);
  const due = `${ends}T00:00:00Z`;
  if (!current) {
    current = gh('POST', `${R}/milestones`, { title: sprint, due_on: due, description: `The current sprint, ending ${ends}. ${DEMO_NOTE}` });
    say(`  milestone ${sprint}: created, due ${ends}`);
  } else if (current.state !== 'open' || !current.due_on?.startsWith(ends)) {
    current = gh('PATCH', `${R}/milestones/${current.number}`, { state: 'open', due_on: due });
    say(`  milestone ${sprint}: reopened / due ${ends}`);
  }
  const issues = gh('GET', `${R}/issues?state=all&per_page=100`).filter((i) => !i.pull_request);
  for (const m of milestones.filter((x) => x.number !== current.number && /^Sprint \d+$/.test(x.title))) {
    for (const i of issues.filter((x) => x.state === 'open' && x.milestone?.number === m.number)) {
      gh('PATCH', `${R}/issues/${i.number}`, { milestone: current.number });
      say(`  #${i.number} moved from ${m.title} to ${sprint}`);
    }
    if (m.state === 'open') {
      gh('PATCH', `${R}/milestones/${m.number}`, { state: 'closed' });
      say(`  milestone ${m.title}: closed`);
    }
  }
  const byTitle = (prefix) => issues.find((i) => i.title.startsWith(prefix));

  // Code an agent can change, on the default branch.
  for (const [path, text] of Object.entries(SKELETON)) {
    const have = gh('GET', `${R}/contents/${path}?ref=${main}`, null, { allow404: true });
    if (have && Buffer.from(have.content, 'base64').toString('utf8') === text) continue;
    gh('PUT', `${R}/contents/${path}`, { message: `chore: ${have ? 'update' : 'add'} ${path} (demo code)`, branch: main, content: Buffer.from(text).toString('base64'), ...(have ? { sha: have.sha } : {}) });
    say(`  ${path}: ${have ? 'updated' : 'added'} on ${main}`);
  }

  // Done today: the runbook PR merges and closes its issue.
  const pulls = gh('GET', `${R}/pulls?state=all&per_page=100`);
  const runbook = pulls.find((p) => p.head.ref === 'docs/refund-runbook');
  if (runbook?.state === 'open') {
    gh('PUT', `${R}/pulls/${runbook.number}/merge`, { merge_method: 'squash' });
    say(`  PR #${runbook.number}: merged`);
  }

  // In progress today: a status comment on each, once per sprint.
  const notes = [
    ['Tokenise stored cards', `Edge proxy now swaps PANs for tokens in staging; the core service still has one code path that reads the raw number. Finishing that next. (${sprint} update, ${DEMO_NOTE})`],
    ['Duplicate capture when', `Root cause found: the idempotency check runs after the processor call. Fix is up for review; the shared store work waits on it. (${sprint} update, ${DEMO_NOTE})`],
  ];
  for (const [prefix, body] of notes) {
    const issue = byTitle(prefix);
    if (!issue) continue;
    const comments = gh('GET', `${R}/issues/${issue.number}/comments?per_page=100`);
    if (comments.some((c) => c.body.includes(`(${sprint} update`))) continue;
    gh('POST', `${R}/issues/${issue.number}/comments`, { body });
    say(`  #${issue.number}: status comment added`);
  }

  // A code review waiting on review, for the duplicate-capture fix.
  const dup = byTitle('Duplicate capture when');
  const fixBranch = 'fix/check-idempotency-before-capture';
  if (dup && !pulls.some((p) => p.head.ref === fixBranch)) {
    if (!gh('GET', `${R}/git/ref/heads/${fixBranch}`, null, { allow404: true })) {
      const sha = gh('GET', `${R}/git/ref/heads/${main}`).object.sha;
      gh('POST', `${R}/git/refs`, { ref: `refs/heads/${fixBranch}`, sha });
    }
    const path = 'docs/idempotency.md';
    if (!gh('GET', `${R}/contents/${path}?ref=${fixBranch}`, null, { allow404: true })) {
      gh('PUT', `${R}/contents/${path}`, { message: 'fix: check the idempotency key before calling the processor', branch: fixBranch, content: Buffer.from('# Idempotency\n\nA capture checks its idempotency key before it calls the processor, so a retried request returns the first result instead of capturing again.\n').toString('base64') });
    }
    const pr = gh('POST', `${R}/pulls`, { title: 'fix: check the idempotency key before calling the processor', head: fixBranch, base: main, body: `Closes #${dup.number}.\n\nMoves the idempotency check ahead of the processor call. ${DEMO_NOTE}` });
    say(`  PR #${pr.number}: opened, waiting on review`);
  }

  // The blocker chain: duplicate capture -> shared store -> payout preview -> rolling reserve.
  const store = byTitle('Keep idempotency keys');
  const preview = byTitle('Payout preview');
  if (store && preview) {
    const line = `Blocked by #${store.number}.`;
    const body = preview.body ?? '';
    if (!body.includes(line)) {
      gh('PATCH', `${R}/issues/${preview.number}`, { body: `${body}\n\n${line}` });
      say(`  #${preview.number}: ${line}`);
    }
    if (!preview.labels.some((l) => l.name === 'blocked')) gh('POST', `${R}/issues/${preview.number}/labels`, { labels: ['blocked'] });
  }

  // One item ready for an agent.
  const labels = gh('GET', `${R}/labels?per_page=100`).map((l) => l.name);
  if (!labels.includes('agent-ready')) gh('POST', `${R}/labels`, { name: 'agent-ready', color: '7057ff', description: 'Small and specified: an agent can pick it up' });
  if (!byTitle(AGENT_ITEMS.github.title)) {
    const i = gh('POST', `${R}/issues`, { title: AGENT_ITEMS.github.title, body: AGENT_ITEMS.github.body, labels: ['agent-ready', 'type: bug', 'priority: medium', 'points: 1'], milestone: current.number });
    say(`  #${i.number}: agent-ready issue created`);
  }
  say(`  done: https://github.com/${owner}/${repo}/milestone/${current.number}`);
}

if (only.includes('github')) github();
if (only.includes('jira')) (await import('./demo-week-jira.mjs')).jira({ toil, say, fail, sprint, ends, today, project: jiraProject, item: AGENT_ITEMS.jira, note: DEMO_NOTE });
if (only.includes('ado')) (await import('./demo-week-ado.mjs')).ado({ toil, say, fail, sprint, ends, today, project: adoProject, item: AGENT_ITEMS.ado, skeleton: SKELETON, note: DEMO_NOTE });
