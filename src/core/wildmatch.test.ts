import { describe, expect, it } from 'vitest';
import { isIgnored, parseIgnore } from './gitignore.js';
import { wildmatch } from './wildmatch.js';

// git's glob dialect, case by case, from its own documentation. The
// documentation is the standard; the standard is the documentation.
describe('wildmatch', () => {
  const m = (pattern: string, path: string, options = {}) => wildmatch(pattern, options).test(path);

  it('keeps *, ? and classes inside one path segment', () => {
    expect(m('*.log', 'a.log')).toBe(true);
    expect(m('*.log', 'dir/a.log')).toBe(false);
    expect(m('a?c', 'abc')).toBe(true);
    expect(m('a?c', 'a/c')).toBe(false);
    expect(m('[a-c]x', 'bx')).toBe(true);
    expect(m('[!a-c]x', 'dx')).toBe(true);
    expect(m('[!a-c]x', '/x')).toBe(false);
    expect(m('[[:digit:]]', '7')).toBe(true);
    expect(m('\\*', '*')).toBe(true);
    expect(m('[unclosed', '[unclosed')).toBe(true);
  });

  it('treats ** between slashes as any number of folders, none included', () => {
    expect(m('**/foo', 'foo')).toBe(true);
    expect(m('**/foo', 'a/b/foo')).toBe(true);
    expect(m('a/**/b', 'a/b')).toBe(true);
    expect(m('a/**/b', 'a/x/y/b')).toBe(true);
    expect(m('abc/**', 'abc/x/y')).toBe(true);
    expect(m('abc/**', 'abc')).toBe(false);
    expect(m('a**b', 'axb')).toBe(true);
    expect(m('a**b', 'a/b')).toBe(false);
  });

  it('folds case only when asked, and lets * cross slashes without pathname', () => {
    expect(m('ABC', 'abc')).toBe(false);
    expect(m('ABC', 'abc', { caseFold: true })).toBe(true);
    expect(m('a*c', 'a/b/c', { pathname: false })).toBe(true);
  });
});

describe('gitignore rules', () => {
  it('lets the last matching rule decide, and folder-only rules skip files', () => {
    const rules = parseIgnore('*.log\n!keep.log\nbuild/\n/root-only\n  \n# comment\ntrailing\\ \n', '');
    expect(isIgnored('a.log', false, rules)).toBe(true);
    expect(isIgnored('keep.log', false, rules)).toBe(false);
    expect(isIgnored('build', true, rules)).toBe(true);
    expect(isIgnored('build', false, rules)).toBe(false);
    expect(isIgnored('root-only', false, rules)).toBe(true);
    expect(isIgnored('sub/root-only', false, rules)).toBe(false);
    expect(isIgnored('trailing ', false, rules)).toBe(true);
  });

  it('roots a nested file\'s rules at its own folder', () => {
    const rules = [...parseIgnore('*.tmp\n', ''), ...parseIgnore('/only-here\n!x.tmp\n', 'sub')];
    expect(isIgnored('sub/only-here', false, rules)).toBe(true);
    expect(isIgnored('only-here', false, rules)).toBe(false);
    expect(isIgnored('sub/x.tmp', false, rules)).toBe(false);
    expect(isIgnored('other/x.tmp', false, rules)).toBe(true);
  });
});
