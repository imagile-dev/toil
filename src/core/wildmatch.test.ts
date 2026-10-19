import { describe, expect, it } from 'vitest';
import { wildmatchRegex } from '../../test/harness/wildmatch-regex.js';
import { isIgnored, parseIgnore, skippedLineWarning, type SkippedIgnoreLine } from './gitignore.js';
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

  it('reads classes the way git does: ] first, ^ and ! to negate, - at the edge, named sets', () => {
    expect(m('[]]', ']')).toBe(true);
    expect(m('[!]]', 'a')).toBe(true);
    expect(m('[!]]', ']')).toBe(false);
    expect(m('[^a]', 'b')).toBe(true);
    expect(m('[^a]', 'a')).toBe(false);
    expect(m('[a-]', '-')).toBe(true);
    expect(m('[\\]]', ']')).toBe(true);
    expect(m('[[:alpha:][:digit:]]', '7')).toBe(true);
    expect(m('[[:alpha:][:digit:]]', '-')).toBe(false);
    expect(m('[!a-c]x', '/x', { pathname: false })).toBe(true);
  });

  it('takes an escaped character literally, and a trailing backslash as itself', () => {
    expect(m('\\[a]', '[a]')).toBe(true);
    expect(m('a\\*b', 'a*b')).toBe(true);
    expect(m('a\\*b', 'axb')).toBe(false);
    expect(m('a\\?', 'ab')).toBe(false);
    expect(m('ab\\', 'ab\\')).toBe(true);
  });

  it('treats ** between slashes as any number of folders, none included', () => {
    expect(m('**/foo', 'foo')).toBe(true);
    expect(m('**/foo', 'a/b/foo')).toBe(true);
    expect(m('a/**/b', 'a/b')).toBe(true);
    expect(m('a/**/b', 'a/x/y/b')).toBe(true);
    expect(m('a/**/b', 'a/xb')).toBe(false);
    expect(m('a/**/**/b', 'a/b')).toBe(true);
    expect(m('a/**/**/b', 'a/x/b')).toBe(true);
    expect(m('***/x', 'a/b/x')).toBe(true);
    expect(m('abc/**', 'abc/x/y')).toBe(true);
    expect(m('abc/**', 'abc')).toBe(false);
    expect(m('a/**', 'a/')).toBe(true);
    expect(m('**', 'a/b/c')).toBe(true);
    expect(m('a**b', 'axb')).toBe(true);
    expect(m('a**b', 'a/b')).toBe(false);
    expect(m('**a', 'x/a')).toBe(false);
  });

  it('folds case only when asked, and lets * cross slashes without pathname', () => {
    expect(m('ABC', 'abc')).toBe(false);
    expect(m('ABC', 'abc', { caseFold: true })).toBe(true);
    expect(m('[A-C]x', 'bx')).toBe(false);
    expect(m('[A-C]x', 'bx', { caseFold: true })).toBe(true);
    expect(m('a*c', 'a/b/c', { pathname: false })).toBe(true);
    expect(m('a?c', 'a/c', { pathname: false })).toBe(true);
    expect(m('**', 'a/b', { pathname: false })).toBe(true);
  });

  it('gives the same answer as the RegExp it replaced, on every pattern a small alphabet can spell', () => {
    // A seeded generator, so a failure names a pattern that fails again on rerun.
    let seed = 244;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const spell = (alphabet: readonly string[], max: number) => {
      let s = '';
      for (let i = rand(max + 1); i > 0; i--) s += alphabet[rand(alphabet.length)];
      return s;
    };
    // `ſ` and the Kelvin sign fold onto `S` and `K` only under the `u` flag,
    // which the RegExp never had; they're here to keep it that way.
    const odd = ['ſ', 'K'];
    const patternAlphabet = ['a', 'b', 'A', 's', 'k', 'K', ...odd, '/', '*', '*', '?', '[', ']', '!', '^', '-', '\\', '.', '[:digit:]', '1'];
    const pathAlphabet = ['a', 'b', 'A', 'B', 's', 'S', 'k', 'K', ...odd, '/', '/', '.', '-', '1', '[', ']', '\\', '*', '!'];
    const disagreements: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const pattern = spell(patternAlphabet, 8);
      const options = { pathname: rand(4) !== 0, caseFold: rand(3) === 0 };
      let oracle: RegExp | undefined;
      try {
        oracle = wildmatchRegex(pattern, options);
      } catch {
        // A class the RegExp refused (`[b-a]`) is refused the same way now.
        expect(() => wildmatch(pattern, options), pattern).toThrow(SyntaxError);
        continue;
      }
      const matcher = wildmatch(pattern, options);
      for (let j = 0; j < 12; j++) {
        const path = spell(pathAlphabet, 10);
        const want = oracle.test(path);
        if (matcher.test(path) !== want) disagreements.push(`${JSON.stringify(pattern)} ${JSON.stringify(options)} on ${JSON.stringify(path)}: want ${want}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('stays linear on stacked * and ** patterns that made the RegExp backtrack (#244)', () => {
    // How long `test` takes per call: repeated until it has run for a while,
    // best of three, so timer resolution and a busy runner don't decide it.
    const cost = (pattern: string, path: string) => {
      const matcher = wildmatch(pattern);
      let best = Infinity;
      for (let trial = 0; trial < 3; trial++) {
        let calls = 0;
        const start = performance.now();
        let elapsed: number;
        do {
          matcher.test(path);
          calls++;
          elapsed = performance.now() - start;
        } while (elapsed < 20);
        best = Math.min(best, elapsed / calls);
      }
      return best;
    };
    // Each hostile pattern is raced against a baseline with the same number of
    // steps on the same path, one that matches and that a RegExp settles at
    // once. The backtracking RegExp took hundreds of milliseconds on the first
    // two, about a million times its baseline; a linear walk is within a small
    // factor. Measured against each other, the deadline moves with the machine
    // (#218). Each hostile pattern ends in a class, not a plain character, so
    // the walk can't be skipped by checking the path's last characters first.
    const HEADROOM = 25;
    const cases = [
      { hostile: `${'*a'.repeat(8)}[b]`, baseline: `${'*?'.repeat(8)}?`, path: 'a'.repeat(44) },
      { hostile: `${'**/a/'.repeat(9)}[b]`, baseline: `${'**/?/'.repeat(9)}?`, path: `${'a/'.repeat(30)}c` },
      // Then lengths no RegExp would finish in a lifetime.
      { hostile: `${'*a'.repeat(30)}[b]`, baseline: `${'*?'.repeat(30)}?`, path: 'a'.repeat(2000) },
      { hostile: `${'**/a/'.repeat(30)}[b]`, baseline: `${'**/?/'.repeat(30)}?`, path: `${'a/'.repeat(1000)}c` },
    ];
    for (const { hostile, baseline, path } of cases) {
      expect(wildmatch(baseline).test(path), baseline).toBe(true);
      expect(wildmatch(hostile).test(path), hostile).toBe(false);
      expect(cost(hostile, path), hostile).toBeLessThan(cost(baseline, path) * HEADROOM);
    }
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

  it('skips only a line that does not compile, reports it with its line number, and keeps the rest (#262)', () => {
    const skipped: SkippedIgnoreLine[] = [];
    const rules = parseIgnore('# logs\n*.log\n\n[b-a]\n!keep.log\nbuild/  \n', '', false, (s) => skipped.push(s));
    expect(skipped).toEqual([
      {
        line: 4,
        pattern: '[b-a]',
        reason: expect.stringMatching(/^a range in brackets runs backwards, from a higher character to a lower one\. git reads such a range as its first character alone/),
        fix: 'Write the range from low to high, as in [a-z], or delete the line.',
      },
    ]);
    expect(rules).toHaveLength(3);
    expect(isIgnored('a.log', false, rules)).toBe(true);
    expect(isIgnored('keep.log', false, rules)).toBe(false);
    expect(isIgnored('build', true, rules)).toBe(true);
    // A negated or anchored line with a reversed range is skipped the same way.
    const more: SkippedIgnoreLine[] = [];
    expect(parseIgnore('!/[z-a].txt\nsrc/[!z-a]/\n', '', false, (s) => more.push(s))).toEqual([]);
    expect(more.map((s) => [s.line, s.pattern])).toEqual([[1, '!/[z-a].txt'], [2, 'src/[!z-a]/']]);
    // With no one to tell, the line is still skipped rather than the file thrown away.
    expect(parseIgnore('*.log\n[b-a]\n', '')).toHaveLength(1);
  });

  it('words the warning for a skipped line with the file, the line, the pattern, the reason and the fix', () => {
    expect(skippedLineWarning('C:\\work\\.gitignore', { line: 4, pattern: '[b-a]', reason: 'it runs backwards', fix: 'Write it low to high.' })).toEqual({
      code: 'GITIGNORE_LINE_SKIPPED',
      message: 'Line 4 of C:/work/.gitignore ("[b-a]") was skipped, and the rest of that file still applies: it runs backwards. Write it low to high.',
    });
  });

  it('re-includes with ! and escapes a leading ! or # to match it literally', () => {
    const rules = parseIgnore('*.txt\n!important.txt\n\\!bang\n\\#hash\n', '');
    expect(isIgnored('notes.txt', false, rules)).toBe(true);
    expect(isIgnored('important.txt', false, rules)).toBe(false);
    expect(isIgnored('!bang', false, rules)).toBe(true);
    expect(isIgnored('#hash', false, rules)).toBe(true);
  });
});
