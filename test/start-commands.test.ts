import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The homepage's two ways to start (site/src/data/start.json) against the
 * README they're copied from, and the one-command clone setup they lead with.
 * The list is JSON and read from disk, not imported as a module under site/,
 * because that would make Vite load site/tsconfig.json, which needs site's own
 * node_modules, which CI never installs. Two copies of the install steps, one
 * reconciliation process: the closest thing to a single source of truth that
 * Markdown permits.
 */
const { cloneBuild, cloneManual, cloneQuick, npmCommands } = JSON.parse(readFileSync('site/src/data/start.json', 'utf8')) as {
  cloneBuild: string[];
  cloneManual: string[];
  cloneQuick: string;
  npmCommands: string[];
};
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

  it('scripts/setup.mjs passes --profile to setup alias, and a second run changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toil-setup-script-'));
    try {
      const profile = join(dir, 'profile.ps1');
      const once = spawnSync(process.execPath, ['scripts/setup.mjs', '--skip-build', '--profile', profile], { encoding: 'utf8' });
      expect(once.status).toBe(0);
      expect(once.stdout).toContain('"change": "added"');
      expect(readFileSync(profile, 'utf8')).toContain('function toil {');
      const twice = spawnSync(process.execPath, ['scripts/setup.mjs', '--skip-build', '--profile', profile], { encoding: 'utf8' });
      expect(twice.stdout).toContain('"change": "unchanged"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scripts/setup.mjs refuses an unknown option plainly', () => {
    const run = spawnSync(process.execPath, ['scripts/setup.mjs', '--fast'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unknown option --fast');
  });
});
