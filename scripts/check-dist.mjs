// dist/toil.js is committed, so a fresh clone runs `node dist/toil.js` with no
// npm install. This checks the committed bundle is the one its source builds:
// run it after `npm run build`, which rewrites the file in the working tree, and
// any difference from what git has staged or committed fails the gate. A bundle
// that drifts from its source is a second, unreviewed release channel, and one
// release channel already needs a change ticket.
import { spawnSync } from 'node:child_process';

const FILE = 'dist/toil.js';

// git compares the working tree with the index, so a rebuilt bundle that has
// been staged passes locally, and in CI (a clean checkout) it compares with
// the commit. No shell: the arguments are fixed.
const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', FILE], { encoding: 'utf8' });
if (tracked.error) {
  console.error(`check:dist: git didn't run (${tracked.error.message}). It needs git on PATH.`);
  process.exit(1);
}
if (tracked.status !== 0) {
  console.error(`check:dist: ${FILE} isn't tracked by git. Run npm run build, then git add ${FILE} and commit it.`);
  process.exit(1);
}

const diff = spawnSync('git', ['diff', '--quiet', '--', FILE], { encoding: 'utf8' });
if (diff.status === 0) {
  console.log(`check:dist ok: ${FILE} matches what its source builds.`);
} else if (diff.status === 1) {
  console.error(
    `check:dist: ${FILE} doesn't match what its source builds. Run npm run build and commit ${FILE} with the change.` +
      ` After merging main, rebuild rather than resolving conflicts in it by hand.`,
  );
  process.exit(1);
} else {
  console.error(`check:dist: git diff failed: ${diff.stderr.trim()}`);
  process.exit(1);
}
