// Seeds the Overdraft Federal Engineering knowledge base (Confluence space OD, 23 pages)
// for the demo recordings (docs/demo-story.md) through toil's own commands, so the
// write gate decides: the confluence connection needs writes on. Each step looks
// first: an existing space is kept and an existing page is updated in place, so
// running it twice is safe. The pages are pages/*.html, in the order and tree
// manifest.json gives; edit them there. Creating the space needs a toil with
// `confluence space create`; once the space exists, any toil will do.
//
//   node ui/scripts/demo-confluence/seed.mjs [--toil <path to toil.js>] [--connection confluence]
//
// There is deliberately no "Black Friday readiness" page: the agent writes it in
// video 5. Repo tooling only: nothing here ships. A wiki that is complete and up
// to date, which is how you can tell it is demo data.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const toilJs = arg('--toil', join(here, '..', '..', '..', 'dist', 'toil.js'));
const connection = arg('--connection', 'confluence');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const KEY = manifest.space.key;

function toil(...argv) {
  const r = spawnSync(process.execPath, [toilJs, '--workspace', here, 'confluence', ...argv, '--connection', connection], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`toil ${argv.join(' ')} printed no envelope: ${r.stderr || r.stdout}`);
  }
}
function must(env, what) {
  if (!env.ok) throw new Error(`${what}: ${env.error.code} ${env.error.message}${env.error.fix ? `\n  fix: ${env.error.fix}` : ''}`);
  return env.data;
}

let space = toil('space', 'get', KEY);
if (!space.ok && space.error.code === 'NOT_FOUND') {
  must(toil('space', 'create', KEY, '--name', manifest.space.name, '--description', manifest.space.description, '--allow-write'), 'space create');
  console.log(`created space ${KEY}`);
  space = toil('space', 'get', KEY);
}
const found = must(space, 'space get');
const homepageId = String(found.homepageId ?? found.homepage?.id ?? '');
if (!homepageId) throw new Error(`space ${KEY} has no homepage id in its answer`);

const ids = new Map([[null, homepageId]]);
for (const p of manifest.pages) {
  let id;
  if (p.parent === null && p.title === manifest.space.name) {
    // The space homepage: Confluence made it; rename and fill it.
    id = homepageId;
    must(toil('page', 'update', id, '--title', p.title, '--body-file', p.file, '--allow-write'), `update homepage`);
    console.log(`updated  ${p.title}`);
  } else {
    const parentId = ids.get(p.parent);
    if (!parentId) throw new Error(`"${p.title}" comes before its parent "${p.parent}" in manifest.json`);
    const existing = toil('page', 'find', '--space', KEY, '--title', p.title);
    if (existing.ok) {
      id = String(existing.data.id);
      must(toil('page', 'update', id, '--body-file', p.file, '--allow-write'), `update ${p.title}`);
      console.log(`updated  ${p.title}`);
    } else if (existing.error.code === 'NOT_FOUND') {
      id = String(must(toil('page', 'create', '--space', KEY, '--title', p.title, '--body-file', p.file, '--parent-id', parentId, '--allow-write'), `create ${p.title}`).id);
      console.log(`created  ${p.title}`);
    } else {
      must(existing, `find ${p.title}`);
    }
  }
  ids.set(p.title, id);
  // toil-seed marks what a seed made, as the other sandboxes' seeds do.
  must(toil('page', 'label', id, '--labels', ['toil-seed', ...p.labels].join(','), '--allow-write'), `label ${p.title}`);
}
console.log(`${manifest.pages.length} pages in space ${KEY}`);
