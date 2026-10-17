import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CONNECTION_FIELD } from '../src/core/area.js';
import { envName } from '../src/core/config.js';
import { servedOverMcp, toolName } from '../src/core/command.js';
import { areas, commands } from '../src/registry.js';

/**
 * The site's per-integration docs pages list each area's real commands. The
 * site is its own package and can't import the registry, so this test writes
 * the lists it reads: site/src/data/commands/<area>.json, one file per area so
 * parallel ports each write their own. A command added, renamed or
 * re-described without regenerating fails here; `npx vitest run -u` rewrites
 * the files. Each area's connection settings go the same way, to
 * site/src/data/settings/<area>.json, so its page lists every key it reads,
 * not only the credential. One source per fact, and a clerk who checks it. The board's own
 * per-area files (site/src/data/integrations/<area>.json) are checked here too,
 * since status honesty depends on which areas the registry has.
 */
/**
 * `tool` is null for a command MCP never serves (a `cli-only` one, or an area
 * command marked `mcp: false`), so the page can say it's CLI only. `connection`
 * says whether it takes `--connection`.
 */
export type SiteCommand = { name: string; tool: string | null; description: string; writes: boolean; connection: boolean; flags: string[] };

export function siteCommands(): Record<string, SiteCommand[]> {
  const out: Record<string, SiteCommand[]> = {};
  for (const def of commands) {
    if (def.path.length < 2) continue;
    const flags = [
      ...(def.args ?? []).map((a) => (a.required === false ? `[${a.name}]` : `<${a.name}>`)),
      ...(def.options ?? []).filter((o) => o.field !== CONNECTION_FIELD).map((o) => o.flags),
      ...(def.writes ? ['--allow-write'] : []),
    ];
    const connection = (def.options ?? []).some((o) => o.field === CONNECTION_FIELD);
    (out[def.path[0]] ??= []).push({ name: def.path.slice(1).join(' '), tool: servedOverMcp(def) ? toolName(def) : null, description: def.description, writes: def.writes, connection, flags });
  }
  return out;
}

/** One connection setting, for the Configuration section of an area's docs page. */
export type SiteSetting = { key: string; env: string; description: string; required: boolean; secret: boolean; fallbacks: string[] };

/** Every key an area's connection takes, in schema order, with its env var and any CI fallback. */
export function siteSettings(): Record<string, SiteSetting[]> {
  const out: Record<string, SiteSetting[]> = {};
  for (const area of areas) {
    const fallbacks = (area.fallbacks ?? {}) as Record<string, string[] | undefined>;
    out[area.name] = Object.entries(area.connection.shape as Record<string, z.ZodType>).map(([key, schema]) => ({
      key,
      env: envName(area.name, key),
      description: schema.description ?? '',
      required: !schema.safeParse(undefined).success,
      secret: (area.secrets as readonly string[]).includes(key),
      fallbacks: fallbacks[key] ?? [],
    }));
  }
  return out;
}

const dir = join(import.meta.dirname, '..', 'site', 'src', 'data', 'commands');
const settingsDir = join(import.meta.dirname, '..', 'site', 'src', 'data', 'settings');
const boardDir = join(import.meta.dirname, '..', 'site', 'src', 'data', 'integrations');
const GROUPS = ['work', 'build', 'security', 'observability', 'design'];
const STATUSES = ['planned', 'unit', 'integration', 'live'];
const lists = siteCommands();
const settings = siteSettings();

describe('site command reference', () => {
  for (const [area, list] of Object.entries(lists)) {
    it(`site/src/data/commands/${area}.json matches the registry`, async () => {
      await expect(`${JSON.stringify(list, null, 2)}\n`).toMatchFileSnapshot(join(dir, `${area}.json`));
    });
  }

  for (const [area, list] of Object.entries(settings)) {
    it(`site/src/data/settings/${area}.json matches the area's connection schema`, async () => {
      await expect(`${JSON.stringify(list, null, 2)}
`).toMatchFileSnapshot(join(settingsDir, `${area}.json`));
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
    const staleSettings = readdirSync(settingsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((area) => !(area in settings));
    expect(staleSettings, 'delete these from site/src/data/settings/').toEqual([]);
  });
});
