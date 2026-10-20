/**
 * The version comparison `artifactory package outdated` and `util deps diff` use,
 * kept exactly as the canonical implementation had it: leading non-digits
 * dropped, missing or non-numeric parts read as 0, a release above its
 * prereleases, and prereleases compared as plain text. It is not the semver
 * specification, which is why it is not called that in any document requiring
 * a signature.
 *
 * It lives in core so toil has one comparison: `util semver` (#180) starts
 * from it and adds the ecosystems' own grammars beside it, without changing
 * what these callers get.
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

// ---------------------------------------------------------------------------
// The ecosystems' own grammars: npm's semver, NuGet's and Maven's.
//
// The comparison above is pinned to what its callers recorded, quirks and
// all, so it stays exactly as it is. What `util semver` (#180) needs is each
// ecosystem's real rules: SemVer 2.0.0 precedence and npm's ranges for
// npm, NuGet's four-part versions and interval notation, and Maven's
// ordering and version ranges. Each is one module
// under ./versions/, loaded only when asked for, so `artifactory package outdated`
// pays nothing for grammars it never reads. A version comparison is one of
// the few things in an enterprise that has a written standard; there are
// three of them.
// ---------------------------------------------------------------------------

export const ECOSYSTEMS = ['npm', 'nuget', 'maven'] as const;
export type VersionEcosystem = (typeof ECOSYSTEMS)[number];

/** A parse that worked, or why it didn't. Nothing is ever coerced into a version. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One end of an interval of versions. */
export interface Bound<V> {
  version: V;
  inclusive: boolean;
}

/**
 * A range as the plain intervals it covers, for the cross-check: no bound is
 * open on that side. `prereleaseOf` (npm only) lists the `major.minor.patch`
 * whose prereleases the interval admits; every other prerelease is outside
 * it unless prereleases are included.
 */
export interface Interval<V> {
  lower?: Bound<V>;
  upper?: Bound<V>;
  prereleaseOf?: string[];
}

export interface RangeOptions {
  /** npm only: let prereleases of any version match, as npm's `includePrerelease`. */
  includePrerelease?: boolean;
}

export const RELEASES = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease', 'release'] as const;
export type Release = (typeof RELEASES)[number];

/** The most significant part two versions differ in. */
export type Difference = 'major' | 'minor' | 'patch' | 'revision' | 'prerelease' | 'qualifier';

/**
 * One ecosystem's versions and ranges. The methods are written as methods so
 * a grammar typed for its own version shape is usable where the version is
 * opaque (`VersionGrammar<unknown, unknown>`), which is how `util semver`
 * holds whichever one was asked for.
 */
export interface VersionGrammar<V, R> {
  ecosystem: VersionEcosystem;
  parse(text: string): Parsed<V>;
  /** The version as the ecosystem normalises it. */
  format(version: V): string;
  /** Negative, zero or positive, like an Array.sort comparator. */
  compare(a: V, b: V): number;
  parseRange(text: string, options: RangeOptions): Parsed<R>;
  /** The range as the ecosystem normalises it. */
  formatRange(range: R): string;
  satisfies(range: R, version: V, options: RangeOptions): boolean;
  intervals(range: R): Interval<V>[];
  /** Whether `version` lies in `interval`, by comparison alone: the cross-check for {@link satisfies}. */
  inInterval(interval: Interval<V>, version: V, options: RangeOptions): boolean;
  /** The bumps this ecosystem has. */
  releases: readonly Release[];
  bump(version: V, release: Release, preid?: string): Parsed<V>;
  /** The most significant part `a` and `b` differ in, or null when they're equal. */
  diff(a: V, b: V): Difference | null;
}

export type AnyGrammar = VersionGrammar<unknown, unknown>;

/** The grammar for `ecosystem`, loaded on first use. */
export async function grammarFor(ecosystem: VersionEcosystem): Promise<AnyGrammar> {
  switch (ecosystem) {
    case 'npm':
      return (await import('./versions/npm.js')).npmGrammar;
    case 'nuget':
      return (await import('./versions/nuget.js')).nugetGrammar;
    case 'maven':
      return (await import('./versions/maven.js')).mavenGrammar;
  }
}
