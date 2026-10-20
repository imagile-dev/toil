// The last step of `npm run build`. The function redacts reports with the
// module triage uses, scripts/triage/redact.mjs, which reads its token shapes
// from src/core/token-shapes.mjs. Both are plain JavaScript outside this
// package, so tsc doesn't emit them. tsconfig.build.json compiles with the
// repository root as rootDir, so dist/ mirrors the repository's layout, and
// this copies the two files to the same relative paths under dist/. The
// imports then resolve in the deployed package exactly as they do in a
// checkout, with no bundler and no second copy anyone has to keep in step.
//
// It finishes by loading the built redaction module and redacting a sample, so
// a layout that would break in Azure breaks the build instead, where it is
// cheaper to find out. The form for that is in triplicate, and all three
// copies are this file.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(pkg, '../..');
const dist = join(pkg, 'dist');
const SHARED = ['scripts/triage/redact.mjs', 'src/core/token-shapes.mjs'];

for (const path of SHARED) {
  const target = join(dist, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(repo, path), target);
}

const built = join(dist, 'functions/feedback/src/lib/redaction.js');
const { redact, parseTerms } = await import(pathToFileURL(built).href);
const sample = redact('ghp_' + 'a1B2'.repeat(9) + ' at jira.acmebank.corp from 10.1.2.3', parseTerms('acmebank'));
if (sample !== '[redacted-secret] at jira.imagile.dev from [redacted-ip]') {
  console.error(`copy-shared: the built redaction module answered ${JSON.stringify(sample)}; the package layout is broken.`);
  process.exit(1);
}
console.log(`copy-shared: ${SHARED.join(', ')} copied into dist/; the built function redacts.`);
