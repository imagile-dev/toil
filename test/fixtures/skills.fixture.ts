import type { GitCall, GitResult } from '../../src/core/git.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * The skills area works on files and git, not HTTP. Its examples run in a
 * seeded home folder (a fresh copy per run, at the same path, so the CLI run
 * and the MCP run start from the same disk) holding one marketplace clone and
 * the skills folders it installed into, and against a canned git that
 * answers `rev-parse` and `pull` as a clone with nothing new would.
 *
 * Provenance: the clone and folder layouts are written by hand in the shapes
 * skills managers write (`.claude-plugin/marketplace.json`, `plugins/<name>/
 * skills/<skill>/SKILL.md`, `.toil-installed.json`); git's answers are the
 * ones git 2.49 prints for an up-to-date fast-forward pull.
 */

export const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
export const REPO = 'https://bitbucket.imagile.dev/scm/ai/skills.git';
const CLONE = '.agents/marketplaces/skills';

const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
const record = (plugin: string) => ({
  source: 'marketplace',
  marketplace: 'skills',
  plugin,
  installedFrom: REPO,
  branch: 'main',
  installedAt: '2026-10-01T09:00:00.000Z',
  toilVersion: '0.0.0-test',
});

/** A skills folder with `review` on, `docs` switched off, and one skill toil didn't install. */
const folder = (dir: string): Record<string, string> => ({
  [`${dir}/code-review/SKILL.md`]: skill('code-review', 'Reviews a change'),
  [`${dir}/.toil-disabled/write-docs/SKILL.md`]: skill('write-docs', 'Writes docs'),
  [`${dir}/my-notes/SKILL.md`]: skill('my-notes', 'A skill written by hand'),
  [`${dir}/.toil-installed.json`]: `${JSON.stringify({ version: 1, skills: { 'code-review': record('review') }, disabled: { 'write-docs': record('docs') } }, null, 2)}\n`,
});

export const HOME: Record<string, string> = {
  [`${CLONE}/.git/HEAD`]: 'ref: refs/heads/main\n',
  [`${CLONE}/.git/refs/heads/main`]: `${SHA}\n`,
  [`${CLONE}/.git/config`]: `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${REPO}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  [`${CLONE}/.claude-plugin/marketplace.json`]: `${JSON.stringify(
    {
      name: 'skills',
      plugins: [
        { name: 'review', description: 'Code review skills', source: './plugins/review' },
        { name: 'docs', description: 'Documentation skills', source: './plugins/docs' },
      ],
    },
    null,
    2,
  )}\n`,
  [`${CLONE}/plugins/review/skills/code-review/SKILL.md`]: skill('code-review', 'Reviews a change'),
  [`${CLONE}/plugins/docs/skills/write-docs/SKILL.md`]: skill('write-docs', 'Writes docs'),
  ...folder('.agents/skills'),
  ...folder('.claude/skills'),
};

const ok = (stdout = ''): GitResult => ({ exitCode: 0, stdout, stderr: '' });

export const git = {
  async run(call: GitCall): Promise<GitResult> {
    if (call.subcommand === 'rev-parse') return ok(`${SHA}\n`);
    if (call.subcommand === 'pull') return ok('Already up to date.\n');
    throw new Error(`The skills fixture has no canned answer for git ${call.subcommand}.`);
  },
};

export const fixture = defineFixture({
  area: 'skills',
  config: { skills: { repoUrl: REPO, writes: true } },
  home: HOME,
  git,
});
