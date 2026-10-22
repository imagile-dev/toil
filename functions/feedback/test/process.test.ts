import { createHmac, createVerify } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { appJwt } from '../src/lib/github.js';
import { issueFor, processSubmissions, quietMentions, resetSmokeIssue, smokeBody, webhook, SMOKE_LABEL } from '../src/lib/handlers.js';
import type { Stored } from '../src/lib/tables.js';
import { EMAIL_COLORS } from '../src/lib/palette.js';
import { closed, confirmation } from '../src/lib/templates.js';
import { API, REPO, SHA, TEST_KEY, TEST_PUBLIC_KEY, deps, json, memoryTables, type Call } from './helpers.js';

const pendingRow = (n: number, extra: Record<string, unknown> = {}) => ({
  partitionKey: 'pending',
  rowKey: `2026-10-18T11:0${n}:00.000Z-${String(n).padStart(32, '0')}`,
  kind: 'bug',
  title: `Report ${n}`,
  body: `Body ${n}, cc @someone`,
  email: `you+${n}@example.com`,
  source: 'website',
  smoke: false,
  consentVersion: 1,
  submittedAt: `2026-10-18T11:0${n}:00.000Z`,
  attempts: 0,
  ...extra,
});

function issueRoutes(log: Call[] = []) {
  let next = 100;
  return {
    [`POST ${API}/repos/${REPO}/issues`]: (call: Call) => {
      log.push(call);
      const n = next++;
      return json(201, { number: n, html_url: `https://github.com/${REPO}/issues/${n}`, state: 'open', body: JSON.parse(call.body!).body });
    },
  };
}

beforeEach(() => resetSmokeIssue());

