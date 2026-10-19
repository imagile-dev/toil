import { describe, expect, it } from 'vitest';
import { readSettings } from '../src/lib/config.js';
import { CONSENT_VERSION, DISCLAIMER } from '../src/lib/consent.js';
import { clientIp, report, submit } from '../src/lib/handlers.js';
import { TURNSTILE_VERIFY } from '../src/lib/turnstile.js';
import { API, ORIGIN, REPO, SHA, deps, json, request } from './helpers.js';

const form = { kind: 'bug', title: 'jira get-issue drops the epic link', body: 'Steps: run it.', email: 'you@example.com', consent: 1, turnstileToken: 'cf-token', website: '' };
const site = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7:51234' };
/** What a caller forging X-Forwarded-For looks like by the time the platform has appended the real address. */
const forged = (n: number, real = '198.51.100.4') => ({ 'x-forwarded-for': `10.9.8.${n}, ${real}:40000` });
const turnstileOk = { [`POST ${TURNSTILE_VERIFY}`]: () => json(200, { success: true }) };
const turnstileNo = { [`POST ${TURNSTILE_VERIFY}`]: () => json(200, { success: false }) };

describe('settings', () => {
  it('defaults to this repository, the site origin and the issue limits', () => {
    const s = readSettings({});
    expect(s).toMatchObject({ repo: 'imagile-dev/toil', allowedOrigin: ORIGIN, dailyIssueLimit: 10, submitIpDailyLimit: 10, reportIpDailyLimit: 3, staleMinutes: 15, emailFrom: 'no-reply@imagile.dev' });
    expect(s.githubApi).toBe('https://api.github.com');
  });

  it('refuses a limit that is not a whole number, and a repository that is not owner/name', () => {
    expect(() => readSettings({ DAILY_SUBMISSION_LIMIT: 'ten' })).toThrow('DAILY_SUBMISSION_LIMIT must be a whole number');
    expect(() => readSettings({ GITHUB_REPO: 'toil' })).toThrow('GITHUB_REPO must be owner/name');
  });
});

