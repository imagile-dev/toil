import { describe, expect, it } from 'vitest';
import { compareSemver, isNewer, updateType } from './versions.js';

// The comparison artifactory package outdated and util deps diff have always used, pinned
// as it is, quirks included, so moving it to core changed nothing they see.
describe('versions', () => {
  it('orders by major, minor and patch, and puts a release above its prereleases', () => {
    const sorted = ['2.0.0', '1.10.0', '1.2.0', '1.2.0-rc.1', '1.2.0-beta', '0.9.9'].sort(compareSemver);
    expect(sorted).toEqual(['0.9.9', '1.2.0-beta', '1.2.0-rc.1', '1.2.0', '1.10.0', '2.0.0']);
  });

  it('drops leading non-digits, reads missing or non-numeric parts as 0, and ignores build metadata', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('^1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.x.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.2.3+build.5', '1.2.3')).toBe(0);
  });

  it('compares prereleases as plain text, not by semver precedence (the recorded behaviour)', () => {
    expect(compareSemver('1.0.0-rc.10', '1.0.0-rc.9')).toBeLessThan(0);
  });

  it('answers isNewer and updateType from the same parse', () => {
    expect(isNewer('1.2.3', '1.2.4')).toBe(true);
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(updateType('1.2.3', '2.0.0')).toBe('major');
    expect(updateType('1.2.3', '1.3.0')).toBe('minor');
    expect(updateType('1.2.3', '1.2.4')).toBe('patch');
    // Not newer at all still reads as a patch, as it always has.
    expect(updateType('2.0.0', '1.0.0')).toBe('patch');
  });
});
