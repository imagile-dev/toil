import { describe, expect, it } from 'vitest';
import { owiMapCommand } from '../src/areas/util/owi.js';
import type { Envelope, Warning } from '../src/core/envelope.js';
import { agentTrailer, branchNumber, keyPatterns, authorKinds, workItemsIn } from '../src/core/owi/change.js';
import type { Change } from '../src/core/owi/index.js';
import { execute } from '../src/core/run.js';
import { testContext } from './harness/context.js';
import { BITBUCKET_PR_GETS, GITHUB_PR_GETS, GITHUB_PRS, PR_KEY_PATTERNS, prEnvelopes, prJsonl } from './fixtures/owi/pull-requests.js';

/**
 * OWI 0.2's changes held to the spec (docs/owi/spec.md, The change): the
 * pull request fixture mapped through the real `util owi map` and pinned as
 * a file, what each host's records turn into, and the rules that decide who
 * wrote a pull request and which work items it names. Every pull request
 * here was reviewed by this suite, which is more than can be said for some.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const map = async (input: Record<string, unknown>) => {
  const envelope = (await execute(owiMapCommand as never, input, testContext({}).context)) as Envelope;
  return { envelope, data: envelope.data as Data, warnings: (envelope.meta.warnings ?? []) as Warning[] };
};
const json = (value: unknown) => JSON.stringify(value);
const env = (command: string, data: unknown, connection: string, inputs: Record<string, string>) => ({
  ok: true,
  data,
  error: null,
  meta: { command, durationMs: 1, version: '0.0.0-test', context: { connection: { value: connection, source: 'default' }, inputs: Object.fromEntries(Object.entries(inputs).map(([k, value]) => [k, { value, source: 'input' }])) } },
});
const GH = { owner: 'imagile', repo: 'payments-web' };

describe('the pull request fixture (test/fixtures/owi/pull-requests.ts)', async () => {
  const { data, envelope } = await map({ text: prJsonl, keyPattern: PR_KEY_PATTERNS });
  const changes = data.changes as Change[];
  const byId = (id: string) => changes.find((c) => c.id === id)!;

  it('maps every pull request once, each validating against the schema', () => {
    expect(envelope.ok, json(envelope.error)).toBe(true);
    expect(data.verified.passed, json(data.verified)).toBe(true);
    expect(data.skipped).toEqual([]);
    expect(data.count).toBe(0);
    expect(changes).toHaveLength(16);
    // A list and a get of one pull request are one change, with the get's fields and both records.
    expect(Object.keys(byId('github:imagile/payments-web#52').native)).toEqual(['github pr list', 'github pr get']);
    expect(byId('github:imagile/payments-web#52').source.command).toBe('github pr get');
  });

  it('reads state, review, checks, mergeability and size on each host', () => {
    expect(byId('corp-bitbucket:PAY/payments-core#311')).toMatchObject({ state: 'OPEN', reviewers: [{ person: { id: 'achen' }, state: 'CHANGES_REQUESTED' }], checks: 'FAILING', checksAt: '2026-10-12T15:35:00.000Z', mergeable: true, size: { files: 6, additions: null }, firstReviewAt: '2026-10-12T17:00:00.000Z', approvedAt: null });
    expect(byId('corp-bitbucket:PAY/payments-core#305')).toMatchObject({ mergeable: false, firstReviewAt: null, reviewers: [{ state: 'PENDING' }] });
    expect(byId('corp-bitbucket:PAY/payments-core#298')).toMatchObject({ state: 'MERGED', mergedAt: '2026-10-09T14:50:00.000Z', mergeCommit: '4e1d2a9'.padEnd(40, '0'), approvedAt: '2026-10-09T11:00:00.000Z' });
    expect(byId('corp-bitbucket:PAY/payments-core#298').reviews!.map((r) => r.state)).toEqual(['CHANGES_REQUESTED', 'APPROVED']);
    expect(byId('corp-ado:Payments/settlement#87')).toMatchObject({ state: 'OPEN', reviewers: [{ state: 'CHANGES_REQUESTED' }], checks: 'PENDING', url: 'https://ado.imagile.dev/DefaultCollection/Payments/_git/settlement/pullrequest/87' });
    expect(byId('corp-ado:Payments/settlement#87').unmapped.map((u) => u.field)).toContain('updated');
    expect(byId('github:imagile/payments-web#53')).toMatchObject({ state: 'DRAFT', checks: 'FAILING', size: { files: 1, additions: 18, deletions: 6 } });
    expect(byId('github:imagile/payments-web#52')).toMatchObject({ reviewers: [{ person: { id: 'ada-dev' }, state: 'PENDING' }], checks: 'PASSING', reviews: [] });
    expect(byId('github:imagile/payments-web#48')).toMatchObject({ reviewers: [{ person: { id: 'bo-web' }, state: 'APPROVED' }], firstReviewAt: '2026-10-01T14:00:00.000Z', approvedAt: '2026-10-02T09:00:00.000Z' });
    expect(byId('bitbucket-cloud:imagile/checkout-sdk#9')).toMatchObject({ state: 'MERGED', mergedAt: null, size: { files: 2, additions: 184, deletions: 0 }, reviewers: [{ state: 'APPROVED' }] });
    expect(byId('bitbucket-cloud:imagile/checkout-sdk#9').unmapped.map((u) => u.field)).toEqual(['mergedAt', 'closedAt']);
  });

  it('says who wrote each one, and which signal said so', () => {
    const kinds = Object.fromEntries(changes.map((c) => [c.id, `${c.authorKind}/${c.authorKindSource}`]));
    expect(kinds).toMatchObject({
      'corp-bitbucket:PAY/payments-core#290': 'BOT/account',
      'corp-ado:Payments/settlement#80': 'AGENT/trailer',
      'github:imagile/payments-web#51': 'AGENT/trailer',
      'github:imagile/payments-web#49': 'BOT/account',
      'bitbucket-cloud:imagile/checkout-sdk#12': 'AGENT/branch',
      'github:imagile/payments-web#52': 'HUMAN/default',
    });
    expect(byId('github:imagile/payments-web#51').authorKindSignal).toBe('Co-Authored-By: Claude <you@example.com>');
  });

  it('names the work items in titles, branches and descriptions, by the host and by key pattern', () => {
    expect(byId('corp-bitbucket:PAY/payments-core#311').workItems).toEqual(['corp-jira:PAY-101', 'corp-jira:PAY-100']);
    expect(byId('corp-ado:Payments/settlement#87').workItems).toEqual(['corp-ado:2302']);
    expect(byId('github:imagile/payments-web#52').workItems).toEqual(['github:imagile/payments-web#42', 'github:imagile/payments-web#41']);
    expect(byId('github:imagile/payments-web#51').workItems).toEqual([]);
    expect(byId('bitbucket-cloud:imagile/checkout-sdk#12').workItems).toEqual(['github:imagile/payments-web#44']);
  });

  it('is the committed fixture', async () => {
    await expect(`${JSON.stringify({ owi: data.owi, changes }, null, 2)}\n`).toMatchFileSnapshot('./fixtures/owi/pull-requests.owi.json');
  });

  it('maps the same input as one JSON array', async () => {
    const again = await map({ text: json(prEnvelopes), keyPattern: PR_KEY_PATTERNS });
    expect(again.data.changes).toEqual(changes);
  });
});

describe('change mapping rules', () => {
  it('says what a list leaves out, and which command fills it', async () => {
    const { data } = await map({ text: json(env('github pr list', GITHUB_PRS.slice(0, 1), 'github', GH)) });
    const [change] = data.changes as Change[];
    expect(change).toMatchObject({ reviews: null, checks: null, mergeable: null, size: null });
    const reasons = Object.fromEntries(change!.unmapped.map((u) => [u.field, u.reason]));
    expect(reasons.reviews).toContain('github pr get --include reviews');
    expect(reasons.checks).toContain('--include checks');
    expect(reasons.authorKind).toContain('--include commits');
    expect(reasons.mergeable).toContain('github pr get');
  });

  it('drops a #n that is itself a pull request in the input', async () => {
    const pr = { ...(GITHUB_PR_GETS[52] as Data), body: 'Follows #53 and closes #42.' };
    const { data } = await map({ text: json([env('github pr get', pr, 'github', GH), env('github pr get', GITHUB_PR_GETS[53], 'github', GH)]) });
    expect((data.changes as Change[])[0]!.workItems).toEqual(['github:imagile/payments-web#42']);
  });

  it('lists a Bitbucket change with no key patterns as having no work items read', async () => {
    const { data } = await map({ text: json(env('bitbucket pr get', BITBUCKET_PR_GETS[311], 'corp-bitbucket', { project: 'PAY', repo: 'payments-core' })) });
    const change = (data.changes as Change[])[0]!;
    expect(change.workItems).toEqual([]);
    expect(change.unmapped.find((u) => u.field === 'workItems')?.reason).toContain('key pattern');
  });

  it('lets an override win over every other signal', async () => {
    const { data } = await map({ text: json(env('github pr get', GITHUB_PR_GETS[49], 'github', GH)), authorKind: ['DEPENDABOT[BOT]=human'] });
    expect((data.changes as Change[])[0]).toMatchObject({ authorKind: 'HUMAN', authorKindSource: 'override', authorKindSignal: 'override for DEPENDABOT[BOT]' });
  });

  it("treats a coding agent's account as an agent, not a bot", async () => {
    const pr = { ...(GITHUB_PR_GETS[52] as Data), user: { login: 'Copilot', id: 1, type: 'Bot' } };
    const { data } = await map({ text: json(env('github pr get', pr, 'github', GH)) });
    expect((data.changes as Change[])[0]).toMatchObject({ authorKind: 'AGENT', authorKindSource: 'account' });
  });

  it('refuses a bad key pattern or author kind with a fix', async () => {
    for (const bad of [['PAY-{n}'], ['PAY=corp-jira'], ['PAY-{n}-{n}=corp-jira'], ['PAY-{n}=Corp Jira']]) {
      const { envelope } = await map({ text: prJsonl, keyPattern: bad });
      expect(envelope.error, bad[0]).toMatchObject({ code: 'INVALID_INPUT' });
      expect(envelope.error!.fix).toBeTruthy();
    }
    const { envelope } = await map({ text: prJsonl, authorKind: ['someone=ROBOT'] });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(envelope.error!.fix).toContain('HUMAN, AGENT, BOT');
  });

  it('reads key patterns literally, outside code and longer words', () => {
    const keys = keyPatterns(['PAY-{n}=corp-jira', 'AB#{n}=corp-ado', 'imagile/web#{n}=github']);
    expect(workItemsIn(['PAY-1 and XPAY-2, PAY-30a, `PAY-4`', 'AB#2302 imagile/web#9', '```\nPAY-5\n```'], keys)).toEqual(['corp-jira:PAY-1', 'corp-ado:2302', 'github:imagile/web#9']);
    expect(keyPatterns([{ text: 'PAY.{n}', connection: 'corp-jira' }]).length).toBe(1);
    expect(workItemsIn(['PAYX1 PAY.7'], keyPatterns(['PAY.{n}=corp-jira']))).toEqual(['corp-jira:PAY.7']);
  });

  it('reads a branch named for its issue, and an agent trailer only in a trailer', () => {
    expect(['291-pr-tracking', 'kolatts/291-pr-tracking', 'feature/291_retries', 'feature/v2-291', 'main', null].map(branchNumber)).toEqual(['291', '291', '291', null, null, null]);
    expect(agentTrailer(['Fix it\n\nCo-Authored-By: Claude Opus 5.5 <you@example.com>'])).toBe('Co-Authored-By: Claude Opus 5.5 <you@example.com>');
    expect(agentTrailer(['Ask Claude about this later'])).toBeNull();
    expect(agentTrailer(['Pair\n\nCo-authored-by: Jane <jane@example.com>'])).toBeNull();
    expect(authorKinds({ 'release-bot': 'bot' })).toEqual({ 'release-bot': 'BOT' });
  });
});
