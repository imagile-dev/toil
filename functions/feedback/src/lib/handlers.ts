// The four things the feedback backend does, as plain functions of a request
// and their dependencies, so every rule here is tested without Azure:
//
//   submit    POST /api/submit, from the site's form (Turnstile)
//   report    POST /api/report, from curl (a real toil commit instead of a CAPTCHA)
//   process   the timer, every minute: pending rows become issues, within the daily cap
//   webhook   POST /api/webhook/issue: a submitted issue closed, so its submitter hears why
//
// Nothing a visitor sends reaches GitHub directly. It waits in a table until the
// timer files it, so a burst of submissions is a queue rather than a burst of
// issues, which is the only kind of backlog anyone has ever been glad to have.

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Settings } from './config.js';
import type { Mailer } from './email.js';
import type { CommitState, Fetch, GitHub } from './github.js';
import type { Stored, Tables, Table } from './tables.js';
import { closed, confirmation } from './templates.js';
import { verifyTurnstile } from './turnstile.js';

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface Deps {
  settings: Settings;
  tables: Tables;
  /** Built on first use; throws when the App's id or key isn't configured. */
  github: () => GitHub;
  /** Built on first use; throws when ACS isn't configured. */
  mailer: () => Mailer;
  fetch?: Fetch;
  now?: () => Date;
  log: Log;
}

export interface HttpIn {
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpOut {
  status: number;
  body: { ok: boolean; message?: string; error?: string };
}

export const SMOKE_HEADER = 'x-smoke-test-key';
export const SMOKE_LABEL = 'smoke-test';
export const SMOKE_TITLE = 'Feedback pipeline smoke test';
const MAX_BODY_BYTES = 16 * 1024;
/** Attempts after which a submission whose issue exists stops retrying its confirmation email. */
const MAX_EMAIL_ATTEMPTS = 30;
/** Members whose last comment goes into the closed notice. */
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAINTAINER_BOTS = new Set(['imagile-bot[bot]']);

const day = (date: Date): string => date.toISOString().slice(0, 10);
const reply = (status: number, body: HttpOut['body']): HttpOut => ({ status, body });
const fail = (status: number, error: string): HttpOut => reply(status, { ok: false, error });

/** The caller's IP from the platform's X-Forwarded-For (first hop), without a port. */
export function clientIp(headers: HttpIn['headers']): string {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first) return 'unknown';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(first);
  if (bracketed) return bracketed[1]!;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(first);
  return v4 ? v4[1]! : first;
}

/** Fixed-time comparison, so a key can't be found one character at a time. */
function sameSecret(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Validation

export interface Submission {
  kind: 'bug' | 'feature';
  title: string;
  body: string;
  email: string;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Control characters, which have no business in a one-line title.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

async function readJson(request: HttpIn): Promise<Parsed<Record<string, unknown>>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { ok: false, error: `The request is over ${MAX_BODY_BYTES / 1024} KB.` };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'Send a JSON object.' };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'The body is not valid JSON.' };
  }
}

function validate(input: Record<string, unknown>, allowed: readonly string[]): Parsed<Submission> {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) return { ok: false, error: `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.` };
  const { kind, title, body, email } = input;
  if (kind !== 'bug' && kind !== 'feature') return { ok: false, error: 'kind must be "bug" or "feature".' };
  const cleanTitle = typeof title === 'string' ? title.replace(CONTROL, ' ').trim() : '';
  if (cleanTitle.length < 1 || cleanTitle.length > 120) return { ok: false, error: 'title must be 1 to 120 characters.' };
  const cleanBody = typeof body === 'string' ? body.replace(/\r\n?/g, '\n').trim() : '';
  if (cleanBody.length < 1 || cleanBody.length > 4000) return { ok: false, error: 'body must be 1 to 4000 characters.' };
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  if (cleanEmail.length > 254 || !EMAIL.test(cleanEmail)) return { ok: false, error: 'email must be a valid email address. It is used only to tell you about your issue.' };
  return { ok: true, value: { kind, title: cleanTitle, body: cleanBody, email: cleanEmail } };
}

// ---------------------------------------------------------------------------
// Limits

