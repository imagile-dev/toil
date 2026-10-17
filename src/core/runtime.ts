import { failure, type Envelope } from './envelope.js';
import { ToilError } from './errors.js';

/**
 * The oldest Node toil runs on, kept in step with "engines" in package.json.
 * 24.14 is the first release where the OS certificate store and the proxy
 * env vars can be switched on from code (`src/core/network.ts`). npm only
 * warns about "engines", so the CLI checks for itself before doing anything,
 * the way a form checks the applicant is eligible before reading the rest.
 */
export const MIN_NODE = '24.14.0';

/** True when `version` (`24.13.1`, with or without a `v`) is older than MIN_NODE. */
export function nodeTooOld(version: string, min = MIN_NODE): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const have = parse(version);
  const need = parse(min);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) < (need[i] ?? 0);
  }
  return false;
}

/** The one envelope toil prints on a Node below the floor, or undefined when the Node is new enough. */
export function unsupportedNode(version: string, toilVersion: string): Envelope | undefined {
  if (!nodeTooOld(version)) return undefined;
  const short = MIN_NODE.replace(/\.0$/, '');
  return failure(
    new ToilError('UNSUPPORTED_NODE', `toil needs Node ${short} or later; this is ${version.replace(/^v/, '')}.`, {
      fix: `Install Node ${short} or later (nodejs.org, or your organization's approved channel), then run toil again.`,
    }),
    { command: 'toil', durationMs: 0, version: toilVersion },
  );
}
