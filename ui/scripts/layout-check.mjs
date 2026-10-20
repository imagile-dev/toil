// The layout check (#277): every Toil UI view, in every theme and scheme, at
// 375, 768 and 1440 pixels, in real headless Chrome. It fails on what a
// person would see as broken, whatever the theme:
//
//   - the page itself scrolling sideways;
//   - any element whose content is wider than its box (scrollWidth more than
//     clientWidth + 1), unless it is a declared scroller (`data-scroller`,
//     which DataTable and the other scrollers carry with their cue and focus)
//     or a declared truncation (`data-truncate`, Path and Url, which keep the
//     whole value in a tooltip and a copy button);
//   - a child box reaching past the edge of its card (`data-card`);
//   - something fixed to the bottom of the screen covering the end of the
//     page once it is scrolled all the way down;
//   - a row that must stay one row (`data-one-row`: the compact header, the
//     settings tabs) wrapping onto a second;
//   - an open modal whose backdrop doesn't dim the page;
//   - and, in the strict themes (Plain light and dark, and Crate), any axe
//     violation at WCAG 2.2 AA. The other themes' axe findings are reported,
//     never failed (the maintainer's bar, AGENT_DECISIONS.md, #267).
//
// Each view is checked as it opens and with its hidden parts showing: every
// <details> open, each dossier card's Show pressed, the header menu and the
// Feedback dialog open, the Assign dialog open from an item and the inbox, the focused Ask view open
// from the Ask bar (#343) with its (i) popover, its agent switcher, an answer, its Suggestions menu and
// Analyze's pulse check, the Agent page's full prompt and its Install dialog shown (#344), a worklog day rebuilt and
// the calendar on an earlier month, and every failing
// command's recent audit lines open on the Usage page. Reduced motion
// is on, so an animation caught mid-flight can't fail a run.
//
// `npm run smoke -w ui` runs it against the installed package (`toil-ui
// --sample`). By hand, against any build:
//
//   npx vite preview --port 4173            (after `npx vite build`, in ui/)
//   node scripts/layout-check.mjs --base http://127.0.0.1:4173/ [--theme crate] [--route '#/settings/dossiers'] [--width 375] [--motion full] [--shots <dir>] [--json <file>]
//
// Repo tooling only; nothing here ships. It measures twice and files once.
/* global document, window, getComputedStyle -- inspect() and covered() run in the page */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome, openBrowser } from './chrome.mjs';

const ui = join(import.meta.dirname, '..');

/** Every theme and scheme, from the theme folders, with Plain and Crate strict. */
export function themeRuns() {
  const order = ['plain', 'crate', 'harvest', 'starship', 'realm'];
  const manifests = readdirSync(join(ui, 'themes')).map((name) => JSON.parse(readFileSync(join(ui, 'themes', name, 'theme.json'), 'utf8')));
  manifests.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return manifests.flatMap((m) => Object.keys(m.schemes).map((scheme) => ({ theme: m.name, scheme, strict: m.name === 'plain' || m.name === 'crate' })));
}

