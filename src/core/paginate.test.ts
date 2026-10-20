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
    expect(await paginate(style, s.fetchPage)).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: null, total: 5 });
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

  it('offset reads total from an empty page too, so asking for none (--max-results 0) still counts the matches', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 0, items: (b) => (b as { issues: number[] }).issues, total: (b) => (b as { total: number }).total };
    const s = recorder(() => ({ body: { issues: [], total: 42 } }));
    expect(await paginate(style, s.fetchPage)).toEqual({ items: [], nextCursor: null, total: 42 });
    expect(s.requests).toEqual([{ startAt: 0, maxResults: 0 }]);
  });

  it('offset reports the last total a page gave, and none when no page gave one', async () => {
    const style: PageStyle<number> = { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => (b as { values: number[] }).values, total: (b) => (b as { total?: number }).total };
    const s = recorder((p) => ({ body: { values: range(Number(p.startAt), 2, 3), ...(Number(p.startAt) === 0 ? { total: 3 } : {}) } }));
    expect(await paginate(style, s.fetchPage)).toEqual({ items: [0, 1, 2], nextCursor: null, total: 3 });
    const none = recorder(() => ({ body: { values: [] } }));
    expect(await paginate(style, none.fetchPage)).toEqual({ items: [], nextCursor: null });
  });

  it('page with total stops once the items read reach it, never on a short page (SonarQube p/ps/total)', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'p', sizeParam: 'ps', pageSize: 500, items: (b) => (b as { issues: number[] }).issues, total: (b) => (b as { total: number }).total };
    // A server that caps ps at 2: every page is short, and only the total says when to stop.
    const s = recorder((p) => ({ body: { issues: range((Number(p.p) - 1) * 2, 2, 5), total: 5 } }));
    expect(await paginate(style, s.fetchPage, { what: 'SonarQube issues' })).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: null, total: 5 });
    expect(s.requests).toEqual([
      { p: 1, ps: 500 },
      { p: 2, ps: 500 },
      { p: 3, ps: 500 },
    ]);
  });

  it('page with total stops on an empty page short of the total, and keeps going while the total is missing', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'p', sizeParam: 'ps', pageSize: 2, items: (b) => (b as { issues: number[] }).issues, total: (b) => (b as { total?: number }).total };
    const short = recorder((p) => ({ body: { issues: range((Number(p.p) - 1) * 2, 2, 3), total: 10 } }));
    expect((await paginate(style, short.fetchPage)).items).toEqual([0, 1, 2]);
    expect(short.requests.map((r) => r.p)).toEqual([1, 2, 3]);
    const untold = recorder((p) => ({ body: { issues: range(Number(p.p) - 1, 1, 2) } }));
    expect((await paginate(style, untold.fetchPage)).items).toEqual([0, 1]);
    expect(untold.requests.map((r) => r.p)).toEqual([1, 2, 3]);
  });

  it('page with total, resumed from a cursor, carries the count so short pages lose nothing', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'p', sizeParam: 'ps', pageSize: 500, items: (b) => (b as { issues: number[] }).issues, total: (b) => (b as { total: number }).total };
    // A server that caps ps at 2 under pageSize 500, so every page, the middle ones too, is short.
    const s = recorder((p) => ({ body: { issues: range((Number(p.p) - 1) * 2, 2, 5), total: 5 } }));
    const first = await paginate(style, s.fetchPage, { cap: 2 });
    expect(first.items).toEqual([0, 1]);
    const rest = await paginate(style, s.fetchPage, { cursor: first.nextCursor! });
    expect(rest).toEqual({ items: [2, 3, 4], nextCursor: null, total: 5 });
    expect(s.requests.map((r) => r.p)).toEqual([1, 2, 3]);

    // Cut inside a short middle page, then resumed: the count before that page travels too.
    const t = recorder((p) => ({ body: { issues: range((Number(p.p) - 1) * 2, 2, 5), total: 5 } }));
    const mid = await paginate(style, t.fetchPage, { cap: 3 });
    expect(mid.items).toEqual([0, 1, 2]);
    expect(await paginate(style, t.fetchPage, { cursor: mid.nextCursor! })).toEqual({ items: [3, 4], nextCursor: null, total: 5 });
    expect(t.requests.map((r) => r.p)).toEqual([1, 2, 2, 3]);
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

  it('keep filters each page after the short-page check, and a capped cursor resumes in kept items', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 4, items: (b) => b as number[] };
    const s = recorder((p) => ({ body: range((Number(p.page) - 1) * 4, 4, 10) }));
    const even = (n: number) => n % 2 === 0;
    // Page 1 is full though only two of its items are kept, so paging goes on.
    expect((await paginate(style, s.fetchPage, { keep: even })).items).toEqual([0, 2, 4, 6, 8]);
    expect(s.requests).toHaveLength(3);
    const first = await paginate(style, s.fetchPage, { keep: even, cap: 3 });
    expect(first.items).toEqual([0, 2, 4]);
    const rest = await paginate(style, s.fetchPage, { keep: even, cursor: first.nextCursor as string });
    expect(rest).toEqual({ items: [6, 8], nextCursor: null });
  });

  it("keep on an offset style resumes at the next kept item's own offset, neither repeating nor skipping one", async () => {
    const style: PageStyle<number> = { kind: 'nextPageStart', startParam: 'start', limitParam: 'limit', pageSize: 4 };
    const s = recorder((p) => {
      const start = Number(p.start);
      const values = range(start, 4, 10);
      return { body: start + 4 >= 10 ? { values, isLastPage: true } : { values, isLastPage: false, nextPageStart: start + 4 } };
    });
    const odd = (n: number) => n % 2 === 1;
    expect((await paginate(style, s.fetchPage, { keep: odd })).items).toEqual([1, 3, 5, 7, 9]);
    // Page one holds 1 and 3; a cap of 1 stops after 1, and 3 sits at offset 3.
    const first = await paginate(style, s.fetchPage, { keep: odd, cap: 1 });
    expect(first).toEqual({ items: [1], nextCursor: '3' });
    const rest = await paginate(style, s.fetchPage, { keep: odd, cursor: '3' });
    expect(rest).toEqual({ items: [3, 5, 7, 9], nextCursor: null });
    const offset: PageStyle<number> = { kind: 'offset', startParam: 's', limitParam: 'l', pageSize: 4, items: (b) => b as number[] };
    const o = recorder((p) => ({ body: range(Number(p.s), 4, 10) }));
    const capped = await paginate(offset, o.fetchPage, { keep: odd, cap: 3 });
    expect(capped).toEqual({ items: [1, 3, 5], nextCursor: '7' });
    expect((await paginate(offset, o.fetchPage, { keep: odd, cursor: '7' })).items).toEqual([7, 9]);
  });

  it('stop ends paging after the page that holds a stopping item, before keep is applied', async () => {
    const style: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 3, items: (b) => b as number[] };
    // Newest first: 9 down to 0. Read back to 5, keeping only what is 5 or newer.
    const s = recorder((p) => ({ body: range((Number(p.page) - 1) * 3, 3, 10).map((n) => 9 - n) }));
    const since = (n: number) => n >= 5;
    const all = await paginate(style, s.fetchPage, { keep: since, stop: (n) => !since(n) });
    expect(all).toEqual({ items: [9, 8, 7, 6, 5], nextCursor: null });
    expect(s.requests).toHaveLength(2);
    const capped = await paginate(style, s.fetchPage, { keep: since, stop: (n) => !since(n), cap: 5, setPage: () => {} });
    expect(capped.nextCursor).toBeNull();
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

  it('a cap inside a token page, even the first, gives a non-empty cursor that resumes exactly', async () => {
    const style: PageStyle<string> = { kind: 'nextPageKey', items: (b) => (b as { v: string[] }).v };
    const s = recorder((p) =>
      p.nextPageKey === 'k2' ? { body: { v: ['e'] } } : p.nextPageKey === 'k1' ? { body: { v: ['c', 'd'], nextPageKey: 'k2' } } : { body: { v: ['a', 'b'], nextPageKey: 'k1' } },
    );
    const first = await paginate(style, s.fetchPage, { cap: 1 });
    expect(first.items).toEqual(['a']);
    expect(first.nextCursor).toBeTruthy();
    const second = await paginate(style, s.fetchPage, { cap: 2, cursor: first.nextCursor as string });
    expect(second.items).toEqual(['b', 'c']);
    expect(second.nextCursor).toBeTruthy();
    const rest = await paginate(style, s.fetchPage, { cursor: second.nextCursor as string });
    expect(rest).toEqual({ items: ['d', 'e'], nextCursor: null });
  });

  it('the same for a continuation header and a page number', async () => {
    const header: PageStyle<string> = { kind: 'header', header: 'x-next', param: 'token', items: (b) => b as string[] };
    const h = recorder((p) => (p.token ? { body: ['c'] } : { body: ['a', 'b', 'x'].slice(0, 2), headers: new Headers({ 'x-next': 't2' }) }));
    const cut = await paginate(header, h.fetchPage, { cap: 1 });
    expect(cut.nextCursor).toBeTruthy();
    expect((await paginate(header, h.fetchPage, { cursor: cut.nextCursor as string })).items).toEqual(['b', 'c']);

    const page: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 3, items: (b) => b as number[] };
    const g = recorder((p) => ({ body: range((Number(p.page) - 1) * 3, 3, 5) }));
    const cutPage = await paginate(page, g.fetchPage, { cap: 4 });
    expect(cutPage.items).toEqual([0, 1, 2, 3]);
    expect((await paginate(page, g.fetchPage, { cursor: cutPage.nextCursor as string })).items).toEqual([4]);
  });

  it('refuses a token cursor it did not hand out, and a page cursor whose page is not a number', async () => {
    const style: PageStyle<string> = { kind: 'nextPageKey', items: () => [] };
    await expect(paginate(style, async () => ({ body: {} }), { cursor: 'not-ours' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const page: PageStyle<number> = { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: 2, items: () => [] };
    const forged = Buffer.from(JSON.stringify({ c: 'abc', s: 0 })).toString('base64url');
    const s = recorder(() => ({ body: [] }));
    await expect(paginate(page, s.fetchPage, { cursor: forged })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(s.requests).toHaveLength(0);
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
