import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloneBuild, cloneManual, cloneQuick, npmCommands } from '../site/src/data/start.js';

/**
 * The homepage's two ways to start (site/src/data/start.ts) against the
 * README they're copied from, and the one-command clone setup they lead with.
 */
const readme = readFileSync('README.md', 'utf8');
const lines = new Set(readme.split(/\r?\n/));
// README code blocks may carry a trailing comment the site leaves off.
const inReadme = (command: string) => [...lines].some((line) => line === command || line.startsWith(`${command} `));

describe('start commands', () => {
  it.each([...npmCommands, cloneQuick, ...cloneManual, ...cloneBuild])('README.md has %s', (command) => {
    expect(inReadme(command)).toBe(true);
  });

  it('scripts/setup.mjs runs from a clone with --skip-build --no-alias', () => {
    const run = spawnSync(process.execPath, ['scripts/setup.mjs', '--skip-build', '--no-alias'], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('"version"');
    expect(run.stdout).toContain('skill install --allow-write');
  });

  it('scripts/setup.mjs refuses an unknown option plainly', () => {
    const run = spawnSync(process.execPath, ['scripts/setup.mjs', '--fast'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unknown option --fast');
  });
});
