import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Local git: status, diff, log, branches and a commit report for the
 * repository the workspace is in. No server, no connection and no credential;
 * the commands run git itself, the one optional program toil may run (#68
 * decision 1), through `ctx.git` and its safeguards in src/core/git.ts. Where
 * the repository is comes from `ctx.repo()`, read from `.git` in pure JS.
 * The only area whose entire configuration fits on a sticky note, with room left for the sign-off.
 */
export const gitArea = defineArea({
  name: 'git',
  description: 'Local git: status, diff, log, branches and a commit report for the repository in the workspace',
  connection: z.object({}),
});

/** Not established; core refuses a git older than 2.24 on its own (it needs `--end-of-options`). */
export const gitSupported: SupportedVersion = {
  product: 'git',
  minimum: null,
  note: 'Runs the git already on PATH. toil needs git 2.24 or later for its argument safeguards and refuses an older one with GIT_NOT_FOUND; output parsing was checked against git 2.49.',
};
