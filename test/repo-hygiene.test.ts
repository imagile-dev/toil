import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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
  'AGENT_DECISIONS.md', 'CHANGELOG.md', 'CLAUDE.md', 'LICENSE', 'NOTICE', 'README.md',
  'docs', 'scripts', 'site', 'skills', 'src', 'test',
  'eslint.config.js', 'package-lock.json', 'package.json', 'release-please-config.json',
  'tsconfig.json', 'tsup.config.ts', 'vitest.config.ts', 'vitest.live.config.ts',
]);

/**
 * Atlassian and Dynatrace answer for any tenant name, so a tenant-shaped example
 * on their domains is a real host someone could register, and a copied config
 * would send them the credential (CLAUDE.md, Placeholders). A name in angle
 * brackets is fine.
 */
const WILDCARD_TENANT = /\b[a-z0-9-]+\.(?:atlassian\.net|live\.dynatrace\.com|apps\.dynatrace\.com)\b/i;
const BINARY = /\.(?:png|jpe?g|webp|avif|gif|ico|woff2?)$/i;

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

  it('has no placeholder tenant on a vendor that answers for every subdomain', () => {
    const found = tracked!.filter((f) => !BINARY.test(f)).flatMap((f) => {
      try {
        return readFileSync(join(root, f), 'utf8').split('\n').flatMap((line, i) => (WILDCARD_TENANT.test(line) ? [`${f}:${i + 1}`] : []));
      } catch {
        return [];
      }
    });
    expect(found).toEqual([]);
  });
});
