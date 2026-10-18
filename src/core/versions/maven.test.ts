import { describe, expect, it } from 'vitest';
import { CONTAINS, EQUAL, INVALID_RANGES, LEADING_ZEROES, LOWER, MNG_7644, PARSED, VERSIONS_NUMBER, VERSIONS_QUALIFIER, ZEROES } from '../../../test/fixtures/semver/maven.js';
import { canonical, itemsOf, mavenGrammar as maven, type MavenVersion } from './maven.js';

/** Maven conformance: Apache Maven 3.9's ComparableVersionTest and VersionRangeTest (test/fixtures/semver/maven.ts). */

const version = (text: string): MavenVersion => {
  const parsed = maven.parse(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.reason}`);
  // Every test in ComparableVersionTest also holds the canonical form to a round trip.
  const c = canonical(parsed.value.items);
  expect(canonical(itemsOf(c)), `canonical(${text})`).toBe(c);
  return parsed.value;
};

const cmp = (a: string, b: string) => maven.compare(version(a), version(b));

function checkOrder(list: string[]) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      expect(cmp(list[i]!, list[j]!), `${list[i]} < ${list[j]}`).toBe(-1);
      expect(cmp(list[j]!, list[i]!), `${list[j]} > ${list[i]}`).toBe(1);
    }
  }
}

describe('Maven conformance: ComparableVersionTest', () => {
  it('orders VERSIONS_QUALIFIER and VERSIONS_NUMBER, every pair both ways', () => {
    checkOrder(VERSIONS_QUALIFIER);
    checkOrder(VERSIONS_NUMBER);
  });

  it('holds every testVersionsEqual pair equal, aliases and case included', () => {
    for (const [a, b] of EQUAL) {
      expect(cmp(a, b), `${a} = ${b}`).toBe(0);
      expect(cmp(b, a), `${b} = ${a}`).toBe(0);
    }
  });

  it('orders the testVersionComparing pairs and the MNG-5568, MNG-6572 and MNG-6964 edge cases', () => {
    for (const [a, b] of LOWER) {
      expect(cmp(a, b), `${a} < ${b}`).toBe(-1);
      expect(cmp(b, a), `${b} > ${a}`).toBe(1);
    }
  });

  it('reads leading zeroes away at every length (MNG-6572)', () => {
    for (const list of [LEADING_ZEROES, ZEROES]) for (const a of list) for (const b of list) expect(cmp(a, b), `${a} = ${b}`).toBe(0);
  });

  it('puts 1.0.0.X1 below 1.0.0-X2, and 2-X, 2.0.X and 2.0.0.X together (MNG-7644)', () => {
    for (const x of MNG_7644) {
      expect(cmp(`1.0.0.${x}1`, `1.0.0-${x}2`), x).toBe(-1);
      expect(cmp(`2-${x}`, `2.0.${x}`), x).toBe(0);
      expect(cmp(`2-${x}`, `2.0.0.${x}`), x).toBe(0);
      expect(cmp(`2.0.${x}`, `2.0.0.${x}`), x).toBe(0);
    }
  });

  it('gives the canonical forms Maven prints', () => {
    const c = (v: string) => maven.format(version(v));
    expect([c('1.0.0'), c('1.0-SNAPSHOT'), c('1-ga'), c('1.0.0.FINAL'), c('1a1'), c('2.0.1-xyz')]).toEqual(['1', '1-snapshot', '1', '1', '1-alpha-1', '2.0.1-xyz']);
  });
});

describe('Maven conformance: VersionRangeTest', () => {
  it('parses each testRange spec into its restrictions and recommended version', () => {
    for (const [spec, restrictions, recommended] of PARSED) {
      const parsed = maven.parseRange(spec, {});
      expect(parsed.ok, spec).toBe(true);
      if (!parsed.ok) continue;
      const shape = parsed.value.restrictions.map((r) => [r.lower?.version.raw ?? null, r.lower?.inclusive ?? false, r.upper?.version.raw ?? null, r.upper?.inclusive ?? false]);
      expect(shape, spec).toEqual(restrictions);
      expect(parsed.value.recommended?.raw ?? null, spec).toBe(recommended);
    }
  });

  it('answers containsVersion as Maven does, and the intervals agree', () => {
    for (const [spec, v, contained] of CONTAINS) {
      const parsed = maven.parseRange(spec, {});
      if (!parsed.ok) throw new Error(spec);
      expect(maven.satisfies(parsed.value, version(v), {}), `${spec} ${contained ? '∋' : '∌'} ${v}`).toBe(contained);
      expect(maven.intervals(parsed.value).some((i) => maven.inInterval(i, version(v), {}))).toBe(contained);
    }
  });

  it('refuses every testInvalidRanges spec with a reason', () => {
    for (const spec of INVALID_RANGES) {
      const parsed = maven.parseRange(spec, {});
      expect(parsed.ok, spec).toBe(false);
    }
  });

  it('reads a bare version as a soft requirement any version satisfies, and prints it back', () => {
    const parsed = maven.parseRange('1.0', {});
    if (!parsed.ok) throw new Error('1.0');
    expect([maven.satisfies(parsed.value, version('0.1'), {}), maven.satisfies(parsed.value, version('9.9'), {}), maven.formatRange(parsed.value)]).toEqual([true, true, '1.0']);
    const sets = maven.parseRange('(,1.0],[1.2,)', {});
    expect(sets.ok && maven.formatRange(sets.value)).toBe('(,1.0],[1.2,)');
  });
});

describe('Maven versions toil refuses to order', () => {
  it('reports text that is not a version, with a reason, rather than ordering it', () => {
    for (const bad of ['', ' 1.0', '1.0 ', '1 0', '[1.0]', '1.0,2.0', '${project.version}', 'SNAPSHOT', 'final']) {
      const parsed = maven.parse(bad);
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('Maven bump and diff', () => {
  it('bumps the leading numbers and drops the qualifier', () => {
    const b = (v: string, r: 'major' | 'minor' | 'patch') => {
      const out = maven.bump(version(v), r);
      return out.ok ? out.value.raw : out.reason;
    };
    expect([b('1.2.3-SNAPSHOT', 'major'), b('1.2.3-SNAPSHOT', 'minor'), b('1.2-SNAPSHOT', 'patch'), b('2.0.0.Final', 'minor'), b('5', 'minor')]).toEqual(['2.0.0', '1.3.0', '1.2.1', '2.1.0', '5.1']);
    expect(maven.bump(version('r03'), 'major')).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't start with a number") });
  });

  it('names the part two versions differ in', () => {
    const d = (a: string, b: string) => maven.diff(version(a), version(b));
    expect([d('1.0', '2.0'), d('1.1', '1.2'), d('1.2.3', '1.2.4'), d('1.2.3.4', '1.2.3.5'), d('1.0-SNAPSHOT', '1.0'), d('1.0', '1.0.0.GA')]).toEqual(['major', 'minor', 'patch', 'revision', 'qualifier', null]);
  });
});
