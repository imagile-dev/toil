import { describe, expect, it } from 'vitest';
import { AGENT_MARK, events, idsOf, type Seen, type Snapshot } from '../scripts/pr-watch.mjs';

/** The ship skill's PR watcher decides what wakes the agent. A watcher that sleeps through a review is worse than none. */

const HEAD = 'abc1234def';
const quiet = (over: Partial<Snapshot> = {}): Snapshot => ({
  state: 'OPEN', head: HEAD, mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
  reviews: [], threads: [], comments: [], rollup: 'SUCCESS',
  checks: [{ name: 'test', done: true, failed: false }],
  ...over,
});
const none: Seen = { reviews: [], comments: [], threadComments: [] };
const kinds = (s: Snapshot, seen = none) => events(s, seen).map((e) => e.kind);

describe('pr-watch events', () => {
  it('is quiet when nothing new happened', () => {
    const s = quiet({ reviews: [{ id: 1, state: 'CHANGES_REQUESTED', body: 'fix it', commit: 'old' }] });
    expect(kinds(s, idsOf(s))).toEqual([]);
  });

  it('reports a new review, but not a draft or an empty wrapper for inline comments', () => {
    const s = quiet({ reviews: [
      { id: 1, state: 'CHANGES_REQUESTED', body: 'fix it' },
      { id: 2, state: 'PENDING', body: 'draft' },
      { id: 3, state: 'COMMENTED', body: '' },
    ] });
    expect(events(s, none)).toEqual([expect.objectContaining({ kind: 'review', id: 1 })]);
  });

  it('reports a reply on a resolved thread, with the thread id for resolving', () => {
    const s = quiet({ threads: [{ id: 'T1', resolved: true, path: 'a.ts', last: { id: 9, body: 'not quite' } }] });
    expect(events(s, none)).toEqual([expect.objectContaining({ kind: 'inline-comment', id: 9, thread: 'T1', resolved: true })]);
  });

  it("never wakes on the agent's own replies, whoever's account posted them", () => {
    const reply = `Fixed in abc.\n\n_🤖 ${AGENT_MARK}(https://claude.com/claude-code)_`;
    const s = quiet({
      threads: [{ id: 'T1', resolved: false, path: 'a.ts', last: { id: 9, body: reply } }],
      comments: [{ id: 5, body: reply }],
    });
    expect(kinds(s)).toEqual([]);
  });

  it('reports a person\'s comment once', () => {
    const s = quiet({ comments: [{ id: 5, body: 'can we rename this?' }] });
    expect(kinds(s)).toEqual(['comment']);
    expect(kinds(s, idsOf(s))).toEqual([]);
  });

  it('reports failing checks and conflicts every time, even ones there at start', () => {
    const s = quiet({ rollup: 'FAILURE', mergeable: 'CONFLICTING', checks: [{ name: 'lint', done: true, failed: true }] });
    expect(events(s, idsOf(s))).toEqual([{ kind: 'checks-failed', failing: ['lint'] }, { kind: 'conflict' }]);
  });

  it('is ready only when approved at the head, green, with no open thread', () => {
    const approved = { reviewDecision: 'APPROVED', reviews: [{ id: 1, state: 'APPROVED', body: 'ok', commit: HEAD }] };
    expect(kinds(quiet(approved), { ...none, reviews: [1] })).toEqual(['ready']);
    expect(kinds(quiet({ ...approved, reviews: [{ id: 1, state: 'APPROVED', body: 'ok', commit: 'older' }] }), { ...none, reviews: [1] })).toEqual([]);
    expect(kinds(quiet({ ...approved, rollup: 'PENDING' }), { ...none, reviews: [1] })).toEqual([]);
    const open = { threads: [{ id: 'T', resolved: false, path: 'a', last: { id: 2, body: 'x' } }] };
    expect(kinds(quiet({ ...approved, ...open }), { ...none, reviews: [1], threadComments: [2] })).toEqual([]);
  });

  it('reports an approval and readiness together, so ready needs no extra cycle', () => {
    const s = quiet({ reviewDecision: 'APPROVED', reviews: [{ id: 1, state: 'APPROVED', body: 'ok', commit: HEAD }] });
    expect(kinds(s)).toEqual(['review', 'ready']);
  });

  it('reports a merged or closed PR and nothing else', () => {
    expect(kinds(quiet({ state: 'MERGED', comments: [{ id: 5, body: 'x' }] }))).toEqual(['merged']);
  });
});
