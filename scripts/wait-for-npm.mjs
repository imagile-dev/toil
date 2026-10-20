#!/usr/bin/env node
// Waits until the npm registry serves one version of one package, the way
// `npm install` and `npm view` will need it: both packuments list the version,
// and its tarball downloads. Used by the release workflow (#363), whose jobs
// after publish-toil need the toil it just published, which npm can take ten
// minutes or more to serve.
//
//   node scripts/wait-for-npm.mjs <package> <version>
//
// It asks with backoff (10s, 20s, 40s, then every 60s) until NPM_WAIT_SECONDS
// (default 900, 15 minutes) have passed, logs every attempt and what it saw,
// and exits 1 with a plain message if npm still doesn't serve it. Every request
// sends `Cache-Control: no-cache`, so a packument cached on the first try can't
// hide the version on all the later ones. The registry is npm_config_registry
// (or NPM_CONFIG_REGISTRY) when set, otherwise registry.npmjs.org.
// npm publishes no service-level agreement for when a new version shows up, so
// this script files its own: fifteen minutes, in writing.
import { pathToFileURL } from 'node:url';

export const DEFAULT_WAIT_SECONDS = 900;
const DELAYS_SECONDS = [10, 20, 40, 60];

/** The seconds to wait after the given attempt (1-based). */
export const delayAfter = (attempt) => DELAYS_SECONDS[Math.min(attempt, DELAYS_SECONDS.length) - 1];

/** `@scope/name` goes in the URL as `@scope%2fname`, as npm itself sends it. */
export const packumentUrl = (registry, pkg) => `${registry.replace(/\/+$/, '')}/${pkg.replace('/', '%2f')}`;

/** "15 minutes", "1 minute", "5 seconds". */
export const duration = (seconds) => {
  const [n, unit] = seconds > 0 && seconds % 60 === 0 ? [seconds / 60, 'minute'] : [seconds, 'second'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
};

const NO_CACHE = { 'cache-control': 'no-cache' };
// One request that hangs mustn't outlast the whole wait: each gets 30s, or what's
// left of the wait if that's less (at least 1s).
const REQUEST_TIMEOUT_MS = 30_000;
export const requestTimeoutMs = (leftMs) => Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, leftMs));
// The abbreviated packument is what npm install and npm ci resolve against; the
// full one is what npm view reads. A CDN can serve the two from different caches.
const PACKUMENTS = [
  ['install packument', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'],
  ['full packument', 'application/json'],
];

/**
 * One attempt. Resolves to `{ served, detail }`, never rejects: a network error
 * is one more reason it isn't served yet, and the deadline decides when to stop.
 */
export async function check(pkg, version, { registry, fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const url = packumentUrl(registry, pkg);
  const seen = [];
  let tarball;
  for (const [label, accept] of PACKUMENTS) {
    let res;
    try {
      res = await fetch(url, { headers: { ...NO_CACHE, accept }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      return { served: false, detail: `${label}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) return { served: false, detail: `${label}: HTTP ${res.status}` };
    let doc;
    try {
      doc = await res.json();
    } catch {
      return { served: false, detail: `${label}: not JSON` };
    }
    const entry = doc?.versions?.[version];
    if (!entry) return { served: false, detail: `${label} lists no ${version} (latest ${doc?.['dist-tags']?.latest ?? 'none'})` };
    tarball ??= entry.dist?.tarball;
    seen.push(`${label} lists it`);
  }
  if (!tarball) return { served: false, detail: `${seen.join(', ')}, but names no tarball` };
  let res;
  try {
    res = await fetch(tarball, { method: 'HEAD', headers: NO_CACHE, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { served: false, detail: `${seen.join(', ')}; tarball: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { served: false, detail: `${seen.join(', ')}; tarball ${tarball}: HTTP ${res.status}` };
  return { served: true, detail: `${seen.join(', ')}; tarball ${tarball}: HTTP ${res.status}` };
}

/**
 * Asks until it's served or `waitSeconds` have passed. Resolves to
 * `{ served, attempts, detail }`. `now` and `sleep` are injectable for tests.
 */
export async function waitFor(pkg, version, { registry, fetch, waitSeconds, log, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = now() + waitSeconds * 1000;
  for (let attempt = 1; ; attempt++) {
    const { served, detail } = await check(pkg, version, { registry, fetch, timeoutMs: requestTimeoutMs(deadline - now()) });
    const left = deadline - now();
    if (served) {
      log(`Attempt ${attempt}: npm serves ${pkg} ${version} (${detail}).`);
      return { served, attempts: attempt, detail };
    }
    if (left <= 0) {
      log(`Attempt ${attempt}: not yet (${detail}). Out of time.`);
      return { served, attempts: attempt, detail };
    }
    const wait = Math.min(delayAfter(attempt) * 1000, left);
    log(`Attempt ${attempt}: not yet (${detail}). Next try in ${Math.ceil(wait / 1000)}s.`);
    await sleep(wait);
  }
}

/** NPM_WAIT_SECONDS must be a whole number of seconds; anything else is a mistake worth saying so. */
export function waitSecondsFrom(env) {
  const raw = env.NPM_WAIT_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_WAIT_SECONDS;
  if (!/^\d+$/.test(raw)) throw new Error(`NPM_WAIT_SECONDS must be a whole number of seconds, not "${raw}".`);
  return Number(raw);
}

async function main(argv, env) {
  const [pkg, version, ...rest] = argv;
  if (!pkg || !version || rest.length) {
    console.error('Usage: node scripts/wait-for-npm.mjs <package> <version>');
    return 2;
  }
  let waitSeconds;
  try {
    waitSeconds = waitSecondsFrom(env);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const registry = env.npm_config_registry || env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/';
  console.log(`Waiting up to ${duration(waitSeconds)} for ${registry} to serve ${pkg} ${version}.`);
  const result = await waitFor(pkg, version, { registry, fetch, waitSeconds, log: (line) => console.log(line) });
  if (result.served) return 0;
  console.error(`npm still doesn't serve ${pkg} ${version} after ${duration(waitSeconds)} (${result.attempts} ${result.attempts === 1 ? 'attempt' : 'attempts'}). Last answer: ${result.detail}.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
