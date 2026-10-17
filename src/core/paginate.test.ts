import { describe, expect, it } from 'vitest';
import type { Page } from './envelope.js';
import { MAX_PAGES, paginate, type FetchedPage, type PageStyle } from './paginate.js';

/** A server with `n` numbered items, answering in whatever shape the style expects. */
function recorder(answer: (params: Record<string, string | number>) => FetchedPage) {
  const requests: Array<Record<string, string | number>> = [];
  return {
    requests,
    fetchPage: async (params: Record<string, string | number>) => {
      requests.push(params);
      return answer(params);
    },
  };
}

const range = (from: number, count: number, max: number) => Array.from({ length: Math.max(0, Math.min(count, max - from)) }, (_, i) => from + i);

describe('paginate', () => {
  it('offset: start/limit until total, as Jira search and comments page', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => (b as { values: number[] }).values, total: (b) => (b as { total: number }).total };
    const s = recorder((p) => ({ body: { values: range(Number(p.startAt), 2, 5), total: 5 } }));
    expect(await paginate(style, s.fetchPage)).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: null });
    expect(s.requests).toEqual([
      { startAt: 0, maxResults: 2 },
      { startAt: 2, maxResults: 2 },
      { startAt: 4, maxResults: 2 },
    ]);
  });

  it('offset with no total stops on an empty page (one extra request, as Jira sprints do)', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => b as number[] };
    const s = recorder((p) => ({ body: range(Number(p.startAt), 2, 3) }));
    expect((await paginate(style, s.fetchPage)).items).toEqual([0, 1, 2]);
    expect(s.requests.map((r) => r.startAt)).toEqual([0, 2, 3]);
  });

  it('page/per_page stops on a short page', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 2, items: (b) => b as number[] };
    const s = recorder((p) => ({ body: range((Number(p.page) - 1) * 2, 2, 5) }));
    expect((await paginate(style, s.fetchPage)).items).toEqual([0, 1, 2, 3, 4]);
    expect(s.requests).toEqual([
      { page: 1, per_page: 2 },
      { page: 2, per_page: 2 },
      { page: 3, per_page: 2 },
    ]);
  });

  it('isLastPage/nextPageStart, reading values by default', async () => {
    const style: PageStyle<number> = { kind: 'nextPageStart', startParam: 'start', limitParam: 'limit', pageSize: 2 };
    const s = recorder((p) => {
      const start = Number(p.start);
      const values = range(start, 2, 3);
      return { body: start + 2 >= 3 ? { values, isLastPage: true } : { values, isLastPage: false, nextPageStart: start + 2 } };
    });
    expect((await paginate(style, s.fetchPage)).items).toEqual([0, 1, 2]);
    expect(s.requests).toEqual([
      { start: 0, limit: 2 },
      { start: 2, limit: 2 },
    ]);
  });

  it('a continuation token in a response header, sent back as a query parameter', async () => {
    const style: PageStyle<string> = { kind: 'header', header: 'x-ms-continuationtoken', param: 'continuationToken', items: (b) => (b as { value: string[] }).value, params: { $top: 2 } };
    const s = recorder((p) => (p.continuationToken === 't2' ? { body: { value: ['c'] }, headers: new Headers() } : { body: { value: ['a', 'b'] }, headers: new Headers({ 'x-ms-continuationtoken': 't2' }) }));
    expect((await paginate(style, s.fetchPage)).items).toEqual(['a', 'b', 'c']);
    expect(s.requests).toEqual([{ $top: 2 }, { $top: 2, continuationToken: 't2' }]);
  });

  it('nextPageKey: later requests send only the key', async () => {
    const style: PageStyle<string> = { kind: 'nextPageKey', items: (b) => (b as { problems: string[] }).problems, params: { pageSize: 2, from: 'now-1h' } };
    const s = recorder((p) => (p.nextPageKey ? { body: { problems: ['c'] } } : { body: { problems: ['a', 'b'], nextPageKey: 'k1' } }));
    expect((await paginate(style, s.fetchPage)).items).toEqual(['a', 'b', 'c']);
    expect(s.requests).toEqual([{ pageSize: 2, from: 'now-1h' }, { nextPageKey: 'k1' }]);
  });

  it('a cap stops the loop, cuts the page short, and reports the exact offset to resume from in meta.page', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => b as number[] };
    const s = recorder((p) => ({ body: range(Number(p.startAt), 2, 100) }));
    let page: Page | undefined;
    const result = await paginate(style, s.fetchPage, { cap: 3, setPage: (p) => (page = p) });
    expect(result).toEqual({ items: [0, 1, 2], nextCursor: '3' });
    expect(page).toEqual({ nextCursor: '3', limit: 3 });
    expect(s.requests).toHaveLength(2);
    // Carrying on from the cursor picks up exactly where it stopped.
    expect((await paginate(style, s.fetchPage, { cap: 2, cursor: '3' })).items).toEqual([3, 4]);
  });

  it('a cap that lands on the last item reports no next cursor', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 2, items: (b) => b as number[] };
    const s = recorder((p) => ({ body: range((Number(p.page) - 1) * 2, 2, 3) }));
    let page: Page | undefined;
    expect(await paginate(style, s.fetchPage, { cap: 3, setPage: (p) => (page = p) })).toEqual({ items: [0, 1, 2], nextCursor: null });
    expect(page).toEqual({ nextCursor: null, limit: 3 });
  });

  it('a cap inside a token page resumes at that page, repeating rather than losing items', async () => {
    const style: PageStyle<string> = { kind: 'nextPageKey', items: (b) => (b as { v: string[] }).v };
    const s = recorder((p) => (p.nextPageKey === 'k1' ? { body: { v: ['c', 'd'], nextPageKey: 'k2' } } : { body: { v: ['a', 'b'], nextPageKey: 'k1' } }));
    expect(await paginate(style, s.fetchPage, { cap: 3 })).toEqual({ items: ['a', 'b', 'c'], nextCursor: 'k1' });
    expect(await paginate(style, s.fetchPage, { cap: 1 })).toEqual({ items: ['a'], nextCursor: '' });
  });

  it('stops when a server hands back the cursor it was given', async () => {
    const style: PageStyle<string> = { kind: 'nextPageKey', items: (b) => (b as { v: string[] }).v };
    const s = recorder(() => ({ body: { v: ['a'], nextPageKey: 'same' } }));
    expect((await paginate(style, s.fetchPage)).items).toEqual(['a', 'a']);
    expect(s.requests).toHaveLength(2);
  });

  it('refuses a cap that is not a positive whole number', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'p', sizeParam: 's', pageSize: 1, items: () => [] };
    await expect(paginate(style, async () => ({ body: [] }), { cap: 0 })).rejects.toThrow(/positive whole number/);
  });

  it('gives up after MAX_PAGES on a server that ignores the start parameter', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => b as number[] };
    const s = recorder(() => ({ body: [1, 2] }));
    await expect(paginate(style, s.fetchPage, { what: 'Jira sprints' })).rejects.toMatchObject({ code: 'HTTP', message: `Paging Jira sprints didn't end after ${MAX_PAGES} pages; toil stopped.` });
    expect(s.requests).toHaveLength(MAX_PAGES);
  });

  it('refuses a cursor that is not a number for a numeric style, before any request', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => b as number[] };
    const s = recorder(() => ({ body: [] }));
    await expect(paginate(style, s.fetchPage, { cursor: 'abc' })).rejects.toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('meta.page.nextCursor') });
    expect(s.requests).toHaveLength(0);
  });
});