const item = (dossier, id) => `#/dossier/${dossier}/item/${encodeURIComponent(id)}`;
export const ROUTES = [
  '#/',
  '#/dossier/card-payments',
  '#/dossier/settlement',
  '#/dossier/checkout-web',
  '#/dossier/checkout-web/prs',
  '#/dossier/card-payments/prs',
  // The People view (#292): mapped people with a suggested match, people plus agents and an unmapped account, a dossier listing nobody, and the board filtered to one person.
  '#/dossier/card-payments/people',
  '#/dossier/checkout-web/people',
  '#/dossier/settlement/people',
  `#/dossier/card-payments/board/${encodeURIComponent('person:J. Smith')}`,
  // The readiness gate (#307): the Command Center with one ready item, with none, and with a ready GitHub feature; an item blocked by another.
  '#/dossier/card-payments/command-center',
  '#/dossier/settlement/command-center',
  '#/dossier/checkout-web/command-center',
  item('card-payments', 'corp-jira:PAY-102'),
  '#/dossier/card-payments/worklog',
  '#/dossier/card-payments/worklog/2026-10-12',
  '#/dossier/checkout-web/worklog/2026-10-11',
  item('card-payments', 'corp-jira:PAY-100'),
  item('settlement', 'corp-ado:2304'),
  // Agent assignments (#293): one that needs you (a report, a question, proposals with diffs), one that failed at its time limit, one working.
  '#/dossier/card-payments/assignment/sample-needsyou-0002',
  '#/dossier/card-payments/assignment/sample-failed-0000004',
  '#/dossier/card-payments/assignment/sample-working-0001',
  '#/settings/connections',
  '#/settings/dossiers',
  '#/settings/toil',
  '#/settings/usage',
  '#/settings/agent-usage',
  '#/settings/agent',
];
export const WIDTHS = [375, 768, 1440];
/** What counts as a card. LAYOUT_CARDS widens it, to measure a build from before the Card primitive. */
const CARDS = process.env.LAYOUT_CARDS ?? '[data-card]';

/**
 * What runs in the page: one pass over the layout, returning findings. It is
 * sent as source, so it may use only what the page has.
 */
function inspect(cards) {
  const findings = [];
  const add = (kind, el, detail) => findings.push({ kind, at: el ? describe(el) : 'page', detail });
  function describe(el) {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
      const cls = [...e.classList].filter((c) => !c.startsWith('react-aria')).slice(0, 2).join('.');
      parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls ? `.${cls}` : ''}`);
    }
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${parts.join(' > ')}${text ? ` "${text}"` : ''}`;
  }
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  // Decoration (aria-hidden art, the HUD corners) and screen-reader-only text may sit anywhere.
  // So may anything inside a box clipped away for screen readers only (a stacked DataTable's header row).
  const clippedAway = new Map();
  const hiddenBox = (el) => {
    if (!el || el === document.body) return false;
    if (!clippedAway.has(el)) {
      const s = getComputedStyle(el);
      clippedAway.set(el, (s.clipPath !== 'none' || s.clip !== 'auto') && el.clientWidth <= 1 ? true : hiddenBox(el.parentElement));
    }
    return clippedAway.get(el);
  };
  const exempt = (el) => el.closest('svg, .sr-only, [aria-hidden="true"], [data-truncate] *') || hiddenBox(el);
  const clipsX = (el) => getComputedStyle(el).overflowX !== 'visible';

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add('page-scroll', null, `the page is ${de.scrollWidth}px wide in a ${de.clientWidth}px window`);

  const all = [...document.body.querySelectorAll('*')].filter((el) => shown(el) && !exempt(el));
  for (const el of all) {
    if (el.matches('[data-scroller], [data-truncate], input, select, textarea, option, .react-flow, .react-flow *:not(.react-flow__node, .react-flow__node *)')) continue;
    const style = getComputedStyle(el);
    if (style.display === 'inline' || style.display === 'contents') continue;
    // Visually hidden (React Aria's hidden inputs): a 1px box, clipped on purpose.
    if (el.clientWidth <= 1 && el.clientHeight <= 1) continue;
    if (el.scrollWidth > el.clientWidth + 1) add('overflow', el, `content ${el.scrollWidth}px wide in a ${el.clientWidth}px box (overflow-x: ${style.overflowX})`);
  }

  for (const card of document.querySelectorAll(cards)) {
    if (!shown(card) || exempt(card)) continue;
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('*')) {
      if (!shown(el) || exempt(el) || getComputedStyle(el).position === 'fixed') continue;
      // Inside a scroller or a clipping box, a child is meant to reach past the edge.
      let clipped = false;
      for (let p = el.parentElement; p && p !== card; p = p.parentElement) if (p.matches('[data-scroller]') || clipsX(p)) clipped = true;
      if (clipped) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > c.right + 1 || r.left < c.left - 1) add('escapes-card', el, `spans ${Math.round(r.left)}–${Math.round(r.right)}px; its card spans ${Math.round(c.left)}–${Math.round(c.right)}px`);
    }
  }

  for (const row of document.querySelectorAll('[data-one-row]')) {
    if (!shown(row)) continue;
    const kids = [...row.querySelectorAll(':scope > *, :scope > ul > li')].filter((k) => shown(k) && !exempt(k) && getComputedStyle(k).position !== 'absolute');
    const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top / 4)));
    const mids = kids.map((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2; });
    if (tops.size > 1 && Math.max(...mids) - Math.min(...mids) > 12) add('wraps', row, `its items sit on ${tops.size} rows`);
  }

  for (const overlay of document.querySelectorAll('[data-backdrop]')) {
    if (!shown(overlay)) continue;
    const bg = getComputedStyle(overlay).backgroundColor;
    const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
    if (bg === 'transparent' || (alpha !== undefined && Number(alpha) < 0.3)) add('backdrop', overlay, `the backdrop is ${bg}, which doesn't dim the page`);
  }
  return findings;
}

