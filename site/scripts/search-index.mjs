// After `astro build`: writes dist/search.json, the site search's index
// (#433), from the pages the build made and the registry's lists in
// src/data/. The records come from src/lib/search.mjs; this only finds the
// inputs and writes the file. A kind of record that comes out empty fails the
// build, since a search that quietly can't find commands is worse than none.
// scripts/check-links.mjs then checks that every record's link lands.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isRedirect } from '../src/lib/redirects.mjs';
import { buildRecords } from '../src/lib/search.mjs';
import { commandGroupPage, integrationFiles, skillFiles } from '../src/lib/skill-pages.mjs';

const site = join(import.meta.dirname, '..');
const dist = join(site, 'dist');
const data = join(site, 'src', 'data');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

/** The site path a built file is served at: dist/docs/core/index.html → /docs/core/. */
const pathOf = (file) => `/${relative(dist, file).replace(/\\/g, '/')}`.replace(/index\.html$/, '');

const pages = htmlFiles(dist)
  .map((file) => ({ path: pathOf(file), file }))
  // The Toil UI app is its own bundle, an old address only forwards, and the 404 page is where nobody meant to go.
  .filter(({ path }) => !path.startsWith('/ui/app/') && !isRedirect(path) && path !== '/404.html')
  .sort((a, b) => a.path.localeCompare(b.path))
  .map(({ path, file }) => ({ path, html: readFileSync(file, 'utf8') }));

/** Every `<dir>/<name>.json` in src/data, by name. */
function jsonByName(dir) {
  return Object.fromEntries(
    readdirSync(join(data, dir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(data, dir, f), 'utf8'))]),
  );
}

const listsSettings = new Set(integrationFiles.map((f) => f.area));
const records = buildRecords({
  pages,
  commands: jsonByName('commands'),
  settings: jsonByName('settings'),
  integrations: Object.values(jsonByName('integrations')),
  databases: JSON.parse(readFileSync(join(data, 'databases.json'), 'utf8')),
  groupPage: commandGroupPage,
  areaPage: (area) => {
    const path = skillFiles.find((f) => f.area === area && f.path)?.path;
    return path ? { path, listsSettings: listsSettings.has(area) } : undefined;
  },
});

const counts = {};
for (const r of records) counts[r.k] = (counts[r.k] ?? 0) + 1;
const missing = ['Page', 'Section', 'Command', 'Setting', 'Integration', 'Database'].filter((k) => !counts[k]);
if (missing.length) {
  console.error(`search: the index has no ${missing.join(', ')} records. Check src/lib/search.mjs against the built pages and src/data/.`);
  process.exit(1);
}

const json = JSON.stringify(records);
writeFileSync(join(dist, 'search.json'), json);
const summary = Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ');
console.log(`search: ${records.length} records (${summary}), ${Math.round(json.length / 1024)} KB`);
