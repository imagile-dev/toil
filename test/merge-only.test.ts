import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  github, gitIn, mergesOfBaseOnly, run, samePrChange, standingApproval, summary,
  type GitHub, type Review, type TimelineEvent,
} from '../scripts/review/merge-only.mjs';

/**
 * claude-review.yml re-approves a push without an agent review only when it is
 * nothing but merges of the base branch and the PR's own diff is unchanged. A
 * false pass would merge unreviewed code through auto-merge, so every way a
 * merge can carry new code has a case here, run against real git repositories.
 */

const BOT = 'imagile-bot[bot]';
let dir: string;
let sh: (...args: string[]) => string;
const git = () => gitIn(dir);
const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
const lines = (n: number, tag = '') => Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join('\n') + '\n';
const commit = (message: string) => { sh('add', '-A'); sh('commit', '-q', '-m', message); return sh('rev-parse', 'HEAD').trim(); };
const mergeMain = () => { sh('merge', '-q', '--no-ff', '--no-edit', 'main'); return sh('rev-parse', 'HEAD').trim(); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toil-merge-only-'));
  const config = join(dir, '..', `${dir.split(/[\\/]/).at(-1)}.gitconfig`);
  writeFileSync(config, '');
  // The developer's own git config never reaches these repositories.
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  sh = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh('init', '-q', '-b', 'main');
  write('a.txt', lines(20));
  write('b.txt', lines(5));
  commit('base');
  sh('checkout', '-q', '-b', 'pr');
  write('a.txt', lines(20).replace('line 12\n', 'line 12 changed by the PR\n'));
  write('c.txt', 'new in the PR\n');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** The PR's commit the bot approved, then a commit on main touching only b.txt. */
function approvedThenMainMoves(mainChange: () => void = () => write('b.txt', lines(5, ' on main'))) {
  const approved = commit('the PR');
  sh('checkout', '-q', 'main');
  mainChange();
  commit('main moves');
  sh('checkout', '-q', 'pr');
  return approved;
}

// Every case builds a real repository with a dozen git calls, which take seconds on a
// loaded Windows runner.
const SLOW = { timeout: 60_000 };

describe('merge-only: the git checks', SLOW, () => {
  it('passes a clean merge of main: same PR diff, nothing but a merge', () => {
    const approved = approvedThenMainMoves();
    const head = mergeMain();
    expect(mergesOfBaseOnly(git(), approved, head, 'main')).toEqual({ ok: true, merges: 1 });
    expect(samePrChange(git(), approved, head, 'main')).toMatchObject({ ok: true });
  });

  it('passes several merges in a row', () => {
    const approved = approvedThenMainMoves();
    mergeMain();
    sh('checkout', '-q', 'main');
    write('b.txt', lines(6));
    commit('main again');
    sh('checkout', '-q', 'pr');
    const head = mergeMain();
    expect(mergesOfBaseOnly(git(), approved, head, 'main')).toEqual({ ok: true, merges: 2 });
    expect(samePrChange(git(), approved, head, 'main').ok).toBe(true);
  });

  it("passes when main only moved the PR's hunk within the same file", () => {
    const approved = approvedThenMainMoves(() => write('a.txt', `inserted on main\n${lines(20)}`));
    const head = mergeMain();
    expect(samePrChange(git(), approved, head, 'main').ok).toBe(true);
  });

  it('fails a merge whose resolution changes a PR file', () => {
    const approved = approvedThenMainMoves();
    sh('merge', '-q', '--no-ff', '--no-commit', 'main');
    write('c.txt', 'new in the PR, and slipped into the merge\n');
    const head = commit('Merge main');
    expect(mergesOfBaseOnly(git(), approved, head, 'main').ok).toBe(true);
    expect(samePrChange(git(), approved, head, 'main')).toMatchObject({ ok: false, reason: expect.stringContaining("PR's own diff changed") });
  });

  it('fails a merge that changes a file the PR never touched', () => {
    const approved = approvedThenMainMoves();
    sh('merge', '-q', '--no-ff', '--no-commit', 'main');
    write('d.txt', 'brought in by the merge\n');
    const head = commit('Merge main');
    expect(samePrChange(git(), approved, head, 'main').ok).toBe(false);
  });

  it('fails a whitespace-only change in a merge: whitespace is compared too', () => {
    const approved = approvedThenMainMoves();
    sh('merge', '-q', '--no-ff', '--no-commit', 'main');
    write('c.txt', 'new in the PR \n');
    const head = commit('Merge main');
    expect(samePrChange(git(), approved, head, 'main').ok).toBe(false);
  });

  it("fails when main changed the context around the PR's hunk", () => {
    const approved = approvedThenMainMoves(() => write('a.txt', lines(20).replace('line 10\n', 'line 10 on main\n')));
    const head = mergeMain();
    expect(samePrChange(git(), approved, head, 'main').ok).toBe(false);
  });

  it('fails an extra non-merge commit after the merge', () => {
    const approved = approvedThenMainMoves();
    mergeMain();
    write('c.txt', 'changed after the merge\n');
    const head = commit('a real change');
    expect(mergesOfBaseOnly(git(), approved, head, 'main')).toMatchObject({ ok: false, reason: expect.stringContaining('is not a merge') });
  });

  it('fails a non-merge commit hidden before the merge', () => {
    const approved = approvedThenMainMoves();
    write('c.txt', 'changed before the merge\n');
    commit('a real change');
    const head = mergeMain();
    expect(mergesOfBaseOnly(git(), approved, head, 'main').ok).toBe(false);
  });

  it('fails a merge of a branch that is not on main', () => {
    const approved = approvedThenMainMoves();
    sh('checkout', '-q', '-b', 'side', 'main');
    write('b.txt', 'side\n');
    commit('side');
    sh('checkout', '-q', 'pr');
    sh('merge', '-q', '--no-ff', '--no-edit', 'side');
    const head = sh('rev-parse', 'HEAD').trim();
    expect(mergesOfBaseOnly(git(), approved, head, 'main')).toMatchObject({ ok: false, reason: expect.stringContaining('not on main') });
  });

  it('fails when the approved commit is not behind the head', () => {
    const approved = approvedThenMainMoves();
    const head = sh('rev-parse', 'main').trim();
    expect(mergesOfBaseOnly(git(), approved, head, 'main').ok).toBe(false);
    expect(mergesOfBaseOnly(git(), approved, approved, 'main').ok).toBe(false);
    expect(mergesOfBaseOnly(git(), 'f'.repeat(40), head, 'main')).toMatchObject({ ok: false, reason: expect.stringContaining('not in this checkout') });
  });
});

const A = 'a'.repeat(40);
const review = (id: number, state: string, commit_id = A, login = BOT): Review => ({ id, state, commit_id, user: { login } });
const staleDismissal = (id: number, over: Partial<NonNullable<TimelineEvent['dismissed_review']>> = {}): TimelineEvent => ({
  event: 'review_dismissed',
  dismissed_review: { review_id: id, state: 'approved', dismissal_message: null, dismissal_commit_id: 'b'.repeat(40), ...over },
});

describe('merge-only: the standing approval', () => {
  it('accepts an approval that still stands, or one GitHub dismissed as stale on a push', () => {
    expect(standingApproval([review(1, 'APPROVED')], [], BOT)).toMatchObject({ ok: true, sha: A });
    expect(standingApproval([review(1, 'DISMISSED')], [staleDismissal(1)], BOT)).toMatchObject({ ok: true, sha: A });
  });

  it("goes by the bot's last formal review, ignoring comments and other reviewers", () => {
    const reviews = [review(3, 'COMMENTED'), review(1, 'APPROVED'), review(4, 'CHANGES_REQUESTED', A, 'someone')];
    expect(standingApproval(reviews, [], BOT)).toMatchObject({ ok: true });
    expect(standingApproval([review(1, 'APPROVED'), review(2, 'CHANGES_REQUESTED')], [], BOT)).toMatchObject({ ok: false, reason: expect.stringContaining('CHANGES_REQUESTED') });
  });

  it('refuses an approval a person or a later review dismissed', () => {
    expect(standingApproval([review(1, 'DISMISSED')], [staleDismissal(1, { dismissal_message: 'Not ready' })], BOT).ok).toBe(false);
    expect(standingApproval([review(1, 'DISMISSED')], [staleDismissal(1, { dismissal_commit_id: null })], BOT).ok).toBe(false);
    expect(standingApproval([review(1, 'DISMISSED')], [staleDismissal(1, { state: 'changes_requested' })], BOT).ok).toBe(false);
    expect(standingApproval([review(1, 'DISMISSED')], [], BOT).ok).toBe(false);
    expect(standingApproval([], [], BOT).ok).toBe(false);
  });
});

/** A fake GitHub holding one PR, recording what was posted. */
function fakeGitHub(head: string, over: { reviews?: Review[]; timeline?: TimelineEvent[]; open?: number } = {}) {
  const posted: { path: string; body: unknown }[] = [];
  const gh: GitHub = {
    get: async () => ({ head: { sha: head }, base: { ref: 'main' } }),
    list: async (path) => (path.endsWith('/reviews') ? over.reviews ?? [] : over.timeline ?? []),
    graphql: async () => ({ repository: { pullRequest: { reviewThreads: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: Array.from({ length: over.open ?? 0 }, () => ({ isResolved: false })).concat([{ isResolved: true }]),
    } } } }),
    post: async (path, body) => { posted.push({ path, body }); return {}; },
  };
  return { gh, posted };
}
const envFor = (head: string) => ({ REPO: 'imagile-dev/toil', PR_NUMBER: '7', HEAD_SHA: head, BOT_LOGIN: BOT, GITHUB_RUN_ID: '99' });

