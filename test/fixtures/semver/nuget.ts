/**
 * NuGet's documented ordering and range examples, as `util semver`'s NuGet
 * conformance suite. From the "Package versioning" reference
 * (docs.microsoft.com-nuget, docs/concepts/Package-Versioning.md) and
 * NuGet.Client's own tests at the dev branch (Apache License 2.0):
 * test/NuGet.Core.Tests/NuGet.Versioning.Test/VersionComparerTests.cs and
 * VersionRangeTests.cs. Test data only; none of it ships.
 */

/** The reference's "SemVer 2.0 sorting" example, highest first. */
export const SEMVER2_SORTING = ['1.0.1', '1.0.1-zzz', '1.0.1-rc.10', '1.0.1-rc.2', '1.0.1-open', '1.0.1-beta', '1.0.1-alpha2', '1.0.1-alpha10', '1.0.1-aaa'];

/** The reference's "SemVer 1.0 sorting" example, highest first; SemVer 2.0 rules order it the same way. */
export const SEMVER1_SORTING = ['1.0.1', '1.0.1-zzz', '1.0.1-open', '1.0.1-beta05', '1.0.1-beta02', '1.0.1-beta', '1.0.1-alpha2', '1.0.1-alpha10', '1.0.1-aaa'];

/** The reference's version-range table: [notation, a version inside, a version outside], the two versions written here from its "Applied rule" column; null for the row it calls invalid. */
export const RANGE_TABLE: [string, string | null, string | null][] = [
  ['1.0', '1.0', '0.9'],
  ['[1.0,)', '1.0', '0.9'],
  ['(1.0,)', '1.0.1', '1.0'],
  ['[1.0]', '1.0', '1.0.1'],
  ['(,1.0]', '1.0', '1.0.1'],
  ['(,1.0)', '0.9', '1.0'],
  ['[1.0,2.0]', '2.0', '2.0.1'],
  ['(1.0,2.0)', '1.5', '2.0'],
  ['[1.0,2.0)', '1.0', '2.0'],
  ['(1.0)', null, null],
];

/** The reference's normalization rules: each pair is one version. */
export const NORMALIZED_EQUAL: [string, string][] = [
  ['1.00', '1.0'], ['1.01.1', '1.1.1'], ['1.00.0.1', '1.0.0.1'], ['1.0.0.0', '1.0.0'], ['1.0.01.0', '1.0.1'], ['1.0.7+r3456', '1.0.7'],
  ['1', '1.0.0.0'], ['1.0.0-alpha', '1.0.0-Alpha'],
];

/** VersionComparerTests: pairs equal under VersionComparer.Default. */
export const COMPARER_EQUAL: [string, string][] = [
  ['1.0.0', '1.0.0'], ['1.0.0-BETA', '1.0.0-beta'], ['1.0.0-BETA+AA', '1.0.0-beta+aa'], ['1.0.0-BETA.X.y.5.77.0+AA', '1.0.0-beta.x.y.5.77.0+aa'], ['1.0.0', '1.0.0+beta'],
  ['1.0', '1.0.0.0'], ['1.0+test', '1.0.0.0'], ['1.0.0.1-1.2.A', '1.0.0.1-1.2.a+A'], ['1.0.01', '1.0.1.0'],
];

/** VersionComparerTests.VersionComparisonDefaultNotEqualWithNuGetVersion: pairs not equal. (VersionComparisonDefaultNotEqual is left out: it compares the strings, not the versions.) */
export const COMPARER_NOT_EQUAL: [string, string][] = [
  ['1.0', '1.0.0.1'], ['1.0+test', '1.0.0.1'], ['1.0.0.1-1.2.A', '1.0.0.1-1.2.a.A+A'], ['1.0.01', '1.0.1.2'],
];

/** VersionComparerTests.VersionComparisonDefaultLess: the first of each pair is lower. */
export const COMPARER_LESS: [string, string][] = [
  ['0.0.0', '1.0.0'], ['1.0.0', '1.1.0'], ['1.0.0', '1.0.1'], ['1.999.9999', '2.1.1'], ['1.0.0-BETA', '1.0.0-beta2'], ['1.0.0-beta+AA', '1.0.0+aa'],
  ['1.0.0-BETA', '1.0.0-beta.1+AA'], ['1.0.0-BETA.X.y.5.77.0+AA', '1.0.0-beta.x.y.5.79.0+aa'], ['1.0.0-BETA.X.y.5.79.0+AA', '1.0.0-beta.x.y.5.790.0+abc'],
];

/** VersionRangeTests.ParseVersionRangeSatisfies. */
export const SATISFIES: [string, string][] = [
  ['1.0.0', '2.0.0'], ['[1.0.0, 2.0.0]', '2.0.0'], ['(2.0.0,)', '2.1.0'], ['[2.0.0]', '2.0.0'], ['(,2.0.0]', '2.0.0'], ['(,2.0.0]', '1.0.0'], ['[2.0.0, )', '2.0.0'],
  ['1.0.0', '1.0.0'], ['[1.0.0]', '1.0.0'], ['[1.0.0, 1.0.0]', '1.0.0'], ['[1.0.0, 2.0.0]', '1.0.0'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '1.0.0'],
  ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '1.0.0-beta+meta'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '2.0.0-beta'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '1.0.0+meta'],
  ['(1.0.0-beta+meta, 2.0.0-beta+meta)', '1.0.0'], ['(1.0.0-beta+meta, 2.0.0-beta+meta)', '2.0.0-alpha+meta'], ['(1.0.0-beta+meta, 2.0.0-beta+meta)', '2.0.0-alpha'],
  ['(, 2.0.0-beta+meta)', '2.0.0-alpha'],
];

/** VersionRangeTests.ParseVersionRangeDoesNotSatisfy. */
export const DOES_NOT_SATISFY: [string, string][] = [
  ['1.0.0', '0.0.0'], ['[1.0.0, 2.0.0]', '2.0.1'], ['[1.0.0, 2.0.0]', '0.0.0'], ['[1.0.0, 2.0.0]', '3.0.0'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '1.0.0-alpha'],
  ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '1.0.0-alpha+meta'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '2.0.0-rc'], ['[1.0.0-beta+meta, 2.0.0-beta+meta]', '2.0.0+meta'],
  ['(1.0.0-beta+meta, 2.0.0-beta+meta)', '2.0.0-beta+meta'], ['(, 2.0.0-beta+meta)', '2.0.0-beta+meta'],
];

/** VersionRangeTests.VersionRange_MissingVersionComponents_DefaultToZero: each pair is one range. */
export const SAME_RANGE: [string, string][] = [['0', '0.0'], ['1', '1.0.0'], ['02', '2.0.0.0'], ['123.456', '123.456.0.0'], ['[2021,)', '[2021.0.0.0,)'], ['[,2021)', '[,2021.0.0.0)']];
