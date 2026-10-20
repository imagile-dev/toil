import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  '.claude', '.claude-plugin', '.gitattributes', '.github', '.gitignore', '.npmrc', '.release-please-manifest.json',
  'AGENT_DECISIONS.md', 'CHANGELOG.md', 'CLAUDE.md', 'LICENSE', 'NOTICE', 'README.md',
  'dist', 'docs', 'functions', 'infra', 'scripts', 'site', 'skills', 'src', 'test', 'ui',
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

/**
 * A scripted edit that hands String.replace a replacement holding `$` followed by a
 * backtick or a quote expands it into the text before or after the match, and a
 * document quietly gains a second copy of itself (#205 did, to CLAUDE.md). These
 * are the occurrences that are meant: a regex's end anchor or a bash quote inside
 * code. A new one is added here on purpose.
 */
const DOLLAR_PATTERNS: Record<string, number> = { 'CLAUDE.md': 1, 'skills/toil/jira-cloud.md': 1, 'skills/toil/util.md': 1 };
const DOLLAR = /\$[`']/g;

/** Level-one headings outside fenced code; a document has one title. */
function titles(text: string): string[] {
  let fenced = false;
  return text.split(/\r?\n/).filter((line) => {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && /^# /.test(line);
  });
}

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

  it('has no Markdown file with two titles, the mark of a document pasted into itself', () => {
    const doubled = tracked!.filter((f) => f.endsWith('.md')).flatMap((f) => {
      try {
        const found = titles(readFileSync(join(root, f), 'utf8'));
        return found.length > 1 ? [`${f}: ${found.join(' | ')}`] : [];
      } catch {
        return [];
      }
    });
    expect(doubled).toEqual([]);
  });

  it('has a dollar sign before a backtick or a quote in Markdown only where one is meant', () => {
    const counts: Record<string, number> = {};
    for (const f of tracked!.filter((x) => x.endsWith('.md'))) {
      try {
        const n = [...readFileSync(join(root, f), 'utf8').matchAll(DOLLAR)].length;
        if (n) counts[f] = n;
      } catch {
        // Deleted in the working tree.
      }
    }
    expect(counts).toEqual(DOLLAR_PATTERNS);
  });

  it('leaves AGENT_DECISIONS.md frozen: new decisions get a file of their own in docs/decisions/', () => {
    // Every PR appended to one file, so every PR conflicted on it (#361). The
    // archive's content is pinned; an entry added to it fails here, not as a
    // merge conflict on the next PR. docs/decisions/README.md says where it goes.
    const text = readFileSync(join(root, 'AGENT_DECISIONS.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(text).digest('hex'),
      'AGENT_DECISIONS.md is a frozen archive. Put the decision in docs/decisions/<issue#>-<slug>.md instead (docs/decisions/README.md).')
      .toBe('9586220051d494fc2cfd9eb9cc072364ed10bab9a77d93b92f53b20e11778f3c');
  });

  it('names every decision file <issue#>-<slug>.md, after its branch', () => {
    const files = tracked!.filter((f) => f.startsWith('docs/decisions/') && f !== 'docs/decisions/README.md');
    expect(files.filter((f) => !/^docs\/decisions\/\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(f))).toEqual([]);
  });

  it('the title check counts only headings outside code', () => {
    expect(titles('# One\n\n```bash\n# a comment\n```\n')).toEqual(['# One']);
    expect(titles('# One\ntext\n# One\n')).toHaveLength(2);
  });
});
