// The deploy's last step: the real pipeline, end to end, against what was just
// deployed. Both ways in are driven with the smoke-test key, so each run lands
// on the one persistent closed `smoke-test` issue rather than in a new issue,
// and no email is sent:
//
//   1. POST /api/submit with the site's Origin (the key skips Turnstile only)
//   2. POST /api/report about the commit being deployed (a real commit on main)
//   3. POST /api/report with no consent, which must be refused with 400. The
//      consent check comes before every limit, so this costs no allowance
//   4. POST /api/webhook/issue unsigned, which must be refused with 401: a 500
//      means the webhook secret didn't resolve from Key Vault
//   5. Wait for the timer to record both runs on the smoke-test issue
//
// It names the stage that failed and exits 1. A smoke test that passes when the
// pipeline is down is a status report, and we have enough of those.
//
// Env: FEEDBACK_URL (https://<host>), SMOKE_TEST_KEY, GITHUB_TOKEN (read access),
// REPO (owner/name), COMMIT (40 hex), ORIGIN (the site's), RUN_ID, WAIT_SECONDS.

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    console.error(`smoke: ${name} is not set.`);
    process.exit(1);
  }
  return value;
};

const base = env('FEEDBACK_URL').replace(/\/+$/, '');
const key = env('SMOKE_TEST_KEY');
const token = env('GITHUB_TOKEN');
const repo = env('REPO', 'imagile-dev/toil');
const commit = env('COMMIT');
const origin = env('ORIGIN', 'https://imagile-dev.github.io');
const run = env('RUN_ID', String(Date.now()));
const waitSeconds = Number(env('WAIT_SECONDS', '360'));

const fail = (stage, detail) => {
  console.error(`smoke: FAILED at ${stage}: ${detail}`);
  process.exit(1);
};

async function post(path, body, headers) {
  // A cold start on the first request can take a while; retry a little before calling it down.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const text = await response.text();
      // 502-504 is the front end waiting on a cold instance; 500 is the app's own answer and counts.
      if ([502, 503, 504].includes(response.status) && attempt < 5) throw new Error(`HTTP ${response.status}`);
      return { status: response.status, text };
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}

const titles = { submit: `smoke ${run} submit`, report: `smoke ${run} report` };
// consent: 1 is the version of the feedback disclaimer (functions/feedback/src/lib/consent.ts).
const fields = { kind: 'bug', body: 'Automated smoke test of the deployed feedback backend.', email: 'you@example.com', consent: 1 };

const submitted = await post('/api/submit', { ...fields, title: titles.submit, website: '' }, { origin, 'x-smoke-test-key': key });
if (submitted.status !== 202) fail('submit', `expected 202, got ${submitted.status}: ${submitted.text}`);
console.log('smoke: /api/submit accepted the smoke run.');

const reported = await post('/api/report', { ...fields, title: titles.report, commit }, { 'x-smoke-test-key': key });
if (reported.status !== 202) fail('report', `expected 202, got ${reported.status}: ${reported.text}`);
console.log('smoke: /api/report accepted the smoke run.');

const unconsented = { ...fields };
delete unconsented.consent;
const refused = await post('/api/report', { ...unconsented, title: `smoke ${run} no consent`, commit }, {});
if (refused.status !== 400 || !refused.text.includes('consent is missing')) fail('consent', `expected 400 "consent is missing" for a report without consent, got ${refused.status}: ${refused.text}`);
console.log('smoke: /api/report refused a report without consent.');

const hook = await post('/api/webhook/issue', { action: 'closed' }, { 'x-github-event': 'issues' });
if (hook.status !== 401) fail('webhook', `expected 401 for an unsigned delivery, got ${hook.status}: ${hook.text}`);
console.log('smoke: /api/webhook/issue refused an unsigned delivery.');

const gh = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'toil-feedback-smoke' } });
  if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
  return response.json();
};

const deadline = Date.now() + waitSeconds * 1000;
for (;;) {
  const issues = (await gh(`/repos/${repo}/issues?labels=smoke-test&state=all&sort=created&direction=asc&per_page=20`)).filter((i) => !i.pull_request);
  const body = issues[0]?.body ?? '';
  if (body.includes(`\`${titles.submit}\``) && body.includes(`\`${titles.report}\``)) {
    console.log(`smoke: both runs recorded on #${issues[0].number}. The pipeline works end to end.`);
    process.exit(0);
  }
  if (Date.now() > deadline) fail('timer', `the smoke-test issue ${issues[0] ? `#${issues[0].number}` : '(none yet)'} doesn't show both runs after ${waitSeconds}s, so ProcessSubmissions isn't filing.`);
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
