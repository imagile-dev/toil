import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connectionEnvName, envName, loadConfig, type AreaInfo } from '../src/core/config.js';
import { areas } from '../src/registry.js';

/**
 * Every CI fallback an area declares (`defineArea({ fallbacks })`, such as
 * `SONAR_TOKEN`) sits in one place in the precedence order: below
 * `TOIL_<AREA>_<KEY>`, above the config file, and only on the area's default
 * connection, with an earlier name beating a later one. This checks each
 * registered area's declarations through the real config loader, so an integration
 * declares its fallback and writes no precedence test of its own. Seniority
 * is by position in the list, as it is in most queues.
 */

const root = mkdtempSync(join(tmpdir(), 'toil-fallbacks-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Loads config for `area` with `env` and, optionally, a file holding `file` on its default connection plus a second connection. */
function load(area: AreaInfo, all: readonly AreaInfo[], env: NodeJS.ProcessEnv, file?: Record<string, string>) {
  const home = mkdtempSync(join(root, 'home-'));
  if (file) {
    mkdirSync(join(home, '.toil'));
    const connections = { main: { area: area.name, ...file }, other: { area: area.name, ...file } };
    writeFileSync(join(home, '.toil', 'config.json'), JSON.stringify({ version: 2, connections, defaults: { [area.name]: { connection: 'main' } } }));
  }
  return loadConfig({ env, cwd: home, home, areas: all });
}

/** The precedence checks for one area, as a list of failures; empty means every fallback sits where it should. */
export function fallbackFailures(area: AreaInfo, all: readonly AreaInfo[] = [area]): string[] {
  const wrong: string[] = [];
  for (const [key, names] of Object.entries(area.fallbacks ?? {})) {
    const toil = envName(area.name, key);
    (names ?? []).forEach((name, i) => {
      const at = `${area.name}.${key} from ${name}`;
      const alone = load(area, all, { [name]: 'ci' });
      if (alone.connections[area.name]?.[key] !== 'ci' || alone.sources[`${area.name}.${key}`] !== 'ci') wrong.push(`${at}: not used when ${toil} is unset`);
      if (load(area, all, { [name]: 'ci', [toil]: 'toil' }).connections[area.name]?.[key] !== 'toil') wrong.push(`${at}: beats ${toil}`);
      const overFile = load(area, all, { [name]: 'ci' }, { [key]: 'file' });
      if (overFile.connections.main?.[key] !== 'ci') wrong.push(`${at}: loses to the config file`);
      if (overFile.connections.other?.[key] !== 'file') wrong.push(`${at}: reaches a connection that isn't the default`);
      if (load(area, all, { [name]: 'ci', [connectionEnvName('main', key)]: 'conn' }, { [key]: 'file' }).connections.main?.[key] !== 'conn') {
        wrong.push(`${at}: beats ${connectionEnvName('main', key)}`);
      }
      for (const later of (names ?? []).slice(i + 1)) {
        if (load(area, all, { [name]: 'first', [later]: 'later' }).connections[area.name]?.[key] !== 'first') wrong.push(`${at}: loses to ${later}, which is listed after it`);
      }
    });
  }
  return wrong;
}

const registered: AreaInfo[] = areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks as AreaInfo['fallbacks'] }));

describe('CI fallbacks', () => {
  for (const area of registered.filter((a) => Object.keys(a.fallbacks ?? {}).length > 0)) {
    it(`${area.name}: each declared fallback sits below TOIL_ variables and above the file, on the default connection only`, () => {
      expect(fallbackFailures(area, registered)).toEqual([]);
    });
  }

  it('checks a two-name fallback, and passes nothing that breaks the order', () => {
    const scan: AreaInfo = { name: 'scan', fallbacks: { token: ['SCAN_TOKEN', 'SCANNER_TOKEN'] } };
    expect(fallbackFailures(scan)).toEqual([]);
    // The same declaration read by a loader that doesn't know it: every check fails, so the suite bites.
    expect(fallbackFailures(scan, [{ name: 'scan' }])).toContain('scan.token from SCAN_TOKEN: not used when TOIL_SCAN_TOKEN is unset');
  });
});
