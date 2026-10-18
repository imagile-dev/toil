import { describe, expect, it } from 'vitest';
import { comparisons, equality, increments, invalidVersions, rangeExclude, rangeInclude, rangeParse, validVersions } from '../../../test/fixtures/semver/node-semver.js';
import type { RangeOptions, Release } from '../versions.js';
import { npmGrammar as npm, type NpmVersion } from './npm.js';

/**
 * npm conformance: node-semver's own tables (test/fixtures/semver), run
 * whole. A row node-semver runs in loose mode is set aside, and counted,
 * because loose mode is the coercion `util semver` refuses on purpose; a row
 * with an identifier base (`inc`'s sixth argument) likewise, because `bump`
 * doesn't take one. Every other row has to pass as node-semver has it.
 */

interface Options {
  loose: boolean;
  options: RangeOptions;
}

/** node-semver's parseOptions: `true` or a truthy `loose` is loose mode, `includePrerelease` passes through, anything else is the default. */
function optionsOf(raw: unknown): Options {
  if (raw === true) return { loose: true, options: {} };
  if (raw && typeof raw === 'object' && !(raw instanceof RegExp)) {
    const o = raw as { loose?: unknown; includePrerelease?: unknown };
    return { loose: Boolean(o.loose), options: o.includePrerelease ? { includePrerelease: true } : {} };
  }
  return { loose: false, options: {} };
}

const version = (text: string): NpmVersion => {
  const parsed = npm.parse(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.reason}`);
  return parsed.value;
};

/** satisfies, held to the interval cross-check on every call. */
function satisfies(range: string, v: string, options: RangeOptions): boolean {
  const parsed = npm.parseRange(range, options);
  if (!parsed.ok) throw new Error(`${range}: ${parsed.reason}`);
  const answer = npm.satisfies(parsed.value, version(v), options);
  const crossCheck = npm.intervals(parsed.value).some((i) => npm.inInterval(i, version(v), options));
  expect(crossCheck, `intervals of ${range} disagree on ${v}`).toBe(answer);
  return answer;
}

describe('npm conformance: node-semver range-include', () => {
  const rows = rangeInclude.filter((r) => !optionsOf(r[2]).loose);
  it(`includes the version in every strict-mode row (${rows.length} of ${rangeInclude.length}; the rest are loose mode)`, () => {
    for (const [range, v, raw] of rows) expect(satisfies(range as string, v as string, optionsOf(raw).options), `${String(range)} ∋ ${String(v)}`).toBe(true);
    expect(rows.length).toBe(120);
  });
});

describe('npm conformance: node-semver range-exclude', () => {
  const rows = rangeExclude.filter((r) => !optionsOf(r[2]).loose);
  it(`excludes the version in every strict-mode row, and reports a version that isn't one (${rows.length} of ${rangeExclude.length})`, () => {
    let invalid = 0;
    for (const [range, v, raw] of rows) {
      if (typeof v !== 'string' || !npm.parse(v).ok) {
        // node-semver answers false; here the version is reported as not a version.
        invalid++;
        continue;
      }
      expect(satisfies(range as string, v, optionsOf(raw).options), `${String(range)} ∌ ${v}`).toBe(false);
    }
    expect(invalid).toBe(3);
  });
});

describe('npm conformance: node-semver range-parse', () => {
  const rows = rangeParse.filter((r) => !optionsOf(r[2]).loose);
  it(`normalises every strict-mode range as node-semver's validRange does, and refuses the invalid ones (${rows.length} of ${rangeParse.length})`, () => {
    for (const [range, expected, raw] of rows) {
      const parsed = npm.parseRange(range as string, optionsOf(raw).options);
      if (expected === null) expect(parsed.ok, `${String(range)} is not a range`).toBe(false);
      else {
        expect(parsed.ok, `${String(range)}: ${parsed.ok ? '' : parsed.reason}`).toBe(true);
        if (parsed.ok) expect(npm.formatRange(parsed.value), String(range)).toBe(expected);
      }
    }
  });
});

describe('npm conformance: node-semver comparisons and equality', () => {
  it('orders every strict-mode pair, both ways round', () => {
    const rows = comparisons.filter((r) => !optionsOf(r[2]).loose);
    expect(rows.length).toBe(19);
    for (const [a, b] of rows) {
      expect(npm.compare(version(a as string), version(b as string)), `${String(a)} > ${String(b)}`).toBe(1);
      expect(npm.compare(version(b as string), version(a as string)), `${String(b)} < ${String(a)}`).toBe(-1);
    }
  });

  it('treats every strict-mode equal pair as equal: build metadata never counts', () => {
    const rows = equality.filter((r) => !optionsOf(r[2]).loose);
    expect(rows.length).toBe(3);
    for (const [a, b] of rows) expect(npm.compare(version(a as string), version(b as string)), `${String(a)} = ${String(b)}`).toBe(0);
  });
});

describe('npm conformance: node-semver valid and invalid versions', () => {
  it('parses every valid version into its parts', () => {
    for (const [v, major, minor, patch, pre, build] of validVersions) {
      const parsed = version(v as string);
      expect([parsed.major, parsed.minor, parsed.patch, parsed.prerelease, parsed.build]).toEqual([major, minor, patch, (pre as unknown[]).map(String), build]);
    }
  });

  it('reports every invalid string with a reason, never coercing it', () => {
    const strings = invalidVersions.filter((r) => typeof r[0] === 'string');
    expect(strings.length).toBe(7);
    for (const [v] of strings) {
      const parsed = npm.parse(v as string);
      expect(parsed.ok, String(v)).toBe(false);
      if (!parsed.ok) expect(parsed.reason).not.toBe('');
    }
  });
});

