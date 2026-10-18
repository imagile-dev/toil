import { describe, expect, it } from 'vitest';
import {
  COMPARER_EQUAL,
  COMPARER_LESS,
  COMPARER_NOT_EQUAL,
  DOES_NOT_SATISFY,
  NORMALIZED_EQUAL,
  RANGE_TABLE,
  SAME_RANGE,
  SATISFIES,
  SEMVER1_SORTING,
  SEMVER2_SORTING,
} from '../../../test/fixtures/semver/nuget.js';
import { nugetGrammar as nuget, type NuGetRange, type NuGetVersion } from './nuget.js';

/** NuGet conformance: the "Package versioning" reference and NuGet.Versioning's own tests (test/fixtures/semver/nuget.ts). */

const version = (text: string): NuGetVersion => {
  const parsed = nuget.parse(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.reason}`);
  return parsed.value;
};

const range = (text: string): NuGetRange => {
  const parsed = nuget.parseRange(text, {});
  if (!parsed.ok) throw new Error(`${text}: ${parsed.reason}`);
  return parsed.value;
};

const cmp = (a: string, b: string) => nuget.compare(version(a), version(b));

/** satisfies, held to the interval cross-check on every call. */
function satisfies(r: string, v: string): boolean {
  const answer = nuget.satisfies(range(r), version(v), {});
  expect(nuget.intervals(range(r)).some((i) => nuget.inInterval(i, version(v), {})), `intervals of ${r} on ${v}`).toBe(answer);
  return answer;
}

describe('NuGet conformance: the Package versioning reference', () => {
  it('sorts both of its sorting examples as it shows them', () => {
    for (const list of [SEMVER2_SORTING, SEMVER1_SORTING]) {
      const sorted = [...list].reverse().map(version).sort(nuget.compare).reverse().map(nuget.format);
      expect(sorted).toEqual(list);
    }
  });

  it('answers each row of its version-range table, and refuses (1.0)', () => {
    for (const [notation, inside, outside] of RANGE_TABLE) {
      if (inside === null || outside === null) {
        expect(nuget.parseRange(notation, {}).ok, notation).toBe(false);
        continue;
      }
      expect(satisfies(notation, inside), `${notation} ∋ ${inside}`).toBe(true);
      expect(satisfies(notation, outside), `${notation} ∌ ${outside}`).toBe(false);
    }
  });

  it('normalises as it describes: leading zeros, a zero fourth part and build metadata all drop out', () => {
    for (const [a, b] of NORMALIZED_EQUAL) expect(cmp(a, b), `${a} = ${b}`).toBe(0);
    expect(['1.00', '1.01.1', '1.00.0.1', '1.0.0.0', '1.0.01.0', '1.0.7+r3456'].map((v) => nuget.format(version(v)))).toEqual(['1.0.0', '1.1.1', '1.0.0.1', '1.0.0', '1.0.1', '1.0.7']);
  });
});

describe('NuGet conformance: VersionComparerTests', () => {
  it('holds the equal pairs equal and the others apart, both ways round', () => {
    for (const [a, b] of COMPARER_EQUAL) expect([cmp(a, b), cmp(b, a)], `${a} = ${b}`).toEqual([0, 0]);
    for (const [a, b] of COMPARER_NOT_EQUAL) expect(cmp(a, b), `${a} ≠ ${b}`).not.toBe(0);
    for (const [a, b] of COMPARER_LESS) expect([cmp(a, b), cmp(b, a)], `${a} < ${b}`).toEqual([-1, 1]);
  });
});

describe('NuGet conformance: VersionRangeTests', () => {
  it('satisfies and fails to satisfy as ParseVersionRangeSatisfies and ParseVersionRangeDoesNotSatisfy have it', () => {
    for (const [r, v] of SATISFIES) expect(satisfies(r, v), `${r} ∋ ${v}`).toBe(true);
    for (const [r, v] of DOES_NOT_SATISFY) expect(satisfies(r, v), `${r} ∌ ${v}`).toBe(false);
  });

  it('defaults missing version parts to zero', () => {
    for (const [a, b] of SAME_RANGE) expect(nuget.formatRange(range(a)), `${a} = ${b}`).toBe(nuget.formatRange(range(b)));
  });

  it('prints its normalized range', () => {
    expect(['1.0', '[1.0]', '(,2.0.0-beta+meta)', '[1.0.0-beta, 2.0.0)', '[1.0.0, 1.0.0]'].map((r) => nuget.formatRange(range(r)))).toEqual([
      '[1.0.0, )', '[1.0.0]', '(, 2.0.0-beta)', '[1.0.0-beta, 2.0.0)', '[1.0.0]',
    ]);
  });
});

describe('NuGet versions and ranges toil refuses', () => {
  it('refuses a version longer than 256 characters', () => {
    expect(nuget.parse(`1.0.0-${'a'.repeat(250)}`).ok).toBe(true);
    expect(nuget.parse(`1.0.0-${'a'.repeat(251)}`)).toEqual({ ok: false, reason: 'longer than 256 characters' });
  });

  it('reports what is not a NuGet version, with a reason', () => {
    for (const bad of ['', '1.', '.1', '1..0', '1.0.0.0.0', 'a.b', '1.0-', '1.0+', '1.0.0-01', '1.0.0-beta..1', '1.0.0-beta_1', '1.0.0+meta..x', '2147483648.0']) {
      expect(nuget.parse(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses invalid ranges as VersionRange.TryParse does, and floating versions with a fix', () => {
    for (const bad of ['(1.0)', '[1.0)', '(1.0]', '(,]', '[1.0,2.0,3.0]', '[2.0,1.0]', '(1.0,1.0]', '[1.0,2.0', 'abc']) expect(nuget.parseRange(bad, {}).ok, bad).toBe(false);
    expect(nuget.parseRange('1.*', {})).toMatchObject({ ok: false, reason: expect.stringContaining('interval notation') });
  });
});

describe('NuGet bump and diff', () => {
  it('bumps to three parts and drops the revision and labels', () => {
    const b = (v: string, r: 'major' | 'minor' | 'patch') => {
      const out = nuget.bump(version(v), r);
      return out.ok ? nuget.format(out.value) : out.reason;
    };
    expect([b('1.2.3.4', 'major'), b('1.2.3-beta', 'minor'), b('1.2', 'patch')]).toEqual(['2.0.0', '1.3.0', '1.2.1']);
  });

  it('names the part two versions differ in', () => {
    const d = (a: string, b: string) => nuget.diff(version(a), version(b));
    expect([d('1.0', '2.0'), d('1.0', '1.1'), d('1.0.0', '1.0.1'), d('1.0.0.1', '1.0.0.2'), d('1.0.0-a', '1.0.0-b'), d('1.0', '1.0.0.0'), d('1.0.0-A', '1.0.0-a')]).toEqual([
      'major', 'minor', 'patch', 'revision', 'prerelease', null, null,
    ]);
  });
});
