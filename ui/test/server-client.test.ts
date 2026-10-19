import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpExecute, signIn, type Session } from '../src/server-client.ts';

/**
 * The page's side of the session: it trades the launch token for a session id
 * held in memory, takes the token out of the address bar, and sends the id as
 * a header (never relying on a cookie) on every call. fetch is stubbed.
 */

const SESSION: Session = { session: 'sid-1', csrf: 'csrf-1', version: '0.0.0', toil: { version: '0.1.0-alpha.2', contractVersion: 1 }, viewer: { id: 'local', name: 'you' }, store: 'fixture', agent: 'scripted', sample: true, now: '2026-10-13T08:00:00.000Z' };

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