describe('ProcessSubmissions', () => {
  it('files a pending row as an issue with its labels, records it, emails the submitter and drops the row', async () => {
    const tables = memoryTables();
    await tables.submissions.create(pendingRow(1));
    const created: Call[] = [];
    const t = deps({ tables, routes: issueRoutes(created) });
    const result = await processSubmissions(t.deps);
    expect(result).toEqual({ created: 1, deferred: 0, failed: 0, stuck: 0 });
    const sent = JSON.parse(created[0]!.body!);
    expect(sent).toEqual({ title: 'Report 1', labels: ['bug', 'from-website'], body: 'Body 1, cc @​someone\n\n---\n<sub>Reported through the form on the toil site. The reporter accepted the feedback disclaimer (version 1) before sending.</sub>' });
    expect(created[0]!.headers.authorization).toBe('token ghs_issues');
    expect(JSON.parse(t.calls.find((c) => c.url.endsWith('/access_tokens'))!.body!)).toEqual({ repositories: ['toil'], permissions: { issues: 'write' } });
    expect(t.tables.dump('submissions')).toEqual([]);
    expect(t.tables.dump('counters')[0]).toMatchObject({ partitionKey: 'issues', rowKey: '2026-10-18', count: 1 });
    expect(t.tables.dump('issues')[0]).toMatchObject({ rowKey: '100', email: 'you+1@example.com', title: 'Report 1' });
    expect(t.mail.sent).toEqual([confirmation('you+1@example.com', { number: 100, url: `https://github.com/${REPO}/issues/100` }, 'Report 1')]);
    expect(t.log.lines).toContain('info SubmissionBacklog StuckCount=0 FailedCount=0 DeferredCount=0 OldestFailedMinutes=0');
  });

  it('labels terminal reports, and a commit off main as unverified-build', async () => {
    const onMain = issueFor(pendingRow(1, { source: 'terminal', commit: SHA, onMain: true, version: '0.1.0-alpha.1', kind: 'feature' }) as unknown as Stored, REPO);
    expect(onMain.labels).toEqual(['enhancement', 'from-terminal']);
    expect(onMain.body).toContain(`Reported from a terminal about commit [\`${SHA.slice(0, 12)}\`](https://github.com/${REPO}/commit/${SHA}) (toil 0.1.0-alpha.1).`);
    const off = issueFor(pendingRow(1, { source: 'terminal', commit: SHA, onMain: false }) as unknown as Stored, REPO);
    expect(off.labels).toEqual(['bug', 'from-terminal', 'unverified-build']);
    expect(off.body).toContain('not on `main`');
    expect(off.body).toContain('may be a local or unreleased build. The reporter accepted the feedback disclaimer (version 1) before sending.</sub>');
  });

  it('still files a row queued before consent was asked for, and says so rather than claim it', async () => {
    const tables = memoryTables();
    const legacy: Record<string, unknown> = pendingRow(1);
    delete legacy.consentVersion;
    await tables.submissions.create(legacy as ReturnType<typeof pendingRow>);
    const created: Call[] = [];
    const t = deps({ tables, routes: issueRoutes(created) });
    expect(await processSubmissions(t.deps)).toMatchObject({ created: 1, failed: 0 });
    const sent = JSON.parse(created[0]!.body!);
    expect(sent.body).toBe('Body 1, cc @​someone\n\n---\n<sub>Reported through the form on the toil site. Sent before reporters were asked to accept the feedback disclaimer.</sub>');
    expect(t.tables.dump('submissions')).toEqual([]);
  });

  it('creates at most DAILY_SUBMISSION_LIMIT issues a UTC day and holds the rest, oldest first', async () => {
    const tables = memoryTables();
    for (const n of [1, 2, 3]) await tables.submissions.create(pendingRow(n));
    const created: Call[] = [];
    const t = deps({ tables, routes: issueRoutes(created), settings: { dailyIssueLimit: 2 } });
    expect(await processSubmissions(t.deps)).toEqual({ created: 2, deferred: 1, failed: 0, stuck: 0 });
    expect(created.map((c) => JSON.parse(c.body!).title)).toEqual(['Report 1', 'Report 2']);
    expect(await processSubmissions(t.deps)).toMatchObject({ created: 0, deferred: 1 });
    const tomorrow = deps({ tables, routes: issueRoutes(created), settings: { dailyIssueLimit: 2 }, now: new Date('2026-10-19T00:00:30Z') });
    expect(await processSubmissions(tomorrow.deps)).toMatchObject({ created: 1, deferred: 0 });
  });

  it('leaves a failed row for the next tick and reports it as stuck once it is older than STALE_SUBMISSION_MINUTES', async () => {
    const tables = memoryTables();
    await tables.submissions.create(pendingRow(1));
    const t = deps({ tables, routes: { [`POST ${API}/repos/${REPO}/issues`]: () => json(502, { message: 'Bad Gateway' }) }, now: new Date('2026-10-18T11:20:00Z') });
    expect(await processSubmissions(t.deps)).toEqual({ created: 0, deferred: 0, failed: 1, stuck: 1 });
    expect(t.tables.dump('submissions')[0]).toMatchObject({ attempts: 1, lastError: expect.stringContaining('returned 502') });
    expect(t.log.lines).toContain('info SubmissionBacklog StuckCount=1 FailedCount=1 DeferredCount=0 OldestFailedMinutes=19');
  });

  it('never files an issue twice: an email that fails after the issue exists resumes without creating another', async () => {
    const tables = memoryTables();
    await tables.submissions.create(pendingRow(1));
    const created: Call[] = [];
    const first = deps({ tables, routes: issueRoutes(created), failingMail: true });
    expect(await processSubmissions(first.deps)).toMatchObject({ created: 1, failed: 1 });
    expect(tables.dump('submissions')[0]).toMatchObject({ issueNumber: 100, counted: true, attempts: 1 });
    const second = deps({ tables, routes: issueRoutes(created), settings: { dailyIssueLimit: 1 } });
    expect(await processSubmissions(second.deps)).toMatchObject({ created: 0, failed: 0, deferred: 0 });
    expect(created).toHaveLength(1);
    expect(second.mail.sent).toHaveLength(1);
    expect(tables.dump('counters')[0]).toMatchObject({ count: 1 });
    expect(tables.dump('submissions')).toEqual([]);
  });

  it('gives up on a confirmation email after 30 attempts, keeping the issue', async () => {
    const tables = memoryTables();
    await tables.submissions.create(pendingRow(1, { issueNumber: 100, issueUrl: 'https://github.com/x', counted: true, attempts: 29 }));
    const t = deps({ tables, failingMail: true });
    await processSubmissions(t.deps);
    expect(tables.dump('submissions')).toEqual([]);
    expect(t.log.lines.some((l) => l.startsWith('error Process: gave up on the confirmation email for issue #100'))).toBe(true);
  });

  it('records a smoke run on the one persistent closed issue, outside the cap and with no email', async () => {
    const tables = memoryTables();
    await tables.submissions.create(pendingRow(1, { smoke: true, title: 'smoke run 7' }));
    const patches: Call[] = [];
    const t = deps({
      tables,
      settings: { dailyIssueLimit: 0 },
      routes: {
        [`GET ${API}/repos/${REPO}/issues?labels=${SMOKE_LABEL}&state=all&sort=created&direction=asc&per_page=20`]: () => json(200, [{ number: 5, pull_request: {} }, { number: 9 }, { number: 12 }]),
        [`GET ${API}/repos/${REPO}/issues/9`]: () => json(200, { number: 9, state: 'open', body: smokeBody(null, { at: '2026-10-17T09:00:00Z', title: 'smoke run 6' }) }),
        [`PATCH ${API}/repos/${REPO}/issues/9`]: (call) => {
          patches.push(call);
          return json(200, { number: 9 });
        },
      },
    });
    expect(await processSubmissions(t.deps)).toMatchObject({ created: 0, failed: 0 });
    const patch = JSON.parse(patches[0]!.body!);
    expect(patch).toMatchObject({ title: 'Feedback pipeline smoke test', state: 'closed', state_reason: 'not_planned' });
    expect(patch.body).toContain('| 2026-10-18 12:00:00 | `smoke run 7` |\n| 2026-10-17 09:00:00 | `smoke run 6` |');
    expect(t.mail.sent).toEqual([]);
    expect(tables.dump('counters')).toEqual([]);
    expect(tables.dump('issues')).toEqual([]);
    expect(tables.dump('submissions')).toEqual([]);
  });

  it('keeps 20 runs of history in the smoke issue', () => {
    let body: string | null = null;
    for (let i = 0; i < 25; i++) body = smokeBody(body, { at: `2026-10-18T10:${String(i).padStart(2, '0')}:00Z`, title: `run ${i}` });
    expect(body!.match(/^\| 2026/gm)).toHaveLength(20);
    expect(body).toContain('`run 24`');
    expect(body).not.toContain('`run 4`');
  });

  it('quiets mentions but leaves email addresses and code alone', () => {
    expect(quietMentions('@a hi @b-c, mail me@example.com, `@d`')).toBe('@​a hi @​b-c, mail me@example.com, `@d`');
  });
});

