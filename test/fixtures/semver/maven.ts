/**
 * Maven's documented ordering and range examples, as `util semver`'s Maven
 * conformance suite. Copied from Apache Maven's own tests at the
 * maven-3.9.x branch (Apache License 2.0):
 * maven-artifact/src/test/java/org/apache/maven/artifact/versioning/
 * ComparableVersionTest.java and VersionRangeTest.java. Test data only;
 * none of it ships.
 */

/** ComparableVersionTest.VERSIONS_QUALIFIER: each lower than every one after it. */
export const VERSIONS_QUALIFIER = [
  '1-alpha2snapshot', '1-alpha2', '1-alpha-123', '1-beta-2', '1-beta123', '1-m2', '1-m11', '1-rc', '1-cr2', '1-rc123', '1-SNAPSHOT', '1', '1-sp',
  '1-sp2', '1-sp123', '1-abc', '1-def', '1-pom-1', '1-1-snapshot', '1-1', '1-2', '1-123',
];

/** ComparableVersionTest.VERSIONS_NUMBER: each lower than every one after it. */
export const VERSIONS_NUMBER = [
  '2.0', '2.0.a', '2-1', '2.0.2', '2.0.123', '2.1.0', '2.1-a', '2.1b', '2.1-c', '2.1-1', '2.1.0.1', '2.2', '2.123', '11.a2', '11.a11', '11.b2',
  '11.b11', '11.m2', '11.m11', '11', '11.a', '11b', '11c', '11m',
];

