import { describe, expect, it } from 'vitest';
import { documentsFrom, isQuestion, mapOwi, outstandingQuestions, plainText, type Comment } from '../src/core/owi/index.js';

/**
 * OWI's optional `comments` (src/core/owi/comment.ts): Jira's `comment` field
 * read when the search asked for it, plain text only, and the rule a stand-up
 * uses for a question nobody has answered.
 */

const issue = (comment?: unknown) => ({
  key: 'SHOP-1',
  self: 'https://jira.imagile.dev/rest/api/2/issue/10001',
  fields: { summary: 'Thing', status: { name: 'To Do', statusCategory: { key: 'new' } }, ...(comment === undefined ? {} : { comment }) },
});
const map = (comment?: unknown) => {
  const { documents, skipped } = documentsFrom([{ ok: true, data: { issues: [issue(comment)] }, meta: { command: 'jira issue search', context: { connection: { value: 'jira' } } } }]);
  return mapOwi(documents, { skipped }).items[0]!;
};

describe('comments on a Jira issue', () => {
  it('are absent when the search did not ask for them, and empty when it did and there are none', () => {
    expect('comments' in map()).toBe(false);
    expect(map({ comments: [], total: 0 }).comments).toEqual([]);
  });

  it('keep the author, the time, the text as plain text and a link to the comment, oldest first', () => {
    const item = map({
      comments: [
        { id: '2', author: { name: 'bob', displayName: 'B. Jones' }, body: 'later', created: '2026-11-10T09:00:00.000+0000' },
        { id: '1', author: { accountId: 'abc12345', displayName: 'A. Chen', emailAddress: 'you@example.com' }, body: '*Bold* [~bob] see [the doc|https://x.imagile.dev/a] and {code}secret(){code} ok?', created: '2026-11-10T08:00:00.000+0000' },
      ],
    });
    expect(item.comments).toEqual([
      { id: '1', author: { id: 'abc12345', name: 'A. Chen', email: 'you@example.com' }, at: '2026-11-10T08:00:00.000Z', text: 'Bold @bob see the doc and ok?', url: 'https://jira.imagile.dev/browse/SHOP-1?focusedCommentId=1' },
      { id: '2', author: { id: 'bob', name: 'B. Jones', email: null }, at: '2026-11-10T09:00:00.000Z', text: 'later', url: 'https://jira.imagile.dev/browse/SHOP-1?focusedCommentId=2' },
    ]);
  });

  it('keep the newest 20 and cap a long text', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), author: { name: 'bob' }, body: i === 24 ? 'x'.repeat(900) : 'n', created: `2026-11-10T08:${String(i).padStart(2, '0')}:00.000+0000` }));
    const item = map({ comments: many });
    expect(item.comments).toHaveLength(20);
    expect(item.comments![0]!.id).toBe('6');
    expect(item.comments!.at(-1)!.text).toHaveLength(500);
  });

  it('are plain text: ADF is flattened, markup and control characters never reach the text', () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'mention', attrs: { text: '@bob' } }] }, { type: 'paragraph', content: [{ type: 'text', text: 'second?' }] }] };
    expect(plainText(adf)).toBe('First@bob second?');
    expect(Array.from(plainText(String.fromCharCode(97, 7, 98, 27) + '[31mred\r\nline')).every((ch) => ch.charCodeAt(0) >= 32)).toBe(true);
    expect(plainText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('outstanding questions', () => {
  const c = (id: string, who: string | null, at: string, text: string): Comment => ({ id, author: who ? { id: who, name: who, email: null } : null, at: `2026-11-10T${at}:00.000Z`, text, url: null });

  it('reads a question mark outside a link as a question', () => {
    expect(isQuestion('Can you look?')).toBe(true);
    expect(isQuestion('See https://x.imagile.dev/a?b=1 for details')).toBe(false);
    expect(isQuestion('Done.')).toBe(false);
  });

  it('are the questions with no later comment by anyone else', () => {
    expect(outstandingQuestions([c('1', 'ann', '08:00', 'Why?')]).map((x) => x.id)).toEqual(['1']);
    expect(outstandingQuestions([c('1', 'ann', '08:00', 'Why?'), c('2', 'bob', '09:00', 'Because.')])).toEqual([]);
    // Her own follow-up is a nudge, not an answer; both stay open.
    expect(outstandingQuestions([c('1', 'ann', '08:00', 'Why?'), c('2', 'ann', '09:00', 'Anyone? Hello?')]).map((x) => x.id)).toEqual(['1', '2']);
    // Another person's comment before the question does not answer it, and a question with no author can't be put to anyone.
    expect(outstandingQuestions([c('1', 'bob', '07:00', 'Note'), c('2', 'ann', '08:00', 'Why?'), c('3', null, '06:30', 'Why?')]).map((x) => x.id)).toEqual(['2']);
  });
});