/** Counts one submission from this IP today; false once the IP has used its limit. */
export async function consumeIpLimit(table: Table, route: string, ip: string, limit: number, now: Date): Promise<boolean> {
  // The IP is stored only as a hash: enough to count, not enough to keep.
  const rowKey = `${route}-${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
  const partitionKey = day(now);
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await table.get(partitionKey, rowKey);
    if (!row) {
      if (limit < 1) return false;
      if (await table.create({ partitionKey, rowKey, count: 1 })) return true;
      continue;
    }
    const count = Number(row.count ?? 0);
    if (count >= limit) return false;
    if (await table.replace({ ...row, count: count + 1 })) return true;
  }
  throw new Error('The per-IP limit could not be updated after 8 attempts.');
}

async function increment(table: Table, partitionKey: string, rowKey: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await table.get(partitionKey, rowKey);
    if (!row ? await table.create({ partitionKey, rowKey, count: 1 }) : await table.replace({ ...row, count: Number(row.count ?? 0) + 1 })) return;
  }
  throw new Error(`Counter ${partitionKey}/${rowKey} could not be updated after 8 attempts.`);
}

// ---------------------------------------------------------------------------
// Commit lookups, cached

const MISS_TTL_MS = 60 * 60_000;

/** What GitHub says about a commit, from the cache when it can't have changed (on main) or is recent. */
export async function commitState(deps: Deps, sha: string): Promise<CommitState> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = await deps.tables.commits.get('commit', sha);
  if (cached) {
    const state = cached.state as CommitState;
    if (state === 'on-main' || now.getTime() - Date.parse(String(cached.checkedAt)) < MISS_TTL_MS) return state;
  }
  const state = await deps.github().commitState(sha);
  await deps.tables.commits.upsert({ partitionKey: 'commit', rowKey: sha, state, checkedAt: now.toISOString() });
  return state;
}

// ---------------------------------------------------------------------------
// The two ways in

async function enqueue(deps: Deps, submission: Submission, extra: Record<string, string | boolean>): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  await deps.tables.submissions.create({
    partitionKey: 'pending',
    // Time first, so a partition listing is oldest first.
    rowKey: `${now.toISOString()}-${randomUUID().replace(/-/g, '')}`,
    ...submission,
    ...extra,
    submittedAt: now.toISOString(),
    attempts: 0,
  });
}

const ACCEPTED = 'Thanks. Your report is queued and becomes a GitHub issue within a few minutes; we will email you the link.';

/** POST /api/submit: honeypot, Origin, validation, Turnstile, then the per-IP limit, in that order. */
export async function submit(request: HttpIn, deps: Deps): Promise<HttpOut> {
  const parsed = await readJson(request);
  if (!parsed.ok) return fail(400, parsed.error);
  // A bot fills every field it finds, including the one people never see. It
  // gets the same answer as a person, so it has nothing to learn from.
  if (typeof parsed.value.website === 'string' && parsed.value.website !== '') {
    deps.log.info('Submit: honeypot filled; dropped.');
    return reply(202, { ok: true, message: ACCEPTED });
  }
  if (request.headers.get('origin') !== deps.settings.allowedOrigin) return fail(403, 'Submissions are accepted from the toil site only. From a terminal, use /api/report.');
  const { turnstileToken, ...fields } = parsed.value;
  delete fields.website;
  const valid = validate(fields, ['kind', 'title', 'body', 'email']);
  if (!valid.ok) return fail(400, valid.error);
  const ip = clientIp(request.headers);
  const smoke = sameSecret(request.headers.get(SMOKE_HEADER), deps.settings.smokeTestKey);
  // The smoke key replaces the CAPTCHA and nothing else: Origin, validation and
  // the per-IP limit still apply, so a leaked key is a nuisance, not a channel.
  if (!smoke && !(await verifyTurnstile(typeof turnstileToken === 'string' ? turnstileToken : undefined, ip, deps.settings.turnstileSecret, deps.fetch))) {
    return fail(400, 'The CAPTCHA check failed. Reload the page and try again, or report from a terminal instead.');
  }
  const now = (deps.now ?? (() => new Date()))();
  if (!(await consumeIpLimit(deps.tables.ratelimits, 'submit', ip, deps.settings.submitIpDailyLimit, now))) {
    return fail(429, `This address has sent ${deps.settings.submitIpDailyLimit} reports today, the daily limit. Try again tomorrow (UTC).`);
  }
  await enqueue(deps, valid.value, { source: 'website', smoke });
  deps.log.info(`Submit: queued a ${valid.value.kind}${smoke ? ' (smoke test)' : ''}.`);
  return reply(202, { ok: true, message: ACCEPTED });
}

/** POST /api/report: validation, the per-IP limit, then the commit lookup. No CAPTCHA and no Origin check. */
export async function report(request: HttpIn, deps: Deps): Promise<HttpOut> {
  const parsed = await readJson(request);
  if (!parsed.ok) return fail(400, parsed.error);
  const { commit, version, ...fields } = parsed.value;
  const valid = validate(fields, ['kind', 'title', 'body', 'email']);
  if (!valid.ok) return fail(400, valid.error);
  const sha = typeof commit === 'string' ? commit.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return fail(400, 'commit must be the 40-character hash from `toil version --select data.commit`.');
  if (version !== undefined && (typeof version !== 'string' || !/^[0-9A-Za-z.+_-]{1,64}$/.test(version))) {
    return fail(400, 'version, when given, must be what `toil version --select data.version` prints.');
  }
  const ip = clientIp(request.headers);
  const now = (deps.now ?? (() => new Date()))();
  // The limit comes before the lookup, so random hashes can't spend the App's
  // GitHub quota. A mistyped hash costs one of the day's reports.
  if (!(await consumeIpLimit(deps.tables.ratelimits, 'report', ip, deps.settings.reportIpDailyLimit, now))) {
    return fail(429, `This address has sent ${deps.settings.reportIpDailyLimit} reports today, the daily limit for /api/report. Try again tomorrow (UTC).`);
  }
  const state = await commitState(deps, sha);
  if (state === 'missing') {
    return fail(422, `${sha} isn't a commit in ${deps.settings.repo}. Send the hash \`toil version --select data.commit\` prints for the toil you're reporting about.`);
  }
  const smoke = sameSecret(request.headers.get(SMOKE_HEADER), deps.settings.smokeTestKey);
  await enqueue(deps, valid.value, {
    source: 'terminal',
    smoke,
    commit: sha,
    onMain: state === 'on-main',
    ...(typeof version === 'string' ? { version } : {}),
  });
  deps.log.info(`Report: queued a ${valid.value.kind} about ${sha.slice(0, 12)} (${state})${smoke ? ' (smoke test)' : ''}.`);
  return reply(202, { ok: true, message: ACCEPTED });
}

// ---------------------------------------------------------------------------
// The timer

/** Stops user text from pinging accounts: "@name" in an issue body notifies that account. */
export const quietMentions = (text: string): string => text.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, '$1@​');

export function issueFor(row: Stored, repo: string): { title: string; body: string; labels: string[] } {
  const labels = [row.kind === 'bug' ? 'bug' : 'enhancement'];
  let footer: string;
  if (row.source === 'terminal') {
    labels.push('from-terminal');
    const sha = String(row.commit);
    const build = `[\`${sha.slice(0, 12)}\`](https://github.com/${repo}/commit/${sha})`;
    const version = row.version ? ` (toil ${String(row.version)})` : '';
    footer = `Reported from a terminal about commit ${build}${version}.`;
    if (row.onMain !== true) {
      labels.push('unverified-build');
      footer += ' That commit is in this repository but not on `main`, so it may be a local or unreleased build.';
    }
  } else {
    labels.push('from-website');
    footer = 'Reported through the form on the toil site.';
  }
  return { title: String(row.title), body: `${quietMentions(String(row.body))}\n\n---\n<sub>${footer}</sub>`, labels };
}

