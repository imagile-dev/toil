import { defineFixture } from '../harness/fixtures.js';

/**
 * `toil skill show` reads the agent skills folders in a seeded home: one toil
 * skill that `toil skill install` wrote (recorded as bundled, by the test
 * version), and one Claude Code copy made by hand, which isn't toil's and so
 * isn't listed. The config has a Jira and a SQLite connection, so the
 * description names both.
 *
 * Provenance: the folder and index shapes are the ones src/skills/bundled.ts
 * writes; the SKILL.md text is cut down, since show compares it, it doesn't
 * parse it.
 */
const record = { source: 'bundled', installedAt: '2026-10-01T09:00:00.000Z', toilVersion: '0.0.0-test' };

export const fixture = defineFixture({
  area: 'skill',
  config: {
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'fake-token-abc12345' },
    db: { engine: 'sqlite', path: '/srv/data/app.db' },
  },
  home: {
    '.agents/skills/toil/SKILL.md': '---\nname: toil\ndescription: Use toil.\n---\n\n# toil\n',
    '.agents/skills/toil/toil-origin.json': `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`,
    '.agents/skills/.toil-installed.json': `${JSON.stringify({ version: 1, skills: { toil: record } }, null, 2)}\n`,
    '.claude/skills/toil/SKILL.md': '---\nname: toil\ndescription: Copied by hand.\n---\n\n# toil\n',
  },
});