/** With the page scrolled to its end, nothing fixed to the bottom may cover the last of the content. */
function covered() {
  const findings = [];
  const docks = [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getClientRects().length > 0 && el.getBoundingClientRect().top > window.innerHeight / 2 && !el.closest('[aria-hidden="true"]'));
  if (!docks.length) return findings;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const main = document.querySelector('main');
  for (const dock of docks) {
    const top = dock.getBoundingClientRect().top;
    let lowest = null;
    for (const el of main.querySelectorAll('*')) {
      if (dock.contains(el) || el.closest('.sr-only, [aria-hidden="true"]') || el.getClientRects().length === 0) continue;
      // Only what a person reads or presses counts, never a container's empty padding.
      const content = el.matches('img, svg, button, input, select, textarea, summary') || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!content) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && (!lowest || r.bottom > lowest.r.bottom)) lowest = { el, r };
    }
    if (lowest && lowest.r.bottom > top + 1) findings.push({ kind: 'covered', at: `${lowest.el.tagName.toLowerCase()} "${(lowest.el.textContent ?? '').trim().slice(0, 40)}"`, detail: `ends at ${Math.round(lowest.r.bottom)}px, under a fixed ${dock.tagName.toLowerCase()}.${[...dock.classList].join('.')} from ${Math.round(top)}px` });
  }
  window.scrollTo(0, 0);
  return findings;
}

/** Waits until the view has its heading and nothing is still loading. */
const SETTLED = `new Promise((resolve) => {
  const started = Date.now();
  const done = () => document.querySelector('main h1') && !document.querySelector('.skin-loading, [role="status"].skin-loading') && !/Drawing the graph|Reading /.test(document.querySelector('main')?.textContent ?? '');
  const tick = () => (done() || Date.now() - started > 15000 ? document.fonts.ready.then(() => setTimeout(resolve, 250)) : setTimeout(tick, 100));
  tick();
})`;

/**
 * Clicks every shown element matching the selector (and text, a regex
 * source), once one shows: it waits up to `wait` ms for the first, so a
 * menu still opening can't read as nothing to open (#289). Resolves with how
 * many it clicked; 0 means none showed in time.
 */
const clickAll = (selector, text, wait = 5000) => `(async () => {
  const deadline = Date.now() + ${wait};
  for (;;) {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((b) => ${text ? `${text}.test(b.textContent ?? '')` : 'true'} && b.getClientRects().length);
    if (els.length || Date.now() > deadline) {
      for (const b of els) b.click();
      return els.length;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
})()`;

/**
 * Opens the compact header's Menu unless the item is already showing, then
 * clicks the item once it shows. -1 when there is no Menu button to press.
 */
const inMenu = (selector) => `(async () => {
  const shown = () => [...document.querySelectorAll(${JSON.stringify(selector)})].some((b) => b.getClientRects().length);
  if (!shown() && !(await ${clickAll('[data-menu-button]')})) return -1;
  return await ${clickAll(selector)};
})()`;