describe('POST /api/webhook/issue', () => {
  const secret = 'webhook-test-secret';
  const delivery = (payload: unknown, event = 'issues', key = secret) => {
    const raw = JSON.stringify(payload);
    return { raw, headers: new Headers({ 'x-github-event': event, 'x-hub-signature-256': `sha256=${createHmac('sha256', key).update(raw).digest('hex')}` }) };
  };
  const closedEvent = { action: 'closed', issue: { number: 100, html_url: `https://github.com/${REPO}/issues/100`, state_reason: 'not_planned', comments: 2 }, repository: { full_name: REPO } };
  const comments = {
    [`GET ${API}/repos/${REPO}/issues/100/comments?per_page=30&page=1`]: () =>
      json(200, [
        { body: 'Out of scope: it needs a browser login.', author_association: 'NONE', user: { login: 'imagile-bot[bot]' } },
        { body: 'me too', author_association: 'NONE', user: { login: 'drive-by' } },
      ]),
  };

  async function mapped() {
    const tables = memoryTables();
    await tables.issues.upsert({ partitionKey: 'issue', rowKey: '100', email: 'you@example.com', title: 'Report 1' });
    return tables;
  }

  it('emails the submitter once with the reason and the last maintainer comment, then forgets the address', async () => {
    const tables = await mapped();
    const t = deps({ tables, routes: comments });
    const out = await webhook(delivery(closedEvent), t.deps);
    expect(out.status).toBe(200);
    expect(t.mail.sent).toEqual([closed('you@example.com', { number: 100, url: closedEvent.issue.html_url, stateReason: 'not_planned' }, 'Report 1', 'Out of scope: it needs a browser login.')]);
    expect(tables.dump('issues')).toEqual([]);
  });

  it('refuses a bad signature and a missing secret', async () => {
    const t = deps({ tables: await mapped() });
    expect((await webhook(delivery(closedEvent, 'issues', 'wrong'), t.deps)).status).toBe(401);
    const unset = deps({ settings: { webhookSecret: undefined } });
    expect((await webhook(delivery(closedEvent), unset.deps)).status).toBe(500);
    expect(t.mail.sent).toEqual([]);
  });

  it('ignores pings, other events, other actions, other repositories and issues nobody submitted', async () => {
    const t = deps({ tables: await mapped() });
    expect((await webhook(delivery({}, 'ping'), t.deps)).body.message).toBe('pong');
    expect((await webhook(delivery(closedEvent, 'push'), t.deps)).status).toBe(200);
    expect((await webhook(delivery({ ...closedEvent, action: 'reopened' }), t.deps)).status).toBe(200);
    expect((await webhook(delivery({ ...closedEvent, repository: { full_name: 'imagile-dev/other' } }), t.deps)).status).toBe(200);
    expect((await webhook(delivery({ ...closedEvent, issue: { ...closedEvent.issue, number: 7 } }), t.deps)).body.message).toBe('#7 has no submitter to tell.');
    expect(t.mail.sent).toEqual([]);
  });

  it('answers 500 and keeps the address when the email fails, so a redelivery retries', async () => {
    const tables = await mapped();
    const t = deps({ tables, routes: comments, failingMail: true });
    expect((await webhook(delivery(closedEvent), t.deps)).status).toBe(500);
    expect(tables.dump('issues')).toHaveLength(1);
  });
});

