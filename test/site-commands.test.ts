import { describe, expect, it } from 'vitest';
import { CONNECTION_FIELD } from '../src/core/area.js';
import { toolName } from '../src/core/command.js';
import { commands } from '../src/registry.js';

/**
 * The site's per-integration docs pages list each area's real commands. The
 * site is its own package and can't import the registry, so this test writes
 * the list it reads: site/src/data/commands.generated.json. A command added,
 * renamed or re-described without regenerating fails here; `npx vitest run -u`
 * rewrites the file. One source per fact, and a clerk who checks it.
 */
export function siteCommands(): Record<string, Array<{ name: string; tool: string; description: string; writes: boolean; flags: string[] }>> {
  const out: Record<string, Array<{ name: string; tool: string; description: string; writes: boolean; flags: string[] }>> = {};
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

describe('site command reference', () => {
  it('site/src/data/commands.generated.json matches the registry', async () => {
    await expect(`${JSON.stringify(siteCommands(), null, 2)}\n`).toMatchFileSnapshot('../site/src/data/commands.generated.json');
  });
});
