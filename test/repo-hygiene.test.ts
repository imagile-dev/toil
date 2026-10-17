import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Stray files get committed by accident: a shell redirect that made an empty
 * file named `{}`, a scratch script, a screenshot. Review catches them late, if
 * at all. These tests catch them at once (CLAUDE.md, Delivery). An empty file
 * has nothing to say, and these tests make sure it says it somewhere else.
 */

const root = join(import.meta.dirname, '..');
const tracked = (() => {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    return undefined; // Not a git checkout, so there's nothing to check.
  }
})();

/** Everything allowed at the repo root. A new top-level file or folder is added here on purpose. */
const ROOT = new Set([
  '.claude', '.gitattributes', '.github', '.gitignore', '.npmrc', '.release-please-manifest.json',
  'CLAUDE.md', 'LICENSE', 'NOTICE', 'README.md',
  'docs', 'scripts', 'site', 'skills', 'src', 'test',
  'eslint.config.js', 'package-lock.json', 'package.json', 'release-please-config.json',
  'tsconfig.json', 'tsup.config.ts', 'vitest.config.ts',
]);

describe.skipIf(!tracked)('tracked files', () => {
  it('has nothing unexpected at the repo root', () => {
    const top = [...new Set(tracked!.map((f) => f.split('/')[0]!))];
    expect(top.filter((f) => !ROOT.has(f))).toEqual([]);
  });

  it('has no empty files', () => {
    // A file deleted in the working tree but still tracked isn't the point here.
    const empty = tracked!.filter((f) => {
      try {
        return statSync(join(root, f)).size === 0;
      } catch {
        return false;
      }
    });
    expect(empty).toEqual([]);
  });
});