describe('clientIp', () => {
  it('takes the hop the platform appended (the last), never one the caller wrote, and drops the port', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7:51234' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7:51234' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('POST /api/submit', () => {
  it('queues a valid submission after Turnstile passes, and asks Cloudflare with the secret, token and IP', async () => {
    const t = deps({ routes: turnstileOk });
    const out = await submit(request(form, site), t.deps);
    expect(out).toEqual({ status: 202, body: { ok: true, message: expect.stringContaining('queued') } });
    const verify = t.calls.find((c) => c.url === TURNSTILE_VERIFY)!;
    expect(Object.fromEntries(new URLSearchParams(verify.body))).toEqual({ secret: 'turnstile-test-secret', response: 'cf-token', remoteip: '203.0.113.7' });
  });

  it('counts a forged X-Forwarded-For against the real address, and tells Turnstile the real one', async () => {
    const t = deps({ routes: turnstileOk, settings: { submitIpDailyLimit: 1 } });
    expect((await submit(request(form, { origin: ORIGIN, ...forged(1) }), t.deps)).status).toBe(202);
    expect((await submit(request(form, { origin: ORIGIN, ...forged(2) }), t.deps)).status).toBe(429);
    expect(new URLSearchParams(t.calls.find((c) => c.url === TURNSTILE_VERIFY)!.body).get('remoteip')).toBe('198.51.100.4');
  });

  it('queues nothing more once MAX_PENDING_SUBMISSIONS rows are waiting, from any address', async () => {
    const t = deps({ routes: turnstileOk, settings: { maxPending: 2 } });
    expect((await submit(request(form, { origin: ORIGIN, 'x-forwarded-for': '198.51.100.1' }), t.deps)).status).toBe(202);
    expect((await submit(request(form, { origin: ORIGIN, 'x-forwarded-for': '198.51.100.2' }), t.deps)).status).toBe(202);
    const full = await submit(request(form, { origin: ORIGIN, 'x-forwarded-for': '198.51.100.3' }), t.deps);
    expect(full).toEqual({ status: 429, body: { ok: false, error: 'The feedback queue is full right now. Try again tomorrow (UTC).' } });
    expect(t.tables.dump('submissions')).toHaveLength(2);
    const [row] = t.tables.dump('submissions');
    expect(row).toMatchObject({ partitionKey: 'pending', kind: 'bug', title: form.title, body: form.body, email: 'you@example.com', source: 'website', smoke: false, consentVersion: 1, attempts: 0, submittedAt: '2026-10-18T12:00:00.000Z' });
    expect(row!.rowKey).toMatch(/^2026-10-18T12:00:00\.000Z-[0-9a-f]{32}$/);
  });

  it('answers a filled honeypot as if it worked, and stores nothing', async () => {
    const t = deps();
    const out = await submit(request({ ...form, website: 'https://spam.imagile.dev' }, site), t.deps);
    expect(out.status).toBe(202);
    expect(t.tables.dump('submissions')).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it('checks Origin before validation, so another site gets 403 whatever it sends', async () => {
    const t = deps();
    const out = await submit(request({ ...form, kind: 'rant' }, { origin: 'https://other.imagile.dev' }), t.deps);
    expect(out).toEqual({ status: 403, body: { ok: false, error: expect.stringContaining('/api/report') } });
  });

  it.each([
    [{ kind: 'rant' }, 'kind must be "bug" or "feature".'],
    [{ title: '' }, 'title must be 1 to 120 characters.'],
    [{ title: 'x'.repeat(121) }, 'title must be 1 to 120 characters.'],
    [{ body: '   ' }, 'body must be 1 to 4000 characters.'],
    [{ body: 'x'.repeat(4001) }, 'body must be 1 to 4000 characters.'],
    [{ email: 'not-an-address' }, expect.stringContaining('email must be a valid email address')],
    [{ email: undefined }, expect.stringContaining('email must be a valid email address')],
    [{ service: 'jira' }, 'Unknown field: service. Allowed: kind, title, body, email, consent.'],
  ])('refuses %j before Turnstile is asked', async (change, error) => {
    const t = deps();
    const out = await submit(request({ ...form, ...change }, site), t.deps);
    expect(out).toEqual({ status: 400, body: { ok: false, error } });
    expect(t.calls).toEqual([]);
  });

  it('refuses a body that is not JSON, or is over 16 KB', async () => {
    const t = deps();
    expect((await submit(request('{nope', site), t.deps)).body.error).toBe('The body is not valid JSON.');
    expect((await submit(request({ ...form, body: 'x'.repeat(17000) }, site), t.deps)).body.error).toBe('The request is over 16 KB.');
  });

  it('refuses a failed CAPTCHA without spending the per-IP limit', async () => {
    const t = deps({ routes: turnstileNo, settings: { submitIpDailyLimit: 1 } });
    expect((await submit(request(form, site), t.deps)).status).toBe(400);
    expect(t.tables.dump('ratelimits')).toEqual([]);
  });

  it('fails the CAPTCHA closed when no Turnstile secret is configured', async () => {
    const t = deps({ settings: { turnstileSecret: undefined } });
    expect((await submit(request(form, site), t.deps)).status).toBe(400);
    expect(t.calls).toEqual([]);
  });

  it('lets the smoke-test key skip Turnstile only: Origin and the IP limit still apply', async () => {
    const t = deps({ settings: { submitIpDailyLimit: 1 } });
    const smoke = { ...site, 'x-smoke-test-key': 'smoke-test-key' };
    expect((await submit(request(form, smoke), t.deps)).status).toBe(202);
    expect(t.calls).toEqual([]);
    expect(t.tables.dump('submissions')[0]).toMatchObject({ smoke: true });
    expect((await submit(request(form, smoke), t.deps)).status).toBe(429);
    expect((await submit(request(form, { 'x-smoke-test-key': 'smoke-test-key' }), t.deps)).status).toBe(403);
  });

  it('treats a wrong smoke key as no key', async () => {
    const t = deps({ routes: turnstileNo });
    expect((await submit(request(form, { ...site, 'x-smoke-test-key': 'guess' }), t.deps)).status).toBe(400);
  });

  it('allows IP_DAILY_LIMIT submissions per IP per UTC day, and keeps only a hash of the IP', async () => {
    const t = deps({ routes: turnstileOk, settings: { submitIpDailyLimit: 2 } });
    expect((await submit(request(form, site), t.deps)).status).toBe(202);
    expect((await submit(request(form, site), t.deps)).status).toBe(202);
    const third = await submit(request(form, site), t.deps);
    expect(third).toEqual({ status: 429, body: { ok: false, error: expect.stringContaining('daily limit') } });
    const [limit] = t.tables.dump('ratelimits');
    expect(limit).toMatchObject({ partitionKey: '2026-10-18', count: 2 });
    expect(limit!.rowKey).toMatch(/^submit-[0-9a-f]{32}$/);
    expect(JSON.stringify(limit)).not.toContain('203.0.113.7');
    const tomorrow = deps({ routes: turnstileOk, settings: { submitIpDailyLimit: 2 }, tables: t.tables, now: new Date('2026-10-19T00:00:01Z') });
    expect((await submit(request(form, site), tomorrow.deps)).status).toBe(202);
  });
});

describe('POST /api/report', () => {
  const curl = { 'x-forwarded-for': '198.51.100.4' };
  const body = { kind: 'feature', title: 'A --since flag on bitbucket list-prs', body: 'Please.', email: 'you@example.com', consent: 1, commit: SHA.toUpperCase(), version: '0.1.0-alpha.1' };
  const compare = `GET ${API}/repos/${REPO}/compare/${SHA}...main?per_page=1`;

  it('needs no Origin and no CAPTCHA, and queues a report about a commit on main', async () => {
    const t = deps({ routes: { [compare]: () => json(200, { status: 'ahead' }) } });
    const out = await report(request(body, curl), t.deps);
    expect(out.status).toBe(202);
    expect(t.tables.dump('submissions')[0]).toMatchObject({ source: 'terminal', commit: SHA, onMain: true, version: '0.1.0-alpha.1', kind: 'feature', smoke: false, consentVersion: 1 });
    const lookup = t.calls.find((c) => c.url.includes('/compare/'))!;
    expect(lookup.headers.authorization).toBe('token ghs_contents');
    const mint = t.calls.find((c) => c.url.endsWith('/access_tokens'))!;
    expect(JSON.parse(mint.body!)).toEqual({ repositories: ['toil'], permissions: { contents: 'read' } });
  });

  it('marks a commit that is here but not on main, and caches the answer for an hour', async () => {
    const t = deps({ routes: { [compare]: () => json(200, { status: 'diverged' }) } });
    await report(request(body, curl), t.deps);
    expect(t.tables.dump('submissions')[0]).toMatchObject({ onMain: false });
    expect(t.tables.dump('commits')[0]).toMatchObject({ rowKey: SHA, state: 'elsewhere' });
    await report(request(body, curl), t.deps);
    expect(t.calls.filter((c) => c.url.includes('/compare/'))).toHaveLength(1);
  });

  it('refuses a hash that is not a commit in the repository', async () => {
    const t = deps({ routes: { [compare]: () => json(404, { message: 'Not Found' }) } });
    const out = await report(request(body, curl), t.deps);
    expect(out).toEqual({ status: 422, body: { ok: false, error: expect.stringContaining(`isn't a commit in ${REPO}`) } });
    expect(t.tables.dump('submissions')).toEqual([]);
  });

  it.each([
    [{ commit: 'abc123' }, expect.stringContaining('commit must be the 40-character hash')],
    [{ commit: undefined }, expect.stringContaining('commit must be the 40-character hash')],
    [{ version: '1.0; rm -rf' }, expect.stringContaining('version, when given')],
    [{ turnstileToken: 'x' }, expect.stringContaining('Unknown field: turnstileToken')],
  ])('refuses %j without asking GitHub', async (change, error) => {
    const t = deps();
    expect(await report(request({ ...body, ...change }, curl), t.deps)).toEqual({ status: 400, body: { ok: false, error } });
    expect(t.calls).toEqual([]);
  });

  it('holds a forger of X-Forwarded-For to the real address: 3 a day', async () => {
    const t = deps({ routes: { [compare]: () => json(200, { status: 'ahead' }) } });
    for (let i = 0; i < 3; i++) expect((await report(request(body, forged(i)), t.deps)).status).toBe(202);
    expect((await report(request(body, forged(3)), t.deps)).status).toBe(429);
    expect(t.tables.dump('submissions')).toHaveLength(3);
  });

  it('caps /api/report across every caller at REPORT_DAILY_LIMIT a day', async () => {
    const t = deps({ routes: { [compare]: () => json(200, { status: 'ahead' }) }, settings: { reportDailyLimit: 2 } });
    expect((await report(request(body, forged(1, '198.51.100.1')), t.deps)).status).toBe(202);
    expect((await report(request(body, forged(2, '198.51.100.2')), t.deps)).status).toBe(202);
    const third = await report(request(body, forged(3, '198.51.100.3')), t.deps);
    expect(third).toEqual({ status: 429, body: { ok: false, error: expect.stringContaining('/api/report has taken its reports for today') } });
    expect(t.tables.dump('submissions')).toHaveLength(2);
  });

  it('caps GitHub commit lookups across every caller at COMMIT_LOOKUP_DAILY_LIMIT a day; cached answers are free', async () => {
    const other = 'dddd0000'.repeat(5);
    const t = deps({
      routes: { [compare]: () => json(200, { status: 'ahead' }), [`GET ${API}/repos/${REPO}/compare/${other}...main?per_page=1`]: () => json(200, { status: 'ahead' }) },
      settings: { commitLookupDailyLimit: 1 },
    });
    expect((await report(request(body, forged(1, '198.51.100.1')), t.deps)).status).toBe(202);
    expect((await report(request(body, forged(2, '198.51.100.2')), t.deps)).status).toBe(202);
    const limited = await report(request({ ...body, commit: other }, forged(3, '198.51.100.3')), t.deps);
    expect(limited).toEqual({ status: 429, body: { ok: false, error: 'Commit checks are at their limit for today. Try again tomorrow (UTC).' } });
    expect(t.calls.filter((c) => c.url.includes('/compare/'))).toHaveLength(1);
  });

  it('refuses /api/report once the queue is full', async () => {
    const t = deps({ routes: { [compare]: () => json(200, { status: 'ahead' }) }, settings: { maxPending: 1 } });
    expect((await report(request(body, curl), t.deps)).status).toBe(202);
    expect((await report(request(body, { 'x-forwarded-for': '198.51.100.9' }), t.deps)).body.error).toBe('The feedback queue is full right now. Try again tomorrow (UTC).');
    expect(t.calls.filter((c) => c.url.includes('/compare/'))).toHaveLength(1);
  });

  it('spends the per-IP limit (3 a day) before the lookup, so random hashes cannot spend GitHub quota', async () => {
    const t = deps({ routes: { [compare]: () => json(404, {}) } });
    for (let i = 0; i < 3; i++) expect((await report(request(body, curl), t.deps)).status).toBe(422);
    expect((await report(request(body, curl), t.deps)).status).toBe(429);
    expect(t.calls.filter((c) => c.url.includes('/compare/'))).toHaveLength(1);
  });
});

describe('consent to the feedback disclaimer', () => {
  const curl = { 'x-forwarded-for': '198.51.100.4' };
  const terminal = { kind: 'bug', title: 'A report', body: 'Details.', email: 'you@example.com', consent: 1, commit: SHA };
  const missing = `consent is missing. Send "consent": 1 to say you agree to the feedback disclaimer, version 1: "${DISCLAIMER}" Reports become public GitHub issues, so none is taken without it.`;
  const wrong = (shown: string) =>
    `consent must be the number 1, the version of the feedback disclaimer you agree to, not ${shown}. Send "consent": 1 to agree to version 1: "${DISCLAIMER}" Reports become public GitHub issues, so none is taken without it.`;
  const without = (payload: Record<string, unknown>) => {
    const copy = { ...payload };
    delete copy.consent;
    return copy;
  };

  it('is version 1 of the disclaimer', () => {
    expect(CONSENT_VERSION).toBe(1);
    expect(DISCLAIMER).toContain('becomes a public GitHub issue in imagile-dev/toil');
  });

  it('refuses a submission with no consent, quoting the disclaimer, before Turnstile and without spending the per-IP limit', async () => {
    const t = deps({ routes: turnstileOk, settings: { submitIpDailyLimit: 1 } });
    expect(await submit(request(without(form), site), t.deps)).toEqual({ status: 400, body: { ok: false, error: missing } });
    expect(t.calls).toEqual([]);
    expect(t.tables.dump('ratelimits')).toEqual([]);
    expect(t.tables.dump('submissions')).toEqual([]);
    expect((await submit(request(form, site), t.deps)).status).toBe(202);
  });

  it('refuses a report with no consent before the per-IP limit, the daily total and the commit lookup', async () => {
    const t = deps({ settings: { reportIpDailyLimit: 1, reportDailyLimit: 1 } });
    expect(await report(request(without(terminal), curl), t.deps)).toEqual({ status: 400, body: { ok: false, error: missing } });
    expect(t.calls).toEqual([]);
    expect(t.tables.dump('ratelimits')).toEqual([]);
    expect(t.tables.dump('counters')).toEqual([]);
  });

  it.each([
    [true, 'true'],
    ['1', '"1"'],
    [0, '0'],
    [2, '2'],
    [null, 'null'],
  ])('refuses consent %j on both endpoints, saying what was sent', async (consent, shown) => {
    const t = deps({ settings: { submitIpDailyLimit: 1, reportIpDailyLimit: 1 } });
    expect(await submit(request({ ...form, consent }, site), t.deps)).toEqual({ status: 400, body: { ok: false, error: wrong(shown) } });
    expect(await report(request({ ...terminal, consent }, curl), t.deps)).toEqual({ status: 400, body: { ok: false, error: wrong(shown) } });
    expect(t.calls).toEqual([]);
    expect(t.tables.dump('ratelimits')).toEqual([]);
  });

  it('shortens a long consent value in the refusal', async () => {
    const t = deps();
    const out = await report(request({ ...terminal, consent: 'x'.repeat(200) }, curl), t.deps);
    expect(out.body.error).toContain(`not "${'x'.repeat(59)}…. Send`);
  });

  it('records the agreed version on both kinds of row', async () => {
    const t = deps({ routes: { ...turnstileOk, [`GET ${API}/repos/${REPO}/compare/${SHA}...main?per_page=1`]: () => json(200, { status: 'ahead' }) } });
    expect((await submit(request(form, site), t.deps)).status).toBe(202);
    expect((await report(request(terminal, curl), t.deps)).status).toBe(202);
    const recorded = t.tables.dump('submissions').map((row) => [row.source, row.consentVersion]);
    expect(recorded).toHaveLength(2);
    expect(recorded).toEqual(expect.arrayContaining([['website', 1], ['terminal', 1]]));
  });

  it('still answers a filled honeypot as if it worked, consent or not', async () => {
    const t = deps();
    expect((await submit(request({ ...without(form), website: 'https://spam.imagile.dev' }, site), t.deps)).status).toBe(202);
    expect(t.tables.dump('submissions')).toEqual([]);
  });
});
