/**
 * The version comparison `outdated` uses, kept exactly as the canonical
 * implementation had it: leading non-digits dropped, missing or non-numeric
 * parts read as 0, a release above its prereleases, and prereleases compared
 * as plain text. It is not the semver specification, which is why it is not
 * called that in any document requiring a signature.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  preRelease: string;
}

function parse(v: string): ParsedVersion {
  const clean = v.replace(/^[^0-9]*/, '');
  const dashIdx = clean.indexOf('-');
  const plusIdx = clean.indexOf('+');
  const metaStart = plusIdx > -1 ? plusIdx : Infinity;
  const preStart = dashIdx > -1 && dashIdx < metaStart ? dashIdx : Infinity;
  const numeric = clean.slice(0, Math.min(preStart, metaStart));
  const preRelease = preStart < Infinity ? clean.slice(preStart + 1, metaStart < Infinity ? metaStart : undefined) : '';
  const parts = numeric.split('.').map((n) => parseInt(n, 10) || 0);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0, preRelease };
}

/** Negative, zero or positive, like an Array.sort comparator. */
export function compareSemver(a: string, b: string): number {
  const av = parse(a);
  const bv = parse(b);
  if (av.major !== bv.major) return av.major - bv.major;
  if (av.minor !== bv.minor) return av.minor - bv.minor;
  if (av.patch !== bv.patch) return av.patch - bv.patch;
  if (!av.preRelease && bv.preRelease) return 1;
  if (av.preRelease && !bv.preRelease) return -1;
  if (av.preRelease && bv.preRelease) return av.preRelease.localeCompare(bv.preRelease);
  return 0;
}

export function isNewer(current: string, latest: string): boolean {
  return compareSemver(latest, current) > 0;
}

export function updateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
  const cv = parse(current);
  const lv = parse(latest);
  if (lv.major > cv.major) return 'major';
  if (lv.minor > cv.minor) return 'minor';
  return 'patch';
}
