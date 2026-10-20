import { describe, expect, it } from 'vitest';
import { check, delayAfter, duration, packumentUrl, requestTimeoutMs, waitFor, waitSecondsFrom } from '../scripts/wait-for-npm.mjs';

/**
 * The release workflow's wait for npm to serve a toil it just published (#363).
 * Two releases in a row gave up after a minute; these hold the wait to its
 * backoff and deadline, and to checking what npm install actually needs.
 */

const REGISTRY = 'https://registry.npmjs.org/';
const TARBALL = 'https://registry.npmjs.org/@imagile-dev/toil/-/toil-1.0.0.tgz';
const packument = (versions: string[]) => ({
  'dist-tags': { latest: versions.at(-1) },
  versions: Object.fromEntries(versions.map((v) => [v, { dist: { tarball: TARBALL } }])),
});
const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A registry whose answers change by call number: `served(n)` says whether call n sees the version. */
function registry(served: (call: number) => boolean, tarballStatus = 200) {
  const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
  let checks = 0;
  const fetch = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    calls.push({ url, ...init });
    if (init.method === 'HEAD') return reply(tarballStatus);
    if (init.headers?.accept?.startsWith('application/vnd.npm.install-v1+json')) checks++;
    return reply(200, packument(served(checks) ? ['0.9.0', '1.0.0'] : ['0.9.0']));
  };
  return { fetch, calls };
}

describe('check', () => {
  it('asks for both packuments and the tarball, all past any cache', async () => {
    const { fetch, calls } = registry(() => true);
    await expect(check('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, fetch })).resolves.toMatchObject({ served: true });
    expect(calls.map((c) => [c.method ?? 'GET', c.url])).toEqual([
      ['GET', 'https://registry.npmjs.org/@imagile-dev%2ftoil'],
      ['GET', 'https://registry.npmjs.org/@imagile-dev%2ftoil'],
      ['HEAD', TARBALL],
    ]);
    expect(calls.every((c) => c.headers?.['cache-control'] === 'no-cache')).toBe(true);
  });

  it("shares one timeout across an attempt's three requests", async () => {
    const signals = new Set<unknown>();
    const { fetch } = registry(() => true);
    await check('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, timeoutMs: 5_000, fetch: async (url, init) => { signals.add((init as { signal?: unknown }).signal); return fetch(url, init); } });
    expect(signals.size).toBe(1);
    expect([...signals][0]).toBeInstanceOf(AbortSignal);
  });

  it("isn't served while the tarball doesn't download", async () => {
    const { fetch } = registry(() => true, 404);
    await expect(check('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, fetch })).resolves.toMatchObject({ served: false, detail: expect.stringContaining('HTTP 404') });
  });

  it('says what it saw instead of throwing, for a 404 or a network error', async () => {
    await expect(check('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, fetch: async () => reply(404) })).resolves.toEqual({ served: false, detail: 'install packument: HTTP 404' });
    const down = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
    await expect(check('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, fetch: down })).resolves.toEqual({ served: false, detail: 'install packument: getaddrinfo ENOTFOUND' });
  });
});

describe('waitFor', () => {
  const clock = () => {
    let t = 0;
    const slept: number[] = [];
    return { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms; }, slept };
  };

  it('returns at once when npm already serves it', async () => {
    const c = clock();
    const r = await waitFor('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, ...registry(() => true), waitSeconds: 900, log: () => {}, ...c });
    expect(r).toMatchObject({ served: true, attempts: 1 });
    expect(c.slept).toEqual([]);
  });

  it('backs off 10s, 20s, 40s, then every 60s, logging each attempt, until it shows', async () => {
    const c = clock();
    const lines: string[] = [];
    const r = await waitFor('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, ...registry((n) => n >= 6), waitSeconds: 900, log: (l) => lines.push(l), ...c });
    expect(r).toMatchObject({ served: true, attempts: 6 });
    expect(c.slept).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('Attempt 1: not yet (install packument lists no 1.0.0 (latest 0.9.0)). Next try in 10s.');
    expect(lines[5]).toMatch(/^Attempt 6: npm serves @imagile-dev\/toil 1\.0\.0 /);
  });

  it('gives up at the deadline, with its last sleep cut short to meet it', async () => {
    const c = clock();
    const r = await waitFor('@imagile-dev/toil', '1.0.0', { registry: REGISTRY, ...registry(() => false), waitSeconds: 45, log: () => {}, ...c });
    expect(r).toMatchObject({ served: false, attempts: 4 });
    expect(c.slept).toEqual([10_000, 20_000, 15_000]);
  });
});

describe('settings and wording', () => {
  it('waits 15 minutes unless NPM_WAIT_SECONDS says otherwise, and refuses a value that is not whole seconds', () => {
    expect(waitSecondsFrom({})).toBe(900);
    expect(waitSecondsFrom({ NPM_WAIT_SECONDS: '5' })).toBe(5);
    expect(() => waitSecondsFrom({ NPM_WAIT_SECONDS: '5m' })).toThrow('NPM_WAIT_SECONDS must be a whole number of seconds, not "5m".');
  });

  it('formats what it reports plainly', () => {
    expect([900, 60, 5, 0].map(duration)).toEqual(['15 minutes', '1 minute', '5 seconds', '0 seconds']);
    expect([1, 2, 3, 4, 9].map(delayAfter)).toEqual([10, 20, 40, 60, 60]);
  });

  it("gives each attempt 30s, or what's left of the wait, so a hung registry can't run far past the deadline", () => {
    expect([900_000, 30_000, 12_000, 0, -5_000].map(requestTimeoutMs)).toEqual([30_000, 30_000, 12_000, 1_000, 1_000]);
    expect(packumentUrl('https://npm.imagile.dev/repo/', 'left-pad')).toBe('https://npm.imagile.dev/repo/left-pad');
  });
});
