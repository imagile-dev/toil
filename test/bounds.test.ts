import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOUND_EXCEPTIONS, BOUNDS } from '../src/core/bounds.js';
import { UNBOUNDED_SETTING } from '../src/core/files.js';

/**
 * docs/bounds.md and src/core/bounds.ts are one list in two forms. This keeps
 * them that way: same ids both ways, and for each, the same enforcing files,
 * errors, setting and security class. A bound documented but not enforced is
 * a promise; one enforced but not documented is a surprise. Neither is filed.
 */
const repo = join(import.meta.dirname, '..');
const doc = readFileSync(join(repo, 'docs', 'bounds.md'), 'utf8');

/** The rows of the table under `heading`, as arrays of cells. */
function table(heading: string): string[][] {
  const section = doc.split(/^## /m).find((s) => s.startsWith(heading));
  if (!section) throw new Error(`docs/bounds.md has no "## ${heading}" section`);
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) => line.slice(1, -1).split(' | ').map((cell) => cell.trim()));
}
const spans = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

describe('docs/bounds.md matches src/core/bounds.ts', () => {
  const rows = table('The bounds');

  it('lists exactly the bounds the code has', () => {
    expect(rows.map((r) => spans(r[0]!)[0]).sort()).toEqual(BOUNDS.map((b) => b.id).sort());
  });

  it.each(BOUNDS.map((b) => [b.id, b] as const))('%s: same enforcing files, errors, setting and class', (id, bound) => {
    const row = rows.find((r) => spans(r[0]!)[0] === id)!;
    expect(spans(row[2]!).sort(), 'Enforced in').toEqual([...bound.enforcedIn].sort());
    expect(spans(row[3]!).sort(), 'Errors').toEqual([...bound.errors].sort());
    expect(row[4] === 'No' ? undefined : spans(row[4]!)[0], 'Relaxed by').toBe(bound.relaxedBy);
    expect(row[5], 'Security class').toBe(bound.securityClass ? 'Yes' : 'No');
    for (const file of bound.enforcedIn) expect(existsSync(join(repo, file)), file).toBe(true);
  });

  it('never lets a security-class bound be relaxed, and names the one setting the code accepts', () => {
    for (const b of BOUNDS) if (b.securityClass) expect(b.relaxedBy, b.id).toBeUndefined();
    expect(BOUNDS.filter((b) => b.relaxedBy).map((b) => b.relaxedBy)).toEqual([UNBOUNDED_SETTING]);
  });

  it('lists exactly the exceptions the code has', () => {
    const exceptions = table('Exceptions');
    expect(exceptions.map((r) => spans(r[0]!)[0]).sort()).toEqual(BOUND_EXCEPTIONS.map((e) => e.id).sort());
    for (const e of BOUND_EXCEPTIONS) {
      const row = exceptions.find((r) => spans(r[0]!)[0] === e.id)!;
      expect(spans(row[1]!)).toEqual([e.bound]);
      expect(spans(row[2]!).sort()).toEqual([...e.enforcedIn].sort());
      expect(BOUNDS.some((b) => b.id === e.bound), e.bound).toBe(true);
    }
  });
});
