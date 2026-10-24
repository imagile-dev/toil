import { failure, type Envelope } from './envelope.js';
import { ToilError } from './errors.js';

/**
 * The oldest patched release on each Node line toil runs on, kept in step with
 * "engines" in package.json (`^24.22.1 || >=26.12.1`).
 *
 * 24.14 was the floor first: it's the first release where the OS certificate
 * store and the proxy env vars can be switched on from code
 * (`src/core/network.ts`). The floor now also has to be a release patched for
 * CVE-2026-111497, the Brotli decoder's out-of-bounds write (#479): Node's
 * fetch() Brotli-decodes any response marked `Content-Encoding: br`, so every
 * host toil talks to could reach it. 24.22.1 and 26.12.1 fix it; Node 25 gets
 * no fix, so it's refused outright, and a line newer than the last one listed
 * here is allowed.
 *
 * npm only warns about "engines", so the CLI checks for itself before doing
 * anything, the way a form checks the applicant is eligible before reading the rest.
 */
export const PATCHED_NODE = ['24.22.1', '26.12.1'] as const;

/** The lowest Node toil accepts, the first entry of PATCHED_NODE. */
export const MIN_NODE = PATCHED_NODE[0];

/** The CVE the floor answers, named in the refusal so the reason is on screen (principle 4). */
export const NODE_CVE = 'CVE-2026-111497';

const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

/** True when `a` is older than `b`, both `24.22.1`-shaped. */
function older(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/**
 * True when toil refuses `version` (`24.22.0`, with or without a `v`): older
 * than its line's patched release, on a line between the listed ones with no
 * patched release (25), or older than the lowest line.
 */
export function nodeRefused(version: string, patched: readonly string[] = PATCHED_NODE): boolean {
  const have = parse(version);
  const floors = patched.map(parse);
  const sameLine = floors.find((f) => f[0] === have[0]);
  if (sameLine) return older(have, sameLine);
  const newest = floors[floors.length - 1] ?? [0];
  return (have[0] ?? 0) < (newest[0] ?? 0);
}

/** The one envelope toil prints on a Node it refuses, or undefined when the Node is supported. */
export function unsupportedNode(version: string, toilVersion: string): Envelope | undefined {
  if (!nodeRefused(version)) return undefined;
  const [line24, line26] = PATCHED_NODE;
  return failure(
    new ToilError(
      'UNSUPPORTED_NODE',
      `toil needs Node ${line24} or later on 24.x, or ${line26} or later, the releases that fix ${NODE_CVE} (a remote code execution in Node's Brotli decoder); this is ${version.replace(/^v/, '')}.`,
      {
        fix: `Install Node ${line24} or later on 24.x, or ${line26} or later (nodejs.org, or your organization's approved channel), then run toil again. Node 25 gets no fix.`,
      },
    ),
    { command: 'toil', durationMs: 0, version: toilVersion },
  );
}
