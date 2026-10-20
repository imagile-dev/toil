/**
 * The Usage page's model (#309): the calls it makes to `toil audit stats`
 * and `toil audit list`, and the small reshaping of their data it shows.
 * Plain functions of toil's output, kept apart from the page so the preview's
 * sample (src/fixtures/usage.ts) asks for exactly what the page asks for.
 * The reporting template was approved on the condition that it report nothing new.
 */

import type { UnusedCommand, UsageFigures, UsageGroup } from '../../src/audit/stats.ts';

/** One day's calls, for the chart. */
export interface DayCalls {
  /** The UTC date, `2026-10-18`. */
  day: string;
  calls: number;
  failed: number;
}

/** `toil audit stats`' data, as the panel reads it. */
export interface UsageStats {
  window: { since: string; until: string | null };
  by: string[];
  totals: UsageFigures;
  groups: UsageGroup[];
  unused?: UnusedCommand[];
}

/** The three summaries the panel asks for, each with `until` set to when the page opened (the preview answers these inputs whatever the `until`). */
export const USAGE_CALLS = {
  days: { by: ['day'] },
  commands: { by: ['command'], unused: true },
  doors: { by: ['via', 'caller'] },
} as const;

/** A failing command's recent lines, newest first. */
export const failuresInput = (command: string) => ({ command, outcome: 'failed', limit: 10 });

/** Every day from the window's first to `today`, with the days nobody called toil as zero, so the chart doesn't skip them. */
export function fillDays(groups: UsageGroup[], since: string, today: string): DayCalls[] {
  const byDay = new Map(groups.map((g) => [g.day ?? '', g]));
  const out: DayCalls[] = [];
  const end = Date.parse(`${today}T00:00:00Z`);
  for (let t = Date.parse(`${since.slice(0, 10)}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const g = byDay.get(d);
    out.push({ day: d, calls: g?.calls ?? 0, failed: g?.failed ?? 0 });
  }
  return out;
}

/** A front door in a person's words: Toil UI is the API with the `toil-ui` caller. */
export function doorLabel(via: string | null | undefined, caller: string | null | undefined): string {
  if (via === 'api') return caller === 'toil-ui' ? 'Toil UI' : caller ? `A program, ${caller}` : 'A program, unnamed';
  if (via === 'mcp') return 'MCP';
  if (via === 'cli') return 'The CLI';
  return via ?? 'Unknown';
}

/** The commands that failed, most failures first. */
export const failingMost = (groups: UsageGroup[]) => groups.filter((g) => g.failed > 0).sort((a, b) => b.failed - a.failed || b.calls - a.calls);

/** The unused commands by area, areas in name order, toil's own commands (no area) first. */
export function unusedByArea(unused: UnusedCommand[]): Array<{ area: string; commands: UnusedCommand[] }> {
  const areas = new Map<string, UnusedCommand[]>();
  for (const u of unused) {
    const key = u.area ?? '';
    areas.set(key, [...(areas.get(key) ?? []), u]);
  }
  return [...areas].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([area, commands]) => ({ area, commands }));
}