describe('merge-only: the whole decision', SLOW, () => {
  /** The remote-tracking ref the workflow compares against. */
  const originMain = () => sh('update-ref', 'refs/remotes/origin/main', 'main');

  it('approves the head, at the head, after a clean merge of a stale-dismissed approval', async () => {
    const approved = approvedThenMainMoves();
    const head = mergeMain();
    originMain();
    const { gh, posted } = fakeGitHub(head, { reviews: [{ ...review(5, 'DISMISSED'), commit_id: approved }], timeline: [staleDismissal(5)] });
    const outcome = await run({ env: envFor(head), gh, git: git() });
    expect(outcome).toMatchObject({ approved: true });
    expect(posted).toEqual([{ path: '/repos/imagile-dev/toil/pulls/7/reviews', body: {
      commit_id: head, event: 'APPROVE',
      body: expect.stringMatching(new RegExp(`^Merge of main only; the PR's own changes are identical to the approved ${approved}\\.[\\s\\S]*actions/runs/99$`)),
    } }]);
    expect(summary(outcome)).toContain('Re-approved without an agent review');
  });

  it('skips the agent, posting nothing, when GitHub kept the approval on the head after a clean merge', async () => {
    approvedThenMainMoves();
    const head = mergeMain();
    originMain();
    const { gh, posted } = fakeGitHub(head, { reviews: [{ ...review(5, 'APPROVED'), commit_id: head }] });
    const outcome = await run({ env: envFor(head), gh, git: git() });
    expect(outcome).toMatchObject({ approved: true, reason: expect.stringContaining('GitHub kept the approval on the head') });
    expect(posted).toEqual([]);
  });

  it('reviews in full when an approval kept on the head follows a merge that changed the PR, or no merge', async () => {
    approvedThenMainMoves();
    sh('merge', '-q', '--no-ff', '--no-commit', 'main');
    write('c.txt', 'slipped into the merge\n');
    const head = commit('Merge main');
    originMain();
    const kept = fakeGitHub(head, { reviews: [{ ...review(5, 'APPROVED'), commit_id: head }] });
    expect(await run({ env: envFor(head), gh: kept.gh, git: git() })).toMatchObject({ approved: false });

    write('c.txt', 'a real change\n');
    const real = commit('a real change');
    const notMerge = fakeGitHub(real, { reviews: [{ ...review(6, 'APPROVED'), commit_id: real }] });
    expect(await run({ env: envFor(real), gh: notMerge.gh, git: git() })).toMatchObject({ approved: false, reason: expect.stringContaining('is not a merge') });
  });

  it('posts nothing on a dry run', async () => {
    const approved = approvedThenMainMoves();
    const head = mergeMain();
    originMain();
    const { gh, posted } = fakeGitHub(head, { reviews: [{ ...review(5, 'APPROVED'), commit_id: approved }] });
    expect(await run({ env: envFor(head), gh, git: git(), dryRun: true })).toMatchObject({ approved: true });
    expect(posted).toEqual([]);
  });

  it('leaves it to the full review when a thread is open, the head moved, or the diff changed', async () => {
    const approved = approvedThenMainMoves();
    const head = mergeMain();
    originMain();
    const reviews = [{ ...review(5, 'APPROVED'), commit_id: approved }];

    const open = fakeGitHub(head, { reviews, open: 1 });
    expect(await run({ env: envFor(head), gh: open.gh, git: git() })).toMatchObject({ approved: false, reason: '1 review thread is open' });

    const moved = fakeGitHub('c'.repeat(40), { reviews });
    expect(await run({ env: envFor(head), gh: moved.gh, git: git() })).toMatchObject({ approved: false });

    write('c.txt', 'more\n');
    const changed = commit('a real change');
    const real = fakeGitHub(changed, { reviews });
    const outcome = await run({ env: envFor(changed), gh: real.gh, git: git() });
    expect(outcome).toMatchObject({ approved: false });
    expect(summary(outcome)).toContain('Full review needed');
    expect([open, moved, real].flatMap((f) => f.posted)).toEqual([]);
  });

  it('refuses inputs that are not what the workflow passes', async () => {
    const { gh } = fakeGitHub(A);
    await expect(run({ env: { ...envFor(A), HEAD_SHA: 'main' }, gh, git: git() })).rejects.toThrow(/HEAD_SHA/);
    await expect(run({ env: { ...envFor(A), PR_NUMBER: '0' }, gh, git: git() })).rejects.toThrow(/PR_NUMBER/);
  });
});

describe('merge-only: the GitHub client', () => {
  it('follows every page of a list and sends the token as a bearer header', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      const next = url.includes('page=2') ? {} : { link: '<https://api.github.test/repos/o/r/pulls/1/reviews?per_page=100&page=2>; rel="next"' };
      return new Response(JSON.stringify([{ id: seen.length }]), { status: 200, headers: next });
    }) as typeof fetch;
    const gh = github({ token: 'test-token', api: 'https://api.github.test', fetcher });
    expect(await gh.list('/repos/o/r/pulls/1/reviews')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(seen.map((s) => s.url)).toEqual([
      'https://api.github.test/repos/o/r/pulls/1/reviews?per_page=100',
      'https://api.github.test/repos/o/r/pulls/1/reviews?per_page=100&page=2',
    ]);
    expect(seen.every((s) => s.auth === 'Bearer test-token')).toBe(true);
  });

  it('fails plainly on an error status', async () => {
    const fetcher = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    await expect(github({ token: 't', fetcher }).get('/repos/o/r/pulls/1')).rejects.toThrow(/returned 502: nope/);
  });
});