/** The states each view is checked in, beyond how it opens. */
function states(route, width) {
  const out = [];
  // The app's own breakpoint (COMPACT_HEADER in src/App.tsx): below it, the header is the Menu button.
  const compact = width < 1024;
  if (compact) out.push({ name: 'menu', setup: clickAll('[data-menu-button]'), undo: 'Escape' });
  // Feedback is in the header, or in its Menu when the header folds, which it does below 1024px or when its row is full.
  if (route === '#/') out.push({ name: 'feedback', setup: inMenu('button.feedback-open'), undo: 'Escape' });
  if (route === '#/settings/dossiers') out.push({ name: 'shown', setup: clickAll('.conn-card button', '/^Show$/'), undoJs: clickAll('.conn-card button', '/^Hide$/') });
  // The focused Ask view (#343), opened from the bar, and the two popovers in its strip: the (i) (#283) and the
  // agent switcher (#344). Each is closed with Escape, then the view with its Close button.
  const openAsk = `await ${clickAll('[data-ask-bar]')};`;
  const closeAsk = clickAll('[data-ask-close]');
  if (/^#\/dossier\/[^/]+$/.test(route)) {
    out.push({ name: 'ask-open', setup: `(async () => { ${openAsk} const deadline = Date.now() + 5000; while (!document.querySelector('.ask-focus .starters') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50)); return document.querySelector('.ask-focus .starters') ? 1 : 0; })()`, undoJs: closeAsk });
    out.push({ name: 'ask-info', setup: `(async () => { ${openAsk} return await ${clickAll('[data-ask-info]')}; })()`, undo: 'Escape', undoJs: closeAsk });
    out.push({ name: 'ask-switcher', setup: `(async () => { ${openAsk} return await ${clickAll('[data-agent-switch]')}; })()`, undo: 'Escape', undoJs: closeAsk });
  }
  // The readiness gate (#307): an item's workflow read live, and the Command Center's verdict filter open. Only
  // the sample's Jira and Azure DevOps items are pressed: a GitHub issue has no read to make, and a done item none either.
  if (/\/item\/corp-(jira|ado)%3A/.test(route)) out.push({ name: 'workflow-live', setup: `(async () => { const n = ${clickAll('.readiness-live button', '/Check the workflow live|Read the workflow again/')}; await new Promise((r) => setTimeout(r, 300)); return n; })()` });
  if (/\/command-center$/.test(route)) out.push({ name: 'verdict-filter', setup: clickAll('.readiness-filters > div.choice:first-of-type .choice-button'), undo: 'Escape' });
  // An answered question (#295): its usage footer, and the chat's running total and context meter in the pane's head.
  // Then, once a question has its answer, the Suggestions menu the starters fold into (#343).
  // Analyze (#343) on the next dossier: its pulse check, pressed in the bar, in the focused view.
  const answered = (press) => `(async () => { const before = document.querySelectorAll('[data-usage-footer]').length; if (!(await ${press})) return 0; const deadline = Date.now() + 8000; while (document.querySelectorAll('[data-usage-footer]').length <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50)); return document.querySelectorAll('[data-usage-footer]').length > before && document.querySelector('[data-chat-usage]') && document.querySelector('[data-ask-status]') ? 1 : 0; })()`;
  if (route === '#/dossier/card-payments') {
    out.push({ name: 'answered', setup: answered(`(async () => { ${openAsk} return await ${clickAll('.starters .starter:first-child')}; })()`), undoJs: closeAsk });
    out.push({ name: 'ask-suggestions', setup: `(async () => { ${openAsk} return await ${clickAll('[data-ask-suggestions]')}; })()`, undo: 'Escape', undoJs: closeAsk });
  }
  if (route === '#/dossier/settlement') out.push({ name: 'analyzed', setup: answered(clickAll('[data-analyze]')), undoJs: closeAsk });
  // The Assign dialog from an item's page, and Start on the Agents lane's inbox (#293).
  if (route.includes('/item/')) out.push({ name: 'assign-open', setup: clickAll('[data-assign-open]'), undo: 'Escape' });
  if (route === '#/dossier/card-payments') out.push({ name: 'inbox-start', setup: clickAll('[data-inbox-start]'), undo: 'Escape' });
  // A failing command's recent audit lines, opened under it on the Usage page (#309).
  if (route === '#/settings/usage') out.push({ name: 'audit-lines', setup: `(async () => { const n = ${clickAll('[data-usage-lines]', '/Show recent failures/')}; await new Promise((r) => setTimeout(r, 300)); return n; })()`, undoJs: clickAll('[data-usage-lines]', '/Hide recent failures/') });
  // The person's instructions are on the Agent page as it opens; the full prompt opens under them (#283).
  // The worklog (#308): a day rebuilt, which says how it compared, and an earlier month in the calendar.
  if (/\/worklog\/\d{4}-\d{2}-\d{2}$/.test(route)) out.push({ name: 'rebuilt', setup: `(async () => { const n = ${clickAll('[data-worklog-rebuild]')}; await new Promise((r) => setTimeout(r, 300)); return n; })()` });
  if (/\/worklog$/.test(route)) out.push({ name: 'previous-month', setup: clickAll('.calendar-nav button', '/Previous month/'), undoJs: clickAll('.calendar-nav button', '/Next month/') });
  if (route === '#/settings/agent') out.push({ name: 'full-prompt', setup: clickAll('[data-full-prompt]', '/Show the full prompt/'), undoJs: clickAll('[data-full-prompt]', '/Hide the full prompt/') });
  // Install (#344): the dialog with the exact npm command, before anything runs.
  if (route === '#/settings/agent') out.push({ name: 'install-dialog', setup: clickAll('[data-install="claude"]'), undo: 'Escape' });
  return out;
}