/** The one persistent smoke-test issue's body, with this run on top of the last 20. */
export function smokeBody(existing: string | null, run: { at: string; title: string } | undefined): string {
  const ROW = /^\| \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| `[^`\n]+` \|$/gm;
  const rows = [
    ...(run ? [`| ${run.at.slice(0, 19).replace('T', ' ')} | \`${run.title.replace(/`/g, "'")}\` |`] : []),
    ...((existing ?? '').replace(/\r\n/g, '\n').match(ROW) ?? []),
  ].slice(0, 20);
  return [
    'Each deploy of the feedback backend (`.github/workflows/feedback-deploy.yml`) ends with a smoke test that submits through the real pipeline. The run lands here instead of in a new issue. This issue stays closed and needs nothing from anyone.',
    '',
    '| Run (UTC) | Submission |',
    '|---|---|',
    ...rows,
  ].join('\n');
}

let smokeIssue: number | undefined;

async function recordSmoke(deps: Deps, row: Stored, now: Date): Promise<void> {
  const github = deps.github();
  try {
    if (smokeIssue === undefined) {
      const found = await github.issuesLabelled(SMOKE_LABEL);
      // Lowest numbered, so the deploy's check and this agree on which issue it is.
      smokeIssue = found[0]?.number ?? (await github.createIssue({ title: SMOKE_TITLE, body: smokeBody(null, undefined), labels: [SMOKE_LABEL] })).number;
    }
    const current = await github.getIssue(smokeIssue);
    await github.updateIssue(smokeIssue, {
      title: SMOKE_TITLE,
      body: smokeBody(current.body, { at: now.toISOString(), title: String(row.title) }),
      ...(current.state === 'open' ? { state: 'closed', state_reason: 'not_planned' } : {}),
    });
  } catch (error) {
    smokeIssue = undefined;
    throw error;
  }
}

