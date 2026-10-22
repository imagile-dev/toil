import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRecords, extractPage, search, words } from '../site/src/lib/search.mjs';
import { commandGroupPage, integrationFiles, skillFiles } from '../site/src/lib/skill-pages.mjs';
import { docsPath, startPaths } from '../site/src/data/docs-path.mjs';

/**
 * The site search (#433): its index is built after `astro build` from the
 * pages and the registry's lists (site/scripts/search-index.mjs), and the
 * browser ranks it with search(). These hold the extraction and the ranking;
 * the build's check-links.mjs holds every record's link to a real page and id.
 * The start-here paths are three stops each on the docs path, held here too.
 */
const data = join(import.meta.dirname, '..', 'site', 'src', 'data');
const byName = (dir: string) =>
  Object.fromEntries(
    readdirSync(join(data, dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(data, dir, f), 'utf8'))]),
  );

const page = `<html><head><title>Using toil — toil</title><meta name="description" content="How &amp; why."></head><body>
<header><h2>Not in main</h2></header>
<main><h1>Using toil</h1>
<section id="output"><h2>One envelope<span data-search-skip>42</span></h2><ul><li><p>A list item</p></li></ul></section>
<h2 id="writes">Writes</h2><p>Need <code>--allow-write</code> &amp; a <em>connection</em>.</p>
<h3>No id</h3><p>Plain.</p>
</main></body></html>`;

describe('site search', () => {
  it('reads a page: its title, description, and each heading in main with its id and first paragraph', () => {
    const { title, description, headings } = extractPage(page);
    expect(title).toBe('Using toil');
    expect(description).toBe('How & why.');
    expect(headings).toEqual([
      { level: 1, text: 'Using toil', id: undefined, snippet: '' },
      { level: 2, text: 'One envelope', id: 'output', snippet: '' },
      { level: 2, text: 'Writes', id: 'writes', snippet: 'Need --allow-write & a connection.' },
      { level: 3, text: 'No id', id: undefined, snippet: 'Plain.' },
    ]);
  });

  const listsSettings = new Set(integrationFiles.map((f) => f.area));
  const records = buildRecords({
    pages: [{ path: '/docs/core/', html: page }],
    commands: byName('commands'),
    settings: byName('settings'),
    integrations: Object.values(byName('integrations')),
    databases: JSON.parse(readFileSync(join(data, 'databases.json'), 'utf8')),
    groupPage: commandGroupPage,
    areaPage: (area: string) => {
      const path = skillFiles.find((f) => f.area === area && f.path)?.path;
      return path ? { path, listsSettings: listsSettings.has(area) } : undefined;
    },
  });
  const first = (q: string) => search(records, q, 5)[0];

  it('finds a command, an integration, an env var, an engine and a docs heading first', () => {
    expect(first('toil jira issue get')).toMatchObject({ k: 'Command', t: 'toil jira issue get', u: '/connect/jira/#commands-at-a-glance' });
    expect(first('jira')).toMatchObject({ k: 'Integration', t: 'Jira Data Center', u: '/connect/jira/' });
    expect(first('TOIL_JIRA_API_TOKEN')).toMatchObject({ k: 'Setting', u: '/connect/jira/#settings-at-a-glance' });
    expect(first('postgres')).toMatchObject({ k: 'Database', t: 'PostgreSQL', u: '/connect/db/' });
    expect(first('writes')).toMatchObject({ k: 'Section', t: 'Writes', u: '/docs/core/#writes', p: 'Using toil' });
  });

  it('finds a command by its MCP tool and a setting by its CI fallback', () => {
    expect(first('jira_issue_get')).toMatchObject({ t: 'toil jira issue get' });
    expect(search(records, 'GITHUB_TOKEN', 30).some((r) => r.t === 'TOIL_GITHUB_TOKEN')).toBe(true);
  });

  it('needs every word to match, and an empty query finds nothing', () => {
    expect(search(records, 'jira zzzz-nothing')).toEqual([]);
    expect(search(records, '   ')).toEqual([]);
    expect(words('TOIL_X --allow-write, toil.')).toEqual(['toil_x', '--allow-write', 'toil']);
  });

  it('gives every start-here path three steps on pages the docs path walks', () => {
    const onPath = new Set(docsPath.flatMap((g) => g.links.map((l) => l.href.split('#')[0])));
    expect(startPaths.map((p) => p.id)).toEqual(['agent', 'lead', 'ci']);
    for (const path of startPaths) {
      expect(path.steps).toHaveLength(3);
      for (const step of path.steps) expect(onPath, `${path.id}: ${step.href}`).toContain(step.href.split('#')[0]);
    }
  });
});
