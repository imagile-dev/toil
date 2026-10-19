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
//   - something fixed to the bottom of the screen (the Ask dock) covering the
//     end of the page once it is scrolled all the way down;
//   - a row that must stay one row (`data-one-row`: the compact header, the
//     settings tabs) wrapping onto a second;
//   - an open modal whose backdrop doesn't dim the page;
//   - and, in the strict themes (Plain light and dark, and Crate), any axe
//     violation at WCAG 2.2 AA. The other themes' axe findings are reported,
//     never failed (the maintainer's bar, AGENT_DECISIONS.md, #267).
//
// Each view is checked as it opens and with its hidden parts showing: every
// <details> open, each dossier card's Show pressed, the header menu and the
// Feedback dialog open, and the Ask dock both closed and open. Reduced motion
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
  item('card-payments', 'corp-jira:PAY-100'),
  item('settlement', 'corp-ado:2304'),
  '#/settings/connections',
  '#/settings/dossiers',
  '#/settings/toil',
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

const clickAll = (selector, text) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((b) => ${text ? `${text}.test(b.textContent ?? '')` : 'true'} && b.getClientRects().length);
  for (const b of els) b.click();
  return els.length;
})()`;

/** The states each view is checked in, beyond how it opens. */
function states(route, width) {
  const out = [];
  const narrow = width <= 1000;
  if (width < 768) out.push({ name: 'menu', setup: clickAll('[data-menu-button]'), undo: 'Escape' });
  if (route === '#/') out.push({ name: 'feedback', setup: clickAll('button.feedback-open, [data-feedback-open]'), undo: 'Escape', inMenu: width < 768 });
  if (route === '#/settings/dossiers') out.push({ name: 'shown', setup: clickAll('.conn-card button', '/^Show$/') });
  if (/^#\/dossier\/[^/]+$/.test(route) && narrow) out.push({ name: 'ask-open', setup: clickAll('.ask--sheet .ask-head button', '/Open/'), undoJs: clickAll('.ask--sheet .ask-head button', '/Hide/') });
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
            if (state.inMenu) await page.evaluate(clickAll('[data-menu-button]'));
            await page.evaluate(state.setup);
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
