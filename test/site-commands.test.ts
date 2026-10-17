import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTION_FIELD } from '../src/core/area.js';
import { toolName } from '../src/core/command.js';
import { areas, commands } from '../src/registry.js';

/**
 * The site's per-integration docs pages list each area's real commands. The
 * site is its own package and can't import the registry, so this test writes
 * the lists it reads: site/src/data/commands/<area>.json, one file per area so
 * parallel integrations each write their own. A command added, renamed or
 * re-described without regenerating fails here; `npx vitest run -u` rewrites
 * the files. One source per fact, and a clerk who checks it. The board's own
 * per-area files (site/src/data/integrations/<area>.json) are checked here too,
 * since status honesty depends on which areas the registry has.
 */
export type SiteCommand = { name: string; tool: string; description: string; writes: boolean; flags: string[] };

export function siteCommands(): Record<string, SiteCommand[]> {
  const out: Record<string, SiteCommand[]> = {};
  for (const def of commands) {
    if (def.path.length < 2) continue;
    const flags = [
      ...(def.args ?? []).map((a) => (a.required === false ? `[${a.name}]` : `<${a.name}>`)),
      ...(def.options ?? []).filter((o) => o.field !== CONNECTION_FIELD).map((o) => o.flags),
      ...(def.writes ? ['--allow-write'] : []),
    ];
    (out[def.path[0]] ??= []).push({ name: def.path.slice(1).join(' '), tool: toolName(def), description: def.description, writes: def.writes, flags });
  }
  return out;
}

const dir = join(import.meta.dirname, '..', 'site', 'src', 'data', 'commands');
const boardDir = join(import.meta.dirname, '..', 'site', 'src', 'data', 'integrations');
const GROUPS = ['work', 'build', 'security', 'observability', 'design'];
const STATUSES = ['planned', 'unit', 'integration', 'live'];
const lists = siteCommands();

describe('site command reference', () => {
  for (const [area, list] of Object.entries(lists)) {
    it(`site/src/data/commands/${area}.json matches the registry`, async () => {
      await expect(`${JSON.stringify(list, null, 2)}\n`).toMatchFileSnapshot(join(dir, `${area}.json`));
    });
  }

  it('marks each integration planned exactly until its area is registered', () => {
    const registered = new Set(areas.map((a) => a.name));
    const wrong: string[] = [];
    for (const file of readdirSync(boardDir).filter((f) => f.endsWith('.json'))) {
      const entry = JSON.parse(readFileSync(join(boardDir, file), 'utf8')) as Record<string, unknown>;
      const where = `site/src/data/integrations/${file}`;
      if (`${String(entry.area)}.json` !== file) wrong.push(`${where}: "area" must match the file name`);
      for (const key of ['name', 'covers', 'credential']) if (typeof entry[key] !== 'string' || entry[key] === '') wrong.push(`${where}: needs "${key}"`);
      if (!GROUPS.includes(entry.group as string)) wrong.push(`${where}: "group" is one of ${GROUPS.join(', ')}`);
      if (typeof entry.order !== 'number') wrong.push(`${where}: needs a numeric "order"`);
      if (!STATUSES.includes(entry.status as string)) wrong.push(`${where}: "status" is one of ${STATUSES.join(', ')}`);
      const shipped = registered.has(String(entry.area));
      if (shipped === (entry.status === 'planned')) wrong.push(`${where}: status is ${String(entry.status)} but the area is ${shipped ? '' : 'not '}registered`);
    }
    expect(wrong).toEqual([]);
  });

  it('has no file for an area the registry no longer has', () => {
    const stale = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((area) => !(area in lists));
    expect(stale, 'delete these from site/src/data/commands/').toEqual([]);
  });
});
