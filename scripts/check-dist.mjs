// dist/toil.js is committed, so a fresh clone runs `node dist/toil.js` with no
// npm install, and it is the last released toil: only the release PR rebuilds
// it (.github/workflows/release.yml). Two checks keep it that way:
//
//   node scripts/check-dist.mjs              after `npm run build` on the release
//                                            PR: the committed bundle is what its
//                                            source builds.
//   node scripts/check-dist.mjs --untouched  on every other PR: nothing under
//                                            dist/ changed against the base.
//
// A bundle edited by hand is a second, unreviewed release channel, and one
// release channel already needs a change ticket.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The bin and the one bundle of code it runs (scripts/entries.mjs). The rest of dist/ isn't committed.
const FILES = ['dist/toil.js', 'dist/toil-lib.js'];
const FILE = FILES[0];
// release-please's own branch for this repository's one package.
const RELEASE_BRANCH = 'release-please--';

// No shell: every argument is fixed or comes from CI's env as one argv entry.
const git = (args) => {
  const run = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) {
    console.error(`check:dist: git didn't run (${run.error.message}). It needs git on PATH.`);
    process.exit(1);
  }
  return run;
};

if (process.argv.includes('--untouched')) {
  const base = process.env.BASE_SHA;
  const branch = process.env.HEAD_REF ?? '';
  if (!base) {
    console.error('check:dist --untouched: set BASE_SHA to the pull request base commit.');
    process.exit(1);
  }
  if (branch.startsWith(RELEASE_BRANCH)) {
    console.log(`check:dist --untouched: ${branch} is the release PR, which rebuilds ${FILE}; skipped.`);
    process.exit(0);
  }
  // The PR that first commits the bundle has nothing on its base to protect.
  if (git(['cat-file', '-e', `${base}:${FILE}`]).status !== 0) {
    console.log(`check:dist --untouched: the base has no ${FILE} yet, so this PR may add it.`);
    process.exit(0);
  }
  const changed = git(['diff', '--name-only', `${base}...HEAD`, '--', 'dist/']);
  if (changed.status !== 0) {
    console.error(`check:dist --untouched: git diff failed: ${changed.stderr.trim()}`);
    process.exit(1);
  }
  const files = changed.stdout.split('\n').filter(Boolean);
  if (files.length) {
    console.error(
      `check:dist --untouched: this PR changes ${files.join(', ')}. Only the release PR rebuilds the committed bundle;` +
        ` restore it with git checkout ${base} -- dist/ and commit that.`,
    );
    process.exit(1);
  }
  console.log('check:dist --untouched ok: nothing under dist/ changed.');
  process.exit(0);
}

// git compares the working tree with the index, so in CI (a clean checkout of
// the release PR) it compares the fresh build with the commit. Both committed
// files: the bin and the bundle it runs.
for (const file of FILES) {
  if (git(['ls-files', '--error-unmatch', '--', file]).status !== 0) {
    console.error(`check:dist: ${file} isn't tracked by git. The release PR commits it.`);
    process.exit(1);
  }
}
// The bundle records the commit it was built from on one marked line
// (tsup.config.ts), and a rebuild on the next commit records that one instead,
// so the comparison sets that line aside. Everything else must match exactly.
const COMMIT_LINE = /^const __TOIL_COMMIT__ = .*; \/\/ toil-build-commit$/m;
const comparable = (text) => text.replace(COMMIT_LINE, 'const __TOIL_COMMIT__ = <commit>; // toil-build-commit');
const differing = [];
for (const file of FILES) {
  const committed = git(['show', `:${file}`]);
  if (committed.status !== 0) {
    console.error(`check:dist: git show failed for ${file}: ${committed.stderr.trim()}`);
    process.exit(1);
  }
  if (comparable(committed.stdout) !== comparable(readFileSync(file, 'utf8'))) differing.push(file);
}
if (differing.length === 0) {
  console.log(`check:dist ok: ${FILES.join(' and ')} match what their source builds.`);
} else {
  console.error(`check:dist: ${differing.join(' and ')} don't match what their source builds. The release workflow rebuilds them on the release PR; run it again, or run npm run build there and commit them.`);
  process.exit(1);
}
