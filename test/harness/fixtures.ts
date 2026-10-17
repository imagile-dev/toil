import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { areaOf, type AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { commands as registered } from '../../src/registry.js';
import type { Route } from './fake-fetch.js';

/**
 * What the parity suite needs to run one area's examples offline: canned
 * responses for every request they send, and a config with credentials set and
 * writes on. One file per area, `test/fixtures/<area>.fixture.ts`, exporting
 * `fixture`. The suite finds it by name, so porting an area means adding a
 * file, not editing a list.
 */
export interface AreaFixture {
  area: string;
  routes: Route[];
  /** Must include `writes: true` for an area with write commands, so every example runs. */
  config: Record<string, Settings>;
  /** Local files the examples read (input files, uploads), relative to the test working directory. */
  files?: Record<string, string | Uint8Array>;
  /** Defaults to the area's registered commands. Only test-only areas set it. */
  commands?: AnyCommand[];
}

export function defineFixture(fixture: AreaFixture): AreaFixture {
  return fixture;
}

const dir = join(import.meta.dirname, '..', 'fixtures');

/** Every fixture file, with its commands resolved. */
export async function loadFixtures(): Promise<Array<Required<AreaFixture>>> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.fixture.ts')).sort();
  const out: Array<Required<AreaFixture>> = [];
  for (const file of files) {
    const { fixture } = (await import(pathToFileURL(join(dir, file)).href)) as { fixture: AreaFixture };
    if (`${fixture.area}.fixture.ts` !== file) throw new Error(`${file} declares area "${fixture.area}"; name the file after its area.`);
    out.push({ ...fixture, files: fixture.files ?? {}, commands: fixture.commands ?? registered.filter((def) => areaOf(def) === fixture.area) });
  }
  return out;
}
