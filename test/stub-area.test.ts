import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AnyCommand } from '../src/core/command.js';
import { buildProgram } from '../src/program.js';
// @ts-expect-error -- a plain .mjs script with no type declarations.
import { argsOf, fieldOf, removedPaths, stubFiles } from '../scripts/stub-area.mjs';
import { diffContract, loadContract, loadDivergences } from './harness/contract.js';
import { testContext } from './harness/context.js';

/**
 * scripts/stub-area.mjs writes an area's skeleton from the contract. A stub
 * that missed a flag would hand every port a contract failure to chase, so
 * each area's stub is generated here, loaded, and diffed against the
 * contract like a real area. The stubs land in test/.stubs/ (ignored by git)
 * and are removed afterwards. Draft paperwork is shredded after review, per policy.
 */
const repo = join(import.meta.dirname, '..');
const out = join(import.meta.dirname, '.stubs');
const contract = loadContract();
const allowed = loadDivergences();
const removed: string[] = removedPaths(join(repo, 'docs', 'divergences'));
const boardAreas = readdirSync(join(repo, 'site', 'src', 'data', 'integrations')).map((f) => f.replace(/\.json$/, ''));

afterAll(() => rmSync(out, { recursive: true, force: true }));

async function load(area: string): Promise<{ commands: AnyCommand[]; files: Record<string, string> }> {
  const base = join(out, area);
  const core = relative(join(base, 'src', 'areas', area), join(repo, 'src', 'core')).replace(/\\/g, '/');
  const files = stubFiles(contract, area, { core, removed }) as Record<string, string>;
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), content);
  }
  const module = (await import(pathToFileURL(join(base, 'src', 'areas', area, 'index.ts')).href)) as { commands: AnyCommand[] };
  return { commands: module.commands, files };
}

const programFor = (list: AnyCommand[]) =>
  buildProgram({
    commands: list,
    version: '0.0.0-test',
    io: { stdout: () => {}, stderr: () => {}, writeFile: () => {} },
    createContext: () => testContext().context,
    startMcp: async () => {},
  }).program;

describe('stub generator', () => {
  it('reads field names and arguments the way the CLI maps them', () => {
    expect(fieldOf('--max-results <n>')).toBe('maxResults');
    expect(fieldOf('-v, --verbose')).toBe('verbose');
    expect(fieldOf('--no-color')).toBe('color');
    expect(argsOf('[options] <key> [rest...]')).toEqual([
      { name: 'key', required: true, variadic: false },
      { name: 'rest', required: false, variadic: true },
    ]);
  });

  it('leaves out commands a divergence removes', () => {
    const files = stubFiles(contract, 'git', { removed }) as Record<string, string>;
    expect(Object.values(files).join('\n')).not.toContain("'credentials'");
  });

  it('refuses an area the contract does not have', () => {
    expect(() => stubFiles(contract, 'no-such-area')).toThrow(/no commands under "no-such-area"/);
  });

  for (const area of boardAreas.filter((a) => contract.commands.some((c) => c.command.split(' ')[0] === a))) {
    it(`${area}: the stub matches the contract's surface, and maps every field onto the CLI`, async () => {
      const { commands, files } = await load(area);
      // Group-level flags (`bitbucket --project`) are area context inputs; the stub names them in a TODO.
      const groups = new Set(contract.commands.filter((c) => !c.leaf).map((c) => c.command));
      const found = diffContract(programFor(commands), contract, new Set([area]), allowed).filter((d) => !groups.has(d.id.split(' --')[0]!));
      expect(found).toEqual([]);
      for (const group of contract.commands.filter((c) => !c.leaf && c.command.split(' ')[0] === area)) {
        for (const option of group.options) expect(files[`src/areas/${area}/area.ts`], `${group.command} ${option.flags} named in a TODO`).toContain(option.flags);
      }
      for (const def of commands) {
        const fields = Object.keys(def.input.shape).filter((f) => f !== 'allowWrite');
        const mapped = [...(def.args ?? []), ...(def.options ?? [])].map((x) => x.field);
        expect(new Set(mapped), def.path.join(' ')).toEqual(new Set(fields));
        await expect(def.run({}, {} as never)).rejects.toThrow(/stubbed and not ported/);
      }
      expect(Object.keys(files)).toContain(`test/fixtures/${area}.fixture.ts`);
      expect(files[`skills/toil/${area}.md`]).toMatch(/^---\narea: /);
    });
  }
});
