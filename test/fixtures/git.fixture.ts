import type { GitCall, GitResult, GitRunner } from '../../src/core/git.js';
import { gitArgv } from '../../src/core/git.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * The git area runs git, not HTTP, so it has no routes. Its examples run
 * against a canned git: each call's argv (built by core's own gitArgv, so a
 * call core would refuse fails here too) maps to the stdout real git printed.
 * The parity suite traces that runner, so both front doors must ask git the
 * same thing.
 *
 * Provenance: written by hand in the shapes git 2.49 prints, which the area's
 * real-git test (src/areas/git/git.test.ts) checks against the binary itself;
 * the numstat shape matches the contract's recorded examples. The authors are
 * fictional and have never once been asked to fill in a timesheet.
 */

const US = '\x1F';
const MARK = '__TOIL_COMMIT__';

export const STATUS = ' M src/retry.ts\nM  README.md\nMM src/client.ts\n?? notes.txt\n';

export const DIFF = [
  'diff --git a/src/retry.ts b/src/retry.ts',
  'index 3b18e51..a1c2d3e 100644',
  '--- a/src/retry.ts',
  '+++ b/src/retry.ts',
  '@@ -1,3 +1,4 @@',
  ' export const MAX_RETRIES = 3;',
  '-export const BACKOFF_MS = 100;',
  '+export const BACKOFF_MS = 250;',
  '+export const JITTER = true;',
  ' export default MAX_RETRIES;',
  '\\ No newline at end of file',
  'diff --git a/logo.png b/logo.png',
  'index 1111111..2222222 100644',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

export const LOG = [
  `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0${US}Ada Lovelace${US}2026-09-29T10:15:00+02:00${US}Raise the retry backoff`,
  `0f9e8d7c6b5a49382716f5e4d3c2b1a098765432${US}Grace Hopper${US}2026-09-21T23:30:00-04:00${US}Add jitter, with a comma, to retries`,
  '',
].join('\n');

export const BRANCHES = '* feature/retries\n  main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n';

export const NUMSTAT = [
  `${MARK}a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\tAda Lovelace\t2026-09-29T10:15:00+02:00\tRaise the retry backoff`,
  '',
  '2\t1\tsrc/retry.ts',
  '-\t-\tlogo.png',
  `${MARK}0f9e8d7c6b5a49382716f5e4d3c2b1a098765432\tGrace Hopper\t2026-09-21T23:30:00-04:00\tAdd jitter, with a comma, to retries`,
  '',
  '10\t0\tsrc/jitter.ts',
  '',
].join('\n');

const ok = (stdout: string): GitResult => ({ exitCode: 0, stdout, stderr: '' });

/** stdout by argv, as git would print it for each call the examples make. */
const canned = new Map<string, string>([
  [['status', '--porcelain'], STATUS],
  [['diff'], DIFF],
  [['diff', '--staged', '--', 'src/retry.ts'], DIFF.split('diff --git a/logo.png')[0]!],
  [['log', `--format=%H${US}%an${US}%aI${US}%s`, '-n10'], LOG],
  [['log', `--format=%H${US}%an${US}%aI${US}%s`, '-n5', '--since=2 weeks ago'], LOG],
  [['branch', '-a'], BRANCHES],
  [['log', `--format=${MARK}%H\t%an\t%aI\t%s`, '--numstat'], NUMSTAT],
  [
    ['log', `--format=${MARK}%H\t%an\t%aI\t%s`, '--numstat', '--since=2026-09-01T00:00:00+00:00', '--until=2026-09-30T00:00:00+00:00', '--end-of-options', 'main..feature/retries'],
    NUMSTAT,
  ],
].map(([argv, out]) => [JSON.stringify(argv), out as string]));

/** The argv after core's fixed safeguards, which every call carries. */
export const callKey = (call: GitCall): string => JSON.stringify(gitArgv(call).filter((a, i, all) => !isSafeguard(a, i, all)));
const SAFEGUARDS = new Set(['--no-pager', '--no-ext-diff', '--no-textconv', 'core.fsmonitor=', 'log.showSignature=false']);
function isSafeguard(arg: string, i: number, all: string[]): boolean {
  return SAFEGUARDS.has(arg) || (arg === '-c' && SAFEGUARDS.has(all[i + 1] ?? ''));
}

/** A git that answers the calls above and fails anything else loudly. */
export const cannedGit: GitRunner = {
  run: async (call) => {
    const out = canned.get(callKey(call));
    if (out === undefined) throw new Error(`git fixture: no canned output for ${callKey(call)}`);
    return ok(out);
  },
};

export const fixture = defineFixture({
  area: 'git',
  repo: { root: '/work', branch: 'feature/retries', remotes: ['https://bitbucket.imagile.dev/scm/PROJ/imagile-api.git'] },
  git: cannedGit,
  trace: [{ label: 'git', target: cannedGit }],
});
