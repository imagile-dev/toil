// What a triage fix may touch, checked by .github/workflows/triage.yml from a
// fresh checkout after the agent has finished, before anything is pushed. The
// agent's own prompt says the same, but a prompt is a request; this is the rule.
//
// At most one area, and only its own files; and Toil UI, within the folders
// named below (the maintainer's decision on #487, 2026-10-26). A fix may be an
// area, Toil UI, or both:
//   src/areas/<area>/**                     the code
//   test/fixtures/<area>.fixture.ts         its fixture
//   skills/toil/<area>.md                   its docs page
//   docs/divergences/<area>.json            its divergences
//   site/src/data/integrations/<area>.json  its board entry
//   site/src/data/commands/<area>.json      generated from the registry by the tests
//   site/src/data/settings/<area>.json      generated from the registry by the tests
//
//   ui/src/**  ui/server/**  ui/test/**  ui/docs/**  ui/themes/**   Toil UI
//
// All of ui/ but the one server file that spawns (agents/install.ts), Toil UI's
// package.json and lockfile entries, build and lint configuration, and
// ui/scripts/ (the verify and smoke tooling that gates it), which stay
// maintainer work. That is the maintainer's call (#487, 2026-10-26, after the
// narrower rules were weighed): Toil UI issues are not maintainer-only work.
// Some of what that admits is Toil UI's safety layer (SAFETY_LAYER below). The
// scope does not stop an edit to it; it makes the edit impossible to miss:
// check() lists every one, and open-pr puts them under "Safety-layer edits"
// at the top of the draft PR's description, where the maintainer reads first.
//
// Everything else (core, the workflows and the rest of .github/, functions/,
// infra/, site pages, dist/, package.json, the lockfile) is maintainer work.
// Files only: no symlinks, no submodules, nothing outside the tree. A form
// that lists the permitted fields is the one kind of form toil approves of.
//
//   git diff --raw -z --no-renames <base> <head> | node scripts/triage/changes.mjs <area>...
//   → prints the area changed (or `ui` when only Toil UI changed) and exits 0,
//     or names every refused path and exits 1

import { pathToFileURL } from 'node:url';

const PER_AREA = [
  (a) => (p) => p.startsWith(`src/areas/${a}/`),
  (a) => (p) => p === `test/fixtures/${a}.fixture.ts`,
  (a) => (p) => p === `skills/toil/${a}.md`,
  (a) => (p) => p === `docs/divergences/${a}.json`,
  (a) => (p) => p === `site/src/data/integrations/${a}.json`,
  (a) => (p) => p === `site/src/data/commands/${a}.json`,
  (a) => (p) => p === `site/src/data/settings/${a}.json`,
];

const UI_FOLDERS = ['ui/src/', 'ui/server/', 'ui/test/', 'ui/docs/', 'ui/themes/'];
/** The one Toil UI server file that starts a process (`npm install` of an agent SDK, on a person's press). */
const UI_SPAWNER = 'ui/server/agents/install.ts';

/**
 * Toil UI's safety layer: the files that decide what its server, its agent and
 * Settings may run or reach. A triage fix may edit them; every such edit is
 * called out in the PR (the maintainer's call on #487). `reads.ts` is the read
 * list and `store.ts` the read-only lock; `src/config.ts` is Settings' write allowlist.
 */
export const SAFETY_LAYER = [
  'ui/server/server.ts', 'ui/server/context.ts', 'ui/server/csp.ts', 'ui/server/config.ts', 'ui/server/store.ts', 'ui/server/reads.ts',
  'ui/server/agents/tools.ts', 'ui/server/agents/env.ts', 'ui/server/agents/claude.ts', 'ui/server/agents/codex.ts', 'ui/server/agents/copilot.ts',
  'ui/src/config.ts', 'ui/test/server.test.ts',
];

const wellFormed = (path) => !(path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.' || part === '') || path.startsWith('/'));

/** Whether a path is one of Toil UI's own files that a triage fix may touch. */
export function isUi(path) {
  return wellFormed(path) && path !== UI_SPAWNER && UI_FOLDERS.some((folder) => path.startsWith(folder));
}

/** The area a path belongs to, or undefined when it isn't one any area may touch. */
export function areaOf(path, areas) {
  if (!wellFormed(path)) return undefined;
  return areas.find((area) => PER_AREA.some((rule) => rule(area)(path)));
}

/** Parses `git diff --raw -z` into { path, newMode } entries. */
export function parseRaw(raw) {
  const fields = raw.split('\0').filter((field, i, all) => field !== '' || i < all.length - 1);
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i];
    const path = fields[i + 1];
    if (!meta.startsWith(':')) throw new Error(`Unexpected git diff --raw output near ${JSON.stringify(meta.slice(0, 40))}.`);
    const [, newMode] = meta.slice(1).split(' ');
    entries.push({ path, newMode });
  }
  return entries;
}

/** Checks a triage branch's changes: at most one area's own files and Toil UI's, regular files only. */
export function check(entries, areas) {
  const refused = [];
  const touched = new Set();
  let ui = false;
  for (const { path, newMode } of entries) {
    const area = areaOf(path, areas);
    const inUi = !area && isUi(path);
    if (!area && !inUi) refused.push(`${path} (outside an area's own files and Toil UI's)`);
    else if (newMode !== '100644' && newMode !== '100755' && newMode !== '000000') refused.push(`${path} (mode ${newMode}: only regular files)`);
    else if (inUi) ui = true;
    else touched.add(area);
  }
  if (touched.size > 1) refused.push(`more than one area: ${[...touched].sort().join(', ')}`);
  if (entries.length === 0) refused.push('no changes');
  return { ok: refused.length === 0, area: touched.size === 1 ? [...touched][0] : undefined, ui, safety: entries.map((e) => e.path).filter((p) => SAFETY_LAYER.includes(p)).sort(), refused };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const areas = process.argv.slice(2);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = check(parseRaw(Buffer.concat(chunks).toString('utf8')), areas);
  if (!result.ok) {
    console.error(`The triage branch changes files triage may not touch:\n${result.refused.map((r) => `  - ${r}`).join('\n')}`);
    process.exit(1);
  }
  console.log(result.area ?? 'ui');
}
