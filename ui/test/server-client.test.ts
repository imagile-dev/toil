import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpAgent, httpExecute, signIn, type Session } from '../src/server-client.ts';

/**
 * The page's side of the session: it trades the launch token for a session id
 * held in memory, takes the token out of the address bar, and sends the id as
 * a header (never relying on a cookie) on every call. fetch is stubbed.
 */

const SESSION: Session = { session: 'sid-1', csrf: 'csrf-1', version: '0.0.0', toil: { version: '0.1.0-alpha.2', contractVersion: 1 }, viewer: { id: 'local', name: 'you' }, store: 'fixture', sync: false, agent: 'scripted', sample: true, now: '2026-10-13T08:00:00.000Z' };

afterEach(() => vi.unstubAllGlobals());

describe('signIn', () => {
  it('posts the launch token, then drops it from the URL', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(SESSION), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const replaceState = vi.fn();
    const session = await signIn('./', { search: '?token=abc', pathname: '/', hash: '#/dossier/x' }, { replaceState });
    expect(session.session).toBe('sid-1');
    expect(fetch).toHaveBeenCalledWith('./api/session', expect.objectContaining({ method: 'POST', credentials: 'omit', body: JSON.stringify({ token: 'abc' }) }));
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/dossier/x');
  });

  it('keeps a theme in the address while dropping the token (#277)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SESSION), { status: 200 })));
    const replaceState = vi.fn();
    await signIn('./', { search: '?token=abc&theme=realm&scheme=light', pathname: '/', hash: '#/' }, { replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?theme=realm&scheme=light#/');
  });

  it('says to open the launch URL again when the page has no token, as after a reload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(signIn('./', { search: '', pathname: '/', hash: '' }, { replaceState: vi.fn() })).rejects.toThrow(/open that URL again/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('httpExecute', () => {
  it('sends the session id and CSRF token as headers, and no cookie', async () => {
    const envelope = { ok: true, data: { dossiers: [] }, error: null, meta: { command: 'dossiers list', durationMs: 0, version: 'x', contractVersion: 1 } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await httpExecute(SESSION)('dossiers list', {}, { readOnly: true, caller: 'toil-ui' })).toEqual(envelope);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('./api/execute');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ 'X-Toil-UI-Session': 'sid-1', 'Content-Type': 'application/json', 'X-Toil-UI-CSRF': 'csrf-1' });
    expect(JSON.parse(String(init.body))).toEqual({ command: 'dossiers list', input: {} });
  });
});

describe('httpAgent streaming (#251)', () => {
  const answer = (text: string) => ({ prompt: 'q', parts: [{ text }], citations: [], by: 'Claude', proposals: [] });
  const ndjson = (lines: unknown[], split = 7) => {
    const text = lines.map((l) => `${JSON.stringify(l)}\n`).join('');
    // Chunks that cut lines in half, as a network does.
    const chunks = Array.from({ length: Math.ceil(text.length / split) }, (_, i) => text.slice(i * split, (i + 1) * split));
    return new Response(new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))), c.close()) }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  };

  it('asks with stream: true and yields each version of the answer, however the bytes arrive', async () => {
    const fetch = vi.fn(async () => ndjson([{ answer: answer('a') }, { answer: answer('ab') }, { done: true }]));
    vi.stubGlobal('fetch', fetch);
    const agent = await httpAgent({ ...SESSION, agent: 'claude' }, []);
    const seen = [];
    for await (const a of agent.stream!('card-payments', 'q')) seen.push(a.parts[0]!.text);
    expect(seen).toEqual(['a', 'ab']);
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ dossier: 'card-payments', prompt: 'q', stream: true });
  });

  it("throws the server's message and fix when the agent fails partway, and when the stream just stops", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ answer: answer('a') }, { error: { message: 'Claude Code stopped.', fix: 'Sign in.' } }])));
    const agent = await httpAgent({ ...SESSION, agent: 'claude' }, []);
    const run = async () => {
      for await (const _ of agent.stream!('d', 'q')) void _;
    };
    await expect(run()).rejects.toThrow('Claude Code stopped. Sign in.');
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ answer: answer('a') }])));
    await expect(run()).rejects.toThrow(/stopped partway/);
  });

  it('carries a notice naming the three adapters when the server has none', async () => {
    const agent = await httpAgent({ ...SESSION, agent: 'none' }, []);
    for (const p of ['@anthropic-ai/claude-agent-sdk', '@github/copilot-sdk', '@openai/codex-sdk']) expect(agent.notice).toContain(p);
  });
});