/** Test hook: forget the cached smoke-test issue number. */
export const resetSmokeIssue = (): void => {
  smokeIssue = undefined;
};

async function file(deps: Deps, row: Stored, today: string): Promise<'created' | 'resumed'> {
  const github = deps.github();
  let outcome: 'created' | 'resumed' = 'resumed';
  // Each step records itself on the row before the next, so a failure part way
  // through resumes on the next tick instead of filing the issue twice.
  if (row.issueNumber === undefined) {
    const created = await github.createIssue(issueFor(row, deps.settings.repo));
    row.issueNumber = created.number;
    row.issueUrl = created.html_url;
    row.counted = false;
    await persist(deps, row);
    outcome = 'created';
    deps.log.info(`Process: filed issue #${created.number}.`);
  }
  if (row.counted !== true) {
    await increment(deps.tables.counters, 'issues', today);
    row.counted = true;
    await persist(deps, row);
  }
  const number = Number(row.issueNumber);
  await deps.tables.issues.upsert({ partitionKey: 'issue', rowKey: String(number), email: String(row.email), title: String(row.title) });
  if (row.emailed !== true) {
    await deps.mailer().send(confirmation(String(row.email), { number, url: String(row.issueUrl) }, String(row.title)));
    row.emailed = true;
    await persist(deps, row);
  }
  await deps.tables.submissions.delete(row.partitionKey, row.rowKey);
  return outcome;
}

async function persist(deps: Deps, row: Stored): Promise<void> {
  const entity: Record<string, unknown> = { ...row };
  delete entity.etag;
  await deps.tables.submissions.upsert(entity as Stored);
}

export interface ProcessResult {
  created: number;
  deferred: number;
  failed: number;
  stuck: number;
}

/** The timer: oldest first, smoke runs always, real submissions until today's issue cap. */
export async function processSubmissions(deps: Deps): Promise<ProcessResult> {
  const now = (deps.now ?? (() => new Date()))();
  const pending = await deps.tables.submissions.list('pending');
  const result: ProcessResult = { created: 0, deferred: 0, failed: 0, stuck: 0 };
  if (pending.length === 0) return result;
  const today = day(now);
  let used = Number((await deps.tables.counters.get('issues', today))?.count ?? 0);
  const left: Stored[] = [];
  for (const row of pending) {
    const hadIssue = row.issueNumber !== undefined;
    try {
      if (row.smoke === true) {
        await recordSmoke(deps, row, now);
        await deps.tables.submissions.delete(row.partitionKey, row.rowKey);
        deps.log.info('Process: recorded a smoke-test run.');
        continue;
      }
      // A row whose issue already exists finishes its remaining steps whatever the cap says.
      if (row.issueNumber === undefined && used >= deps.settings.dailyIssueLimit) {
        result.deferred++;
        continue;
      }
      if ((await file(deps, row, today)) === 'created') {
        used++;
        result.created++;
      }
    } catch (error) {
      // The issue may exist by now even though a later step failed; it counts.
      if (!hadIssue && row.issueNumber !== undefined) {
        used++;
        result.created++;
      }
      result.failed++;
      left.push(row);
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number(row.attempts ?? 0) + 1;
      if (row.issueNumber !== undefined && attempts >= MAX_EMAIL_ATTEMPTS) {
        // The issue exists and is counted; only its confirmation keeps failing.
        deps.log.error(`Process: gave up on the confirmation email for issue #${String(row.issueNumber)} after ${attempts} attempts: ${message}`);
        await deps.tables.submissions.delete(row.partitionKey, row.rowKey);
        continue;
      }
      deps.log.error(`Process: submission ${row.rowKey} failed (attempt ${attempts}); retrying next minute: ${message}`);
      await persist(deps, { ...row, attempts, lastError: message.slice(0, 500) }).catch(() => undefined);
    }
  }
  // Only rows this run attempted count as stuck: one held back by the daily
  // cap is waiting by design, and alerting on it would page about a policy.
  result.stuck = left.filter((row) => now.getTime() - Date.parse(String(row.submittedAt)) > deps.settings.staleMinutes * 60_000).length;
  const oldest = left.reduce((max, row) => Math.max(max, Math.floor((now.getTime() - Date.parse(String(row.submittedAt))) / 60_000)), 0);
  // infra/main.bicep's stuck-submission alert reads this line.
  deps.log.info(`SubmissionBacklog StuckCount=${result.stuck} FailedCount=${result.failed} DeferredCount=${result.deferred} OldestFailedMinutes=${oldest}`);
  return result;
}