describe('GitHub App auth and the emails', () => {
  it('signs an RS256 JWT for the App that GitHub would accept: backdated, under ten minutes', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const [h, p, s] = appJwt('123456', TEST_KEY, now).split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toEqual({ iss: '123456', iat: now.getTime() / 1000 - 60, exp: now.getTime() / 1000 + 540 });
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(TEST_PUBLIC_KEY, Buffer.from(s, 'base64url'))).toBe(true);
    expect(appJwt('1', TEST_KEY.replace(/\n/g, '\\n'), now).split('.')[2]).toBe(appJwt('1', TEST_KEY, now).split('.')[2]);
  });

  it('mints one token per permission set and reuses it until five minutes before it expires', async () => {
    const t = deps({ routes: { [`GET ${API}/repos/${REPO}/issues/1`]: () => json(200, { number: 1 }) } });
    await t.deps.github().getIssue(1);
    await t.deps.github().getIssue(1);
    expect(t.calls.filter((c) => c.url.endsWith('/access_tokens'))).toHaveLength(1);
    expect(t.calls.filter((c) => c.url.endsWith('/installation'))).toHaveLength(1);
  });

  it('escapes what the submitter wrote in the HTML and keeps the title on one line', () => {
    const message = confirmation('you@example.com', { number: 3, url: 'https://github.com/imagile-dev/toil/issues/3' }, '<img src=x>\r\nBcc: someone');
    expect(message.html).toContain('&lt;img src=x&gt; Bcc: someone');
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('"<img src=x> Bcc: someone"');
    const done = closed('you@example.com', { number: 3, url: 'https://github.com/imagile-dev/toil/issues/3', stateReason: 'completed' }, 'T', '<b>fixed</b>');
    expect(done.html).toContain('&lt;b&gt;fixed&lt;/b&gt;');
    expect(done.text).toContain('It was closed as done.');
  });

  // Plain's light scheme inline for every client, its dark scheme for clients that ask for it.
  const issue = { number: 3, url: 'https://github.com/imagile-dev/toil/issues/3' };
  const messages = [
    ['confirmation', confirmation('you@example.com', issue, 'T').html],
    ['closed notice', closed('you@example.com', { ...issue, stateReason: 'completed' }, 'T', 'Done.').html],
  ] as const;
  const inline = (html: string) => [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';');
  const css = (html: string) => html.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';

  it.each(messages)('the %s uses only Plain colours, light inline and dark in the media query', (_, html) => {
    const hexes = (text: string) => new Set(text.match(/#[0-9a-f]{6}\b/gi));
    for (const hex of hexes(inline(html))) expect(Object.values(EMAIL_COLORS.light), hex).toContain(hex);
    expect(css(html)).toContain('@media (prefers-color-scheme:dark)');
    for (const hex of hexes(css(html))) expect(Object.values(EMAIL_COLORS.dark), hex).toContain(hex);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(inline(html)).toContain(`background:${EMAIL_COLORS.light.bg}`);
    expect(css(html)).toContain(`.t-page{background:${EMAIL_COLORS.dark.bg}!important;color:${EMAIL_COLORS.dark.ink}!important}`);
  });

  it.each(messages)('the %s overrides every coloured class in the dark scheme', (_, html) => {
    const classes = new Set([...html.matchAll(/class="(t-[a-z]+)"/g)].map((m) => m[1]));
    expect(classes.size).toBeGreaterThan(0);
    for (const name of classes) expect(css(html), name).toContain(`.${name}{`);
  });

  it('shows the accent on the link, and done in green; any other reason in the text colour', () => {
    const done = closed('you@example.com', { ...issue, stateReason: 'completed' }, 'T', undefined).html;
    expect(done).toContain(`href="${issue.url}"`);
    expect(done).toMatch(new RegExp(`class="t-link" style="[^"]*color:${EMAIL_COLORS.light.link}`));
    expect(done).toMatch(new RegExp(`class="t-ok" style="[^"]*color:${EMAIL_COLORS.light.ok}[^"]*">It was closed as done\\.`));
    expect(closed('you@example.com', { ...issue, stateReason: 'not_planned' }, 'T', undefined).html).not.toContain('class="t-ok"');
  });
});