async function axeRun(page, source) {
  const has = await page.evaluate('typeof window.axe');
  if (has !== 'object') await page.evaluate(`${source}\n;true`);
  return page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'label-content-name-mismatch': { enabled: true } }, resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) })))`);
}

/**
 * Runs the check. `urlFor(theme, scheme, route)` is the address of one view
 * in one theme. Resolves with the problems that fail the run, the report-only
 * axe findings, and a count of what was checked.
 */
export async function checkLayout({ urlFor, runs = themeRuns(), routes = ROUTES, widths = WIDTHS, shots = null, motion = 'reduce', log = () => {} }) {
  const chrome = findChrome();
  if (!chrome) throw new Error('The layout check needs Chrome, Edge or Chromium, and found none. Install one, or set CHROME_PATH to it.');
  const axeSource = readFileSync(createRequire(join(ui, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
  const { page, close } = await openBrowser(chrome);
  const problems = [];
  const reported = [];
  let checked = 0;
  if (shots) mkdirSync(shots, { recursive: true });
  const shoot = async (name) => shots && writeFileSync(join(shots, `${name}.png`), await page.screenshot());
  try {
    await page.media([{ name: 'prefers-reduced-motion', value: motion }]);
    for (const run of runs) {
      const label = `${run.theme}${run.theme === 'plain' ? ` ${run.scheme}` : ''}`;
      for (const route of routes) {
        await page.size(widths[0]);
        await page.goto(urlFor(run.theme, run.scheme, route));
        await page.evaluate(SETTLED);
        const applied = await page.evaluate('document.documentElement.dataset.theme');
        if (applied !== run.theme) problems.push(`${label} ${route}: the page showed the ${applied} theme instead`);
        for (const width of widths) {
          await page.size(width);
          await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))))`);
          const where = `${label} ${route} at ${width}px`;
          const slug = `${run.theme}-${run.scheme}__${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}__${width}`;
          const record = (state, findings) => {
            for (const f of findings) problems.push(`${where}${state ? ` (${state})` : ''}: ${f.kind} at ${f.at}: ${f.detail}`);
          };
          await shoot(slug);
          // Every <details> open, since long values hide inside them.
          await page.evaluate(`document.querySelectorAll('details').forEach((d) => (d.open = true))`);
          await page.evaluate(`new Promise((r) => setTimeout(r, 100))`);
          record('', await page.evaluate(`(${inspect})(${JSON.stringify(CARDS)})`));
          record('', await page.evaluate(`(${covered})()`));
          checked++;
          const violations = await axeRun(page, axeSource);
          for (const v of violations) {
            const line = `${where}: axe ${v.id} (${v.impact}) at ${v.nodes.slice(0, 3).join(', ')}${v.nodes.length > 3 ? ` and ${v.nodes.length - 3} more` : ''}`;
            (run.strict ? problems : reported).push(line);
          }
          for (const state of states(route, width)) {
            // A state that opens nothing checks nothing, so it's a problem, never a quiet pass. clickAll waits for
            // its element to show, and an item in the compact header's Menu is looked for once the Menu is open (#289).
            const opened = await page.evaluate(state.setup);
            if (opened === -1) problems.push(`${where} (${state.name}): no Menu button to open`);
            else if (!opened) problems.push(`${where} (${state.name}): nothing to open; no element matching the selector showed within 5s`);
            await page.evaluate(`new Promise((r) => setTimeout(r, 300))`);
            await shoot(`${slug}__${state.name}`);
            record(state.name, await page.evaluate(`(${inspect})(${JSON.stringify(CARDS)})`));
            // An open sheet covers the page on purpose, like a dialog; only the page's own states must clear the dock.
            if (state.name === 'shown') record(state.name, await page.evaluate(`(${covered})()`));
            const stateViolations = run.strict && state.name !== 'shown' ? await axeRun(page, axeSource) : [];
            for (const v of stateViolations) problems.push(`${where} (${state.name}): axe ${v.id} (${v.impact}) at ${v.nodes.slice(0, 3).join(', ')}`);
            checked++;
            if (state.undo) await page.key(state.undo);
            if (state.undoJs) await page.evaluate(state.undoJs);
            await page.evaluate(`new Promise((r) => setTimeout(r, 200))`);
          }
          if (page.errors.length) problems.push(`${where}: the page threw ${page.errors.splice(0).join('; ')}`);
        }
        log(`${label} ${route}: ${problems.length} problem(s) so far`);
      }
    }
  } finally {
    await close();
  }
  return { problems, reported, checked };
}