// ---------------------------------------------------------------------------
// The webhook

export interface WebhookIn {
  headers: { get(name: string): string | null };
  raw: string;
}

export async function webhook(request: WebhookIn, deps: Deps): Promise<HttpOut> {
  const secret = deps.settings.webhookSecret;
  if (!secret) {
    deps.log.error('Webhook: WEBHOOK_SECRET is not configured, so no delivery can be verified.');
    return fail(500, 'The webhook secret is not configured.');
  }
  const expected = `sha256=${createHmac('sha256', secret).update(request.raw).digest('hex')}`;
  if (!sameSecret(request.headers.get('x-hub-signature-256'), expected)) return fail(401, 'The signature does not match.');
  const event = request.headers.get('x-github-event');
  if (event === 'ping') return reply(200, { ok: true, message: 'pong' });
  if (event !== 'issues') return reply(200, { ok: true, message: `Ignored a ${event ?? 'nameless'} event.` });
  let payload: { action?: string; issue?: { number?: number; html_url?: string; state_reason?: string | null; comments?: number }; repository?: { full_name?: string } };
  try {
    payload = JSON.parse(request.raw);
  } catch {
    return fail(400, 'The payload is not valid JSON.');
  }
  if (payload.repository?.full_name?.toLowerCase() !== deps.settings.repo.toLowerCase()) return reply(200, { ok: true, message: 'Ignored another repository.' });
  const issue = payload.issue;
  if (payload.action !== 'closed' || typeof issue?.number !== 'number') return reply(200, { ok: true, message: `Ignored issues.${payload.action ?? 'unknown'}.` });
  // The table, not a label, says whether this came from the form: labels change.
  const mapping = await deps.tables.issues.get('issue', String(issue.number));
  if (!mapping) return reply(200, { ok: true, message: `#${issue.number} has no submitter to tell.` });
  let lastComment: string | undefined;
  try {
    const comments = await deps.github().recentComments(issue.number, issue.comments ?? 0);
    lastComment = comments
      .filter((c) => MAINTAINER_ASSOCIATIONS.has(c.author_association) || MAINTAINER_BOTS.has(c.user?.login ?? ''))
      .at(-1)?.body;
  } catch (error) {
    deps.log.warn(`Webhook: couldn't read the comments on #${issue.number}; sending the notice without one: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await deps.mailer().send(
      closed(String(mapping.email), { number: issue.number, url: issue.html_url ?? `https://github.com/${deps.settings.repo}/issues/${issue.number}`, stateReason: issue.state_reason ?? null }, String(mapping.title), lastComment),
    );
  } catch (error) {
    deps.log.error(`Webhook: the closed notice for #${issue.number} failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail(500, 'The closed notice could not be sent. Redeliver this webhook to retry.');
  }
  // One notice per submission: the address is dropped once it has been told.
  await deps.tables.issues.delete('issue', String(issue.number));
  deps.log.info(`Webhook: sent the closed notice for #${issue.number}.`);
  return reply(200, { ok: true, message: `Told the submitter of #${issue.number}.` });
}
