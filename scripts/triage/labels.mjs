// The labels triage uses, made before the agent runs so it never has to create
// one: one `area:<name>` per area in the registry (every src/areas/<name>/ with
// an index.ts, the same rule scripts/gen-areas.mjs registers by), plus the
// workflow's own. Existing labels are left exactly as they are. Labels nobody
// asked for are how a tracker turns into a taxonomy committee.
//
//   node scripts/triage/labels.mjs           creates what's missing (GH_TOKEN, GITHUB_REPOSITORY)
//   node scripts/triage/labels.mjs --list    prints the label names, one per line
//   node scripts/triage/labels.mjs --areas   prints the area names, space-separated

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gh } from './cap.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FIXED = [
  { name: 'from-website', color: 'f9a03f', description: 'Filed through the form on the toil site' },
  { name: 'from-terminal', color: 'f9a03f', description: 'Filed with curl through /api/report' },
  { name: 'unverified-build', color: 'e4e669', description: 'Reported about a commit that is not on main' },
  { name: 'smoke-test', color: 'cccccc', description: 'The one issue the feedback smoke test writes to' },
  { name: 'triage-claimed', color: 'bfdadc', description: 'Triage is running on this issue today' },
  { name: 'triage-queued', color: 'bfdadc', description: "Waiting for a triage slot; the daily run takes the queue oldest first" },
  { name: 'triaged', color: '0e8a16', description: 'An agent triaged this issue' },
  { name: 'triage-failed', color: 'fbca04', description: 'Triage failed on this issue once; a second failure hands it to a maintainer' },
  { name: 'needs-human', color: 'd93f0b', description: 'Automation stopped here; a maintainer takes it from this point' },
  { name: 'needs-maintainer', color: 'd93f0b', description: 'Triage left this open for a maintainer to take on' },
  { name: 'denied', color: 'b60205', description: 'Triage declined this request, with the reason in a comment' },
  { name: 'duplicate', color: 'cfd3d7', description: 'The same request as an earlier issue, which the comment names' },
  { name: 'from-triage', color: '5319e7', description: 'A pull request opened by triage; a human reviews and merges it' },
];

/** The area names in the registry: every src/areas/<name>/ that has an index.ts. */
export function areas(dir = join(root, 'src', 'areas')) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort();
}

export function labels(dir) {
  return [...FIXED, ...areas(dir).map((name) => ({ name: `area:${name}`, color: 'ededed', description: `The ${name} area` }))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wanted = labels();
  if (process.argv.includes('--areas')) {
    console.log(areas().join(' '));
    process.exit(0);
  }
  if (process.argv.includes('--list')) {
    for (const label of wanted) console.log(label.name);
    process.exit(0);
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('labels.mjs: set GITHUB_REPOSITORY.');
    process.exit(1);
  }
  const existing = new Set();
  for (let page = 1; page <= 10; page++) {
    const batch = await gh('GET', `/repos/${repo}/labels?per_page=100&page=${page}`);
    for (const label of batch) existing.add(label.name.toLowerCase());
    if (batch.length < 100) break;
  }
  const missing = wanted.filter((label) => !existing.has(label.name.toLowerCase()));
  for (const label of missing) await gh('POST', `/repos/${repo}/labels`, label);
  console.log(missing.length ? `Created ${missing.length} label(s): ${missing.map((l) => l.name).join(', ')}` : 'Every triage label exists.');
}