// Run by hand: node scripts/layout-check.mjs --base <url> ...
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const many = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
  const one = (flag) => many(flag)[0];
  const base = one('--base');
  if (!base) {
    console.error('Usage: node scripts/layout-check.mjs --base <url> [--theme <name>] [--route <hash>] [--width <px>] [--motion full] [--shots <dir>] [--json <file>]');
    process.exit(2);
  }
  const themes = many('--theme');
  const runs = themeRuns().filter((r) => !themes.length || themes.includes(r.theme) || themes.includes(`${r.theme}-${r.scheme}`));
  const routes = many('--route').length ? many('--route') : ROUTES;
  const widths = many('--width').length ? many('--width').map(Number) : WIDTHS;
  const urlFor = (theme, scheme, route) => {
    const u = new URL(base);
    u.searchParams.set('theme', theme);
    u.searchParams.set('scheme', scheme);
    u.hash = route;
    return u.href;
  };
  const motion = one('--motion') === 'full' ? 'no-preference' : 'reduce';
  const result = await checkLayout({ urlFor, runs, routes, widths, motion, shots: one('--shots') ?? null, log: (l) => console.error(l) });
  for (const r of result.reported) console.log(`report-only: ${r}`);
  for (const p of result.problems) console.log(`problem: ${p}`);
  if (one('--json')) writeFileSync(one('--json'), JSON.stringify(result, null, 2));
  console.log(`layout check: ${result.checked} views and states checked, ${result.problems.length} problem(s), ${result.reported.length} report-only axe finding(s)`);
  process.exitCode = result.problems.length ? 1 : 0;
}