describe('npm conformance: node-semver increments', () => {
  const rows = increments
    .map((r) => {
      // inc(version, release, options, identifier, base): a string in the options place is the identifier.
      const [v, release, result] = r;
      let [, , , options, identifier, base] = r;
      if (typeof options === 'string') [base, identifier, options] = [identifier, options, undefined];
      return { v: v as string, release: release as string, result: result as string | null, options, identifier: identifier as string | undefined, base };
    })
    .filter((r) => !optionsOf(r.options).loose && r.base === undefined);

  it(`bumps as node-semver's inc does on every strict-mode row without an identifier base (${rows.length} of ${increments.length})`, () => {
    expect(rows.length).toBe(96);
    for (const { v, release, result, identifier } of rows) {
      const parsed = npm.parse(v);
      const bumped = parsed.ok && npm.releases.includes(release as Release) ? npm.bump(parsed.value, release as Release, identifier || undefined) : undefined;
      const got = bumped?.ok ? npm.format(bumped.value) : null;
      expect(got, `inc(${v}, ${release}, ${identifier ?? ''})`).toBe(result);
    }
  });
});

describe('SemVer 2.0.0 itself', () => {
  it('orders the precedence example in §11', () => {
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    const shuffled = [...order].reverse();
    expect(shuffled.map(version).sort(npm.compare).map(npm.format)).toEqual(order);
    expect(npm.compare(version('1.0.0'), version('2.0.0'))).toBe(-1);
    expect(npm.compare(version('2.1.0'), version('2.1.1'))).toBe(-1);
  });

  it('ignores build metadata in precedence (§10) and keeps it out of the normalised version', () => {
    expect(npm.compare(version('1.0.0+20130313144700'), version('1.0.0'))).toBe(0);
    expect(npm.compare(version('1.0.0-beta+exp.sha.5114f85'), version('1.0.0-beta'))).toBe(0);
    expect(npm.format(version('1.0.0-beta+exp.sha.5114f85'))).toBe('1.0.0-beta');
  });

  // The test strings semver.org lists beside its regular expression (FAQ, "Is there a suggested regular expression?").
  const valid = [
    '0.0.4', '1.2.3', '10.20.30', '1.1.2-prerelease+meta', '1.1.2+meta', '1.1.2+meta-valid', '1.0.0-alpha', '1.0.0-beta', '1.0.0-alpha.beta',
    '1.0.0-alpha.beta.1', '1.0.0-alpha.1', '1.0.0-alpha0.valid', '1.0.0-alpha.0valid', '1.0.0-alpha-a.b-c-somethinglong+build.1-aef.1-its-okay',
    '1.0.0-rc.1+build.1', '2.0.0-rc.1+build.123', '1.2.3-beta', '10.2.3-DEV-SNAPSHOT', '1.2.3-SNAPSHOT-123', '1.0.0', '2.0.0', '1.1.7',
    '2.0.0+build.1848', '2.0.1-alpha.1227', '1.0.0-alpha+beta', '1.2.3----RC-SNAPSHOT.12.9.1--.12+788', '1.2.3----R-S.12.9.1--.12+meta',
    '1.2.3----RC-SNAPSHOT.12.9.1--.12', '1.0.0+0.build.1-rc.10000aaa-kk-0.1', '1.0.0-0A.is.legal',
  ];
  const invalid = [
    '1', '1.2', '1.2.3-0123', '1.2.3-0123.0123', '1.1.2+.123', '+invalid', '-invalid', '-invalid+invalid', '-invalid.01', 'alpha', 'alpha.beta',
    'alpha.beta.1', 'alpha.1', 'alpha+beta', 'alpha_beta', 'alpha.', 'alpha..', 'beta', '1.0.0-alpha_beta', '-alpha.', '1.0.0-alpha..',
    '1.0.0-alpha..1', '1.0.0-alpha...1', '01.1.1', '1.01.1', '1.1.01', '1.2.3.DEV', '1.2-SNAPSHOT', '1.2.31.2.3----RC-SNAPSHOT.12.09.1--..12+788',
    '1.2-RC-SNAPSHOT', '-1.0.3-gamma+b7718', '+justmeta', '9.8.7+meta+meta', '9.8.7-whatever+meta+meta',
  ];

  it('accepts every string semver.org lists as valid and refuses every one it lists as invalid', () => {
    for (const v of valid) expect(npm.parse(v).ok, v).toBe(true);
    for (const v of invalid) expect(npm.parse(v).ok, v).toBe(false);
  });

  it('refuses a major version past 2^53 rather than round it (semver.org lists 99999999999999999999999.999999999999999999.99999999999999999 as valid; node-semver refuses it too)', () => {
    expect(npm.parse('99999999999999999999999.999999999999999999.99999999999999999')).toMatchObject({ ok: false, reason: expect.stringContaining('larger than') });
  });

  it('compares numeric prerelease identifiers by value at any size', () => {
    expect(npm.compare(version('1.0.0-rc.99999999999999999999'), version('1.0.0-rc.100000000000000000000'))).toBe(-1);
    expect(npm.compare(version('1.0.0-rc.10'), version('1.0.0-rc.9'))).toBe(1);
  });
});

describe('npm diff', () => {
  it('names the most significant part that differs, or null when the versions are equal', () => {
    const d = (a: string, b: string) => npm.diff(version(a), version(b));
    expect([d('1.2.3', '2.0.0'), d('1.2.3', '1.3.0'), d('1.2.3', '1.2.4'), d('1.2.3-alpha', '1.2.3-beta'), d('1.2.3-alpha', '1.2.3'), d('1.2.3+a', '1.2.3+b')]).toEqual([
      'major', 'minor', 'patch', 'prerelease', 'prerelease', null,
    ]);
  });
});
