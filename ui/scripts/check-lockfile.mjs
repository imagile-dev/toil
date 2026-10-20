// The lockfile check (#299): `npm run check:lockfile -w ui`, after
// `npm ci --ignore-scripts`. It fails when package-lock.json would install a
// toil for Toil UI other than the one ui/package.json pins: the entry's
// version, its tarball URL, and the version of the copy npm actually
// installed must all be the pin (scripts/package-rules.mjs, lockfileProblems).
// CI runs it on every PR but the release PR, whose pin is the toil that PR
// releases and npm can't serve yet; the release workflow regenerates the entry
// once it has published (release.yml, the lockfile job). Repo tooling only.
// Three signatures on one form, checked against each other for once.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockfileProblems } from './package-rules.mjs';

const ui = join(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pin = read(join(ui, 'package.json')).dependencies['@imagile-dev/toil'];
const lock = read(join(ui, '..', 'package-lock.json'));
let installed = null;
try {
  installed = read(join(ui, '..', 'node_modules', '@imagile-dev', 'toil', 'package.json')).version;
} catch {
  // Not installed: lockfileProblems says so.
}
const problems = lockfileProblems(lock, pin, installed);
if (problems.length) {
  console.error(`check:lockfile found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:lockfile ok: package-lock.json installs @imagile-dev/toil ${pin} for Toil UI, the version it pins, and npm ci installed exactly that.`);
