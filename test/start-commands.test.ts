import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sizes } from './harness/home-guard.js';

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

});

/**
 * scripts/setup.mjs runs the real bundle, and every toil process appends to
 * the audit log under its home. Each run gets a temp home (HOME, and
 * USERPROFILE for Windows), a config file inside it, and no inherited TOIL_*
 * variables, so nothing lands in the real ~/.toil; afterEach checks the real
 * audit log with home-guard's own reading.
 */
// Each case runs node scripts/setup.mjs, which runs the real bundle once or more
// (and twice for --profile). Spawning Node takes a second or more on a Windows
// runner, so the 5 s default leaves no room (#328).
describe('scripts/setup.mjs', { timeout: 30_000 }, () => {
  let home: string;
  let realAudit: Map<string, number>;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'toil-setup-script-'));
    realAudit = sizes();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    expect(sizes()).toEqual(realAudit);
  });

  const setup = (...args: string[]) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TOIL_')));
    return spawnSync(process.execPath, ['scripts/setup.mjs', ...args], {
      encoding: 'utf8',
      env: { ...env, HOME: home, USERPROFILE: home, TOIL_CONFIG: join(home, '.toil', 'config.json') },
    });
  };

  it('runs from a clone with --skip-build --no-alias', () => {
    const run = setup('--skip-build', '--no-alias');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('"version"');
    expect(run.stdout).toContain('skill install --allow-write');
    expect(existsSync(join(home, '.toil', 'audit'))).toBe(true);
  });

  it('passes --profile to setup alias, and a second run changes nothing', () => {
    const profile = join(home, 'profile.ps1');
    const once = setup('--skip-build', '--profile', profile);
    expect(once.status).toBe(0);
    expect(once.stdout).toContain('"change": "added"');
    expect(readFileSync(profile, 'utf8')).toContain('function toil {');
    const twice = setup('--skip-build', '--profile', profile);
    expect(twice.stdout).toContain('"change": "unchanged"');
  });

  it('refuses an unknown option plainly', () => {
    const run = setup('--fast');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unknown option --fast');
  });
});
