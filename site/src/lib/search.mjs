// The site search (#433): an index built after `astro build` from the pages it
// made and the registry's own lists, and the scoring the browser runs on it.
// Nothing here is written by hand: every page's title and headings come from
// the built HTML, and every command, setting, integration and engine from the
// data files test/site-commands.test.ts writes. The index is one static JSON
// file next to the pages, so a search never leaves the site. A search service
// would need a procurement form; a JSON file needs a folder.
//
// scripts/search-index.mjs runs the build half; src/scripts/search.ts imports
// `search` for the browser; test/site-search.test.ts holds both.

/** @typedef {{ t: string, k: string, u: string, p?: string, d?: string, w?: string }} SearchRecord */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Text with tags removed and entities decoded, whitespace collapsed. */
export function plainText(html) {
  return html
    // A block boundary is a space; an inline tag (code, em, a) sits inside a word's sentence.
    .replace(/<\/?(br|p|div|li|td|th|tr|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A string cut to about `max` characters at a word boundary. */
function clip(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

/**
 * One built page: its `<title>` (without the site suffix), its description,
 * and every h1 to h3 inside `<main>`, each with the id to link to (its own,
 * else the `<section>` it sits in) and the first paragraph after it.
 */
export function extractPage(html) {
  const title = plainText(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '').replace(/\s+—\s+toil$/, '');
  const description = plainText(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');
  const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
  const headings = [];
  // Walk the tags in order, keeping the section a heading is inside.
  const sections = [];
  const tag = /<(\/?)(section|h[1-3])\b([^>]*)>/g;
  let m;
  while ((m = tag.exec(main))) {
    const [, close, name, attrs] = m;
    if (name === 'section') {
      if (close) sections.pop();
      else sections.push(/\sid="([^"]+)"/.exec(attrs)?.[1]);
      continue;
    }
    if (close) continue;
    const end = main.indexOf(`</${name}>`, tag.lastIndex);
    if (end < 0) continue;
    // A part marked data-search-skip (a count beside a heading) isn't the heading's name.
    const text = plainText(main.slice(tag.lastIndex, end).replace(/<(\w+)\b[^>]*\sdata-search-skip\b[^>]*>[\s\S]*?<\/\1>/g, ''));
    tag.lastIndex = end;
    if (!text) continue;
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1] ?? [...sections].reverse().find(Boolean);
    // The first paragraph before the next heading says what the section is about.
    const rest = main.slice(end);
    // A list, table or code block comes before any paragraph about the section, so it stops the search too.
    const next = rest.search(/<(h[1-6]|ul|ol|table|pre)\b/);
    const para = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(next < 0 ? rest : rest.slice(0, next))?.[1];
    headings.push({ level: Number(name[1]), text, id, snippet: para ? clip(plainText(para)) : '' });
  }
  return { title, description, headings };
}

/**
 * Every record of the index, from the built pages and the data files.
 *
 * - `pages`: `{ path, html }` for each page worth finding (no redirects, no app)
 * - `commands`: group → the registry's commands of that group
 * - `settings`: area → the registry's settings of that area
 * - `integrations`: the board entries
 * - `databases`: the engines
 * - `groupPage(group)`: the page documenting a command group, or undefined
 * - `areaPage(area)`: an area's page, and whether it lists its settings
 *
 * @returns {SearchRecord[]}
 */
export function buildRecords({ pages, commands, settings, integrations, databases, groupPage, areaPage }) {
  const records = [];
  const boardByPath = new Map(integrations.map((i) => [`/connect/${i.area}/`, i]));

  for (const { path, html } of pages) {
    const page = extractPage(html);
    const board = boardByPath.get(path);
    // An integration's page is found by its board entry, below.
    if (!board) records.push({ t: page.title, k: 'Page', u: path, d: clip(page.description) });
    for (const h of page.headings) {
      // The h1 is the page itself, already a record.
      if (h.level === 1) continue;
      records.push({ t: h.text, k: 'Section', u: h.id ? `${path}#${h.id}` : path, p: board?.name ?? page.title, ...(h.snippet && { d: h.snippet }) });
    }
  }

  for (const [group, list] of Object.entries(commands)) {
    const at = groupPage(group) ?? `/docs/commands/#${group}`;
    for (const c of list) {
      const words = [c.tool, ...(c.aliases ?? []).map((a) => `toil ${a}`)].filter(Boolean).join(' ');
      records.push({ t: `toil ${group} ${c.name}`, k: 'Command', u: at, d: c.description, ...(words && { w: words }) });
    }
  }

  for (const [area, list] of Object.entries(settings)) {
    const page = areaPage(area);
    if (!page) continue;
    const at = page.listsSettings ? `${page.path}#settings-at-a-glance` : page.path;
    for (const s of list) {
      records.push({ t: s.env, k: 'Setting', u: at, p: `${area} · ${s.key}`, d: s.description, w: [s.key, ...s.fallbacks].join(' ') });
    }
  }

  for (const board of integrations) {
    records.push({ t: board.name, k: 'Integration', u: `/connect/${board.area}/`, p: `toil ${board.area}`, d: clip(board.covers), w: `${board.area} ${board.credential}` });
  }

  for (const db of databases) {
    records.push({ t: db.label, k: 'Database', u: '/connect/db/', p: 'toil db', d: `Engine ${db.engine}, verified ${db.verification}`, w: db.engine });
  }

  return records;
}

/** The words of a query or a field, lowercased. Keeps `_`, `-`, `.` and `/` inside a word, so `TOIL_JIRA_TOKEN` and `--allow-write` stay whole. */
export function words(text) {
  return text.toLowerCase().split(/[^a-z0-9_./-]+/).map((w) => w.replace(/^[./]+|[./]+$/g, '')).filter(Boolean);
}

/** How strongly each field counts when a query word is found in it. */
const WEIGHT = { t: 10, w: 6, p: 3, d: 2 };
const KIND_BONUS = { Integration: 5, Database: 4, Page: 3, Command: 2, Setting: 2 };

/**
 * The records that match every word of `query`, best first. A word counts
 * most in the title, most of all at the start of one of its words, then the
 * keywords, the page it's on and the description. A title that is the query,
 * or starts with it, ranks above everything else.
 *
 * @param {SearchRecord[]} records
 * @param {string} query
 */
export function search(records, query, limit = 30) {
  const terms = words(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(' ');
  const scored = [];
  for (const r of records) {
    let score = 0;
    let all = true;
    for (const term of terms) {
      let best = 0;
      for (const field of /** @type {const} */ (['t', 'w', 'p', 'd'])) {
        const text = r[field];
        if (!text) continue;
        const hay = text.toLowerCase();
        const at = hay.indexOf(term);
        if (at < 0) continue;
        const startsWord = at === 0 || /[^a-z0-9]/.test(hay[at - 1]);
        best = Math.max(best, WEIGHT[field] * (startsWord ? 2 : 1));
      }
      if (best === 0) {
        all = false;
        break;
      }
      score += best;
    }
    if (!all) continue;
    // An integration or engine is named by its area too (`toil jira`, `postgres`).
    const names = [r.t, ...(r.k === 'Integration' || r.k === 'Database' ? [r.p, r.w] : [])].filter(Boolean).flatMap((n) => {
      const lower = n.toLowerCase();
      return [lower, lower.replace(/^toil /, '')];
    });
    if (names.includes(phrase)) score += 100;
    else if (names.some((n) => n.startsWith(phrase))) score += 40;
    // A catalogue entry or a whole page outranks a heading of the same name.
    score += KIND_BONUS[r.k] ?? 0;
    scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score || a.r.t.length - b.r.t.length);
  return scored.slice(0, limit).map((s) => s.r);
}