/** testVersionsEqual: each pair equal. */
export const EQUAL: [string, string][] = [
  ['1', '1'], ['1', '1.0'], ['1', '1.0.0'], ['1.0', '1.0.0'], ['1', '1-0'], ['1', '1.0-0'], ['1.0', '1.0-0'],
  ['1a', '1-a'], ['1a', '1.0-a'], ['1a', '1.0.0-a'], ['1.0a', '1-a'], ['1.0.0a', '1-a'], ['1x', '1-x'], ['1x', '1.0-x'], ['1x', '1.0.0-x'], ['1.0x', '1-x'], ['1.0.0x', '1-x'],
  ['1ga', '1'], ['1release', '1'], ['1final', '1'], ['1cr', '1rc'],
  ['1a1', '1-alpha-1'], ['1b2', '1-beta-2'], ['1m3', '1-milestone-3'],
  ['1X', '1x'], ['1A', '1a'], ['1B', '1b'], ['1M', '1m'], ['1Ga', '1'], ['1GA', '1'], ['1RELEASE', '1'], ['1release', '1'], ['1RELeaSE', '1'],
  ['1Final', '1'], ['1FinaL', '1'], ['1FINAL', '1'], ['1Cr', '1Rc'], ['1cR', '1rC'], ['1m3', '1Milestone3'], ['1m3', '1MileStone3'], ['1m3', '1MILESTONE3'],
  ['1-abcdefghijklmnopqrstuvwxyz', '1-ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
];

/** testVersionComparing, MNG-5568, MNG-6572 and MNG-6964: the first of each pair is lower. */
export const LOWER: [string, string][] = [
  ['1', '2'], ['1.5', '2'], ['1', '2.5'], ['1.0', '1.1'], ['1.1', '1.2'], ['1.0.0', '1.1'], ['1.0.1', '1.1'], ['1.1', '1.2.0'],
  ['1.0-alpha-1', '1.0'], ['1.0-alpha-1', '1.0-alpha-2'], ['1.0-alpha-1', '1.0-beta-1'],
  ['1.0-beta-1', '1.0-SNAPSHOT'], ['1.0-SNAPSHOT', '1.0'], ['1.0-alpha-1-SNAPSHOT', '1.0-alpha-1'],
  ['1.0', '1.0-1'], ['1.0-1', '1.0-2'], ['1.0.0', '1.0-1'],
  ['2.0-1', '2.0.1'], ['2.0.1-klm', '2.0.1-lmn'], ['2.0.1', '2.0.1-xyz'],
  ['2.0.1', '2.0.1-123'], ['2.0.1-xyz', '2.0.1-123'],
  ['6.1.0rc3', '6.1.0'], ['6.1.0rc3', '6.1H.5-beta'], ['6.1.0', '6.1H.5-beta'],
  ['20190126.230843', '1234567890.12345'], ['1234567890.12345', '123456789012345.1H.5-beta'], ['20190126.230843', '123456789012345.1H.5-beta'],
  ['123456789012345.1H.5-beta', '12345678901234567890.1H.5-beta'], ['1234567890.12345', '12345678901234567890.1H.5-beta'], ['20190126.230843', '12345678901234567890.1H.5-beta'],
  ['1-0.alpha', '1'], ['1-0.beta', '1'], ['1-0.alpha', '1-0.beta'],
];

/** testVersionEqualWithLeadingZeroes and testVersionZeroEqualWithLeadingZeroes: every one equal to the others. */
export const LEADING_ZEROES = Array.from({ length: 19 }, (_, i) => '0'.repeat(18 - i) + '1');
export const ZEROES = Array.from({ length: 19 }, (_, i) => '0'.repeat(19 - i));

/** testMng7644, for each x: 1.0.0.X1 < 1.0.0-X2, and 2-X = 2.0.X = 2.0.0.X. */
export const MNG_7644 = ['abc', 'alpha', 'a', 'beta', 'b', 'def', 'milestone', 'm', 'RC'];

/**
 * [spec, version, contained]. The first three are VersionRangeTest's own
 * containsVersion assertions; the rest test each side of the bounds its
 * testRange asserts for the same specs, written here.
 */
export const CONTAINS: [string, string, boolean][] = [
  ['[1.0,)', '1.0-SNAPSHOT', false],
  ['[1.0,1.1-SNAPSHOT]', '1.1-SNAPSHOT', true],
  ['[5.0.9.0,5.0.10.0)', '5.0.9.0', true],
  ['(,1.0]', '1.0', true],
  ['(,1.0]', '1.0.1', false],
  ['[1.0]', '1.0', true],
  ['[1.0]', '1.0.1', false],
  ['[1.2,1.3]', '1.3', true],
  ['[1.2,1.3]', '1.1', false],
  ['[1.0,2.0)', '2.0', false],
  ['[1.0,2.0)', '1.9', true],
  ['[1.5,)', '1.5', true],
  ['[1.5,)', '1.4', false],
  ['(,1.0],[1.2,)', '1.1', false],
  ['(,1.0],[1.2,)', '1.2', true],
  ['(,1.0],[1.2,)', '0.9', true],
];

/** VersionRangeTest.testRange: [spec, restrictions as [lower, lowerInclusive, upper, upperInclusive], recommended]. */
export const PARSED: [string, [string | null, boolean, string | null, boolean][], string | null][] = [
  ['(,1.0]', [[null, false, '1.0', true]], null],
  ['1.0', [[null, false, null, false]], '1.0'],
  ['[1.0]', [['1.0', true, '1.0', true]], null],
  ['[1.2,1.3]', [['1.2', true, '1.3', true]], null],
  ['[1.0,2.0)', [['1.0', true, '2.0', false]], null],
  ['[1.5,)', [['1.5', true, null, false]], null],
  ['(,1.0],[1.2,)', [[null, false, '1.0', true], ['1.2', true, null, false]], null],
];

/** VersionRangeTest.testInvalidRanges. */
export const INVALID_RANGES = ['(1.0)', '[1.0)', '(1.0]', '(1.0,1.0]', '[1.0,1.0)', '(1.0,1.0)', '[1.1,1.0]', '[1.0,1.2),1.3', '[1.0,1.2),(1.1,1.3]', '[1.1,1.3),(1.0,1.2]', '(1.1,1.2],[1.0,1.1)'];
