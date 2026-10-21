// After `astro build`: every help topic's Read more link in Toil UI
// (ui/src/help.ts, #346) must land on a page this build made and an element
// with that id on it. ui/test/help.test.tsx checks the same links against the
// markdown's headings; this is the check against what was actually built, so
// a heading Astro slugs differently from the test fails here, before a reader
// finds a dead anchor. The topics file is plain TypeScript with no imports,
// which Node runs as it is.
// A link that resolves is a link that was audited, at least once.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP } from '../../ui/src/help.ts';

const dist = join(import.meta.dirname, '..', 'dist');
const problems = [];
for (const [id, topic] of Object.entries(HELP)) {
  const file = join(dist, ...topic.page.split('/').filter(Boolean), 'index.html');
  if (!existsSync(file)) {
    problems.push(`${id}: ${topic.page} isn't a page this build made (no ${file})`);
    continue;
  }
  if (!readFileSync(file, 'utf8').includes(`id="${topic.anchor}"`)) problems.push(`${id}: ${topic.page} has no element with id "${topic.anchor}"`);
}
if (problems.length) {
  console.error(`Help links that don't resolve (ui/src/help.ts):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`help links: all ${Object.keys(HELP).length} resolve to a page and an anchor in this build`);
