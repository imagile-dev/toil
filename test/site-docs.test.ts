import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pagePath, skillFiles } from '../site/src/lib/skill-pages.mjs';

/**
 * The docs are the toil skill (#202): skills/toil/*.md is the one copy of the
 * reference, agents read it as installed, and the pages under
 * site/src/pages/docs/ render it. A page may add facts and lists the
 * registry writes, short labels and navigation, but not reference prose of
 * its own, which would be a second copy to drift. This reads each page's
 * template and fails on any run of text longer than a label, in the markup,
 * in a hero or layout attribute, or in a string in its frontmatter.
 *
 * The one page left out is /docs/welcome/: it describes the menu a person
 * sees on a terminal, which no agent reads, so it has no skill file to render.
 * A second copy of a document is how a filing cabinet starts.
 */
const root = join(import.meta.dirname, '..');
const docsDir = join(root, 'site', 'src', 'pages', 'docs');
const components = ['SkillPage.astro', 'CommandIndex.astro'].map((f) => join(root, 'site', 'src', 'components', f));
const NOT_SKILL = new Set(['welcome.astro']);
/** Longest run of literal words a page may carry: a label or a heading, not a sentence of reference. */
const MAX_WORDS = 8;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith('.astro') && !NOT_SKILL.has(name) ? [path] : [];
  });
}

const words = (text: string) => text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

/** Removes `{…}` expressions, nested ones included, keeping what's outside them. */
function withoutExpressions(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Every run of literal prose in an Astro file that is longer than a label. */
export function prose(astro: string): string[] {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(astro)?.[1] ?? '';
  const template = astro
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const found: string[] = [];
  // Strings in the frontmatter, comments aside.
  const code = front.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    if (words(text) > MAX_WORDS) found.push(text);
  }
  // Literal attribute values a reader sees.
  for (const m of template.matchAll(/\b(?:title|lead|description|eyebrow|alt|aria-label)="([^"]*)"/g)) if (words(m[1]!) > MAX_WORDS) found.push(m[1]!);
  // Text between tags, with expressions and tags taken out.
  const text = withoutExpressions(template.replace(/<[^>]*>/g, '\n'));
  for (const run of text.split(/\n\s*\n|\n/)) if (words(run) > MAX_WORDS) found.push(run.trim());
  return found;
}

describe('the docs pages render skills/toil/ and carry no reference prose of their own', () => {
  const files = pages(docsDir);

  it('finds the pages', () => {
    expect(files.map((f) => relative(docsDir, f).replace(/\\/g, '/')).sort()).toEqual(
      expect.arrayContaining(['core.astro', 'databases.astro', 'index.astro', 'install.astro', 'integrations/[area].astro', 'mcp.astro', 'skills.astro', 'utilities.astro']),
    );
  });

  for (const file of [...files, ...components]) {
    const name = relative(root, file).replace(/\\/g, '/');
    it(`${name} has no run of literal text over ${MAX_WORDS} words`, () => {
      expect(prose(readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  for (const file of files) {
    const name = relative(docsDir, file).replace(/\\/g, '/');
    it(`docs/${name} renders a file of the skill`, () => {
      expect(readFileSync(file, 'utf8')).toMatch(/<SkillPage file=/);
    });
  }

  it('every file of the skill has a page, and every one an integration page names exists', () => {
    expect(skillFiles.filter((f) => !f.path).map((f) => f.file)).toEqual([]);
    for (const file of readdirSync(join(root, 'skills', 'toil')).filter((f) => f.endsWith('.md'))) expect(pagePath(file), file).toBeDefined();
  });

  it('every integration on the board has a skill file, so its tile links to a page', () => {
    const board = readdirSync(join(root, 'site', 'src', 'data', 'integrations')).filter((f) => f.endsWith('.json'));
    expect(board.length).toBeGreaterThan(10);
    for (const f of board) expect(existsSync(join(root, 'skills', 'toil', f.replace(/\.json$/, '.md'))), `skills/toil/${f.replace(/\.json$/, '.md')}`).toBe(true);
  });
});

describe('the prose check bites', () => {
  it('a paragraph in the markup, a hero lead or a frontmatter string is caught; labels, comments and expressions are not', () => {
    const page = [
      '---',
      "// A comment may explain the page at whatever length it likes, as comments here always do.",
      "const engines = [{ note: 'Pure-JS driver, bundled and tested against PostgreSQL seventeen in Docker.' }];",
      "const label = 'Commands at a glance';",
      '---',
      '<PageHero lead="One set of commands for every engine: list schemas and tables, describe a table." title="Databases" />',
      '<h2>Settings at a glance</h2>',
      '<p>{doc.description} and {list.length} commands</p>',
      '<p>Each connection names its engine, and the commands work the same way on all of them.</p>',
    ].join('\n');
    expect(prose(page)).toEqual([
      'Pure-JS driver, bundled and tested against PostgreSQL seventeen in Docker.',
      'One set of commands for every engine: list schemas and tables, describe a table.',
      'Each connection names its engine, and the commands work the same way on all of them.',
    ]);
  });
});
