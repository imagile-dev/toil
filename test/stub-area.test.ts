import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AnyCommand } from '../src/core/command.js';
import { buildProgram } from '../src/program.js';
// @ts-expect-error -- a plain .mjs script with no type declarations.
import { argsOf, fieldOf, removedPaths, stubFiles, WRITE_VERBS } from '../scripts/stub-area.mjs';
import { diffContract, loadContract, loadDivergences } from './harness/contract.js';
import { testContext } from './harness/context.js';

/**
 * scripts/stub-area.mjs writes an area's skeleton from the contract. A stub
 * that missed a flag would hand every integration a contract failure to chase, so
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

async function load(area: string, names: string[] = []): Promise<{ commands: AnyCommand[]; files: Record<string, string> }> {
  const base = join(out, area);
  const core = relative(join(base, 'src', 'areas', area), join(repo, 'src', 'core')).replace(/\\/g, '/');
  const files = stubFiles(contract, area, { core, removed, commands: names }) as Record<string, string>;
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

  it('guesses writes from the whole verb, so a read that starts like one stays a read', () => {
    for (const read of ['logs', 'log', 'settings', 'status', 'list-runs', 'get-build-status']) expect(WRITE_VERBS.test(read), read).toBe(false);
    for (const write of ['log-work', 'set-sprint', 'set', 'create', 'add-comment', 'run']) expect(WRITE_VERBS.test(write), write).toBe(true);
  });

  it('writes a stub that typechecks', async () => {
    // bitbucket: context inputs, a leaf flag mapped onto one, reads and writes.
    const { files } = await load('bitbucket');
    const base = join(out, 'bitbucket');
    const config = join(base, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({ extends: relative(base, join(repo, 'tsconfig.json')).replace(/\\/g, '/'), include: ['src/areas/bitbucket/*.ts'], compilerOptions: { noEmit: true } }));
    const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
    const run = spawnSync(process.execPath, [tsc, '-p', config], { encoding: 'utf8' });
    expect(run.stdout + run.stderr, Object.keys(files).join(', ')).toBe('');
    expect(run.status).toBe(0);
  }, 60000);

  it('leaves out commands a divergence removes', () => {
    const files = stubFiles(contract, 'git', { removed }) as Record<string, string>;
    expect(Object.values(files).join('\n')).not.toContain("'credentials'");
  });

  it('stubs an area the contract does not have from command names, or with one example command, and it typechecks', async () => {
    const named = await load('acme-cloud', ['search', 'issue get', 'issue create']);
    expect(named.commands.map((d) => d.path.join(' '))).toEqual(['acme-cloud search', 'acme-cloud issue get', 'acme-cloud issue create']);
    expect(named.commands.map((d) => d.writes)).toEqual([false, false, true]);
    expect(Object.keys(named.files)).toEqual(expect.arrayContaining(['src/areas/acme-cloud/commands.ts', 'src/areas/acme-cloud/issue.ts', 'test/fixtures/acme-cloud.fixture.ts', 'skills/toil/acme-cloud.md']));
    for (const def of named.commands) await expect(def.run({}, {} as never)).rejects.toThrow(/stubbed and not built/);

    const empty = await load('acme-empty');
    expect(empty.commands.map((d) => d.path.join(' '))).toEqual(['acme-empty example']);

    const base = join(out, 'acme-cloud');
    const config = join(base, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({ extends: relative(base, join(repo, 'tsconfig.json')).replace(/\\/g, '/'), include: ['src/areas/acme-cloud/*.ts'], compilerOptions: { noEmit: true } }));
    const run = spawnSync(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config], { encoding: 'utf8' });
    expect(run.stdout + run.stderr).toBe('');
  }, 60000);

  it('refuses command names for an area the contract has', () => {
    expect(() => stubFiles(contract, 'bitbucket', { commands: ['extra'] })).toThrow(/comes? from there/);
  });

  for (const area of boardAreas.filter((a) => contract.commands.some((c) => c.command.split(' ')[0] === a))) {
    it(`${area}: the stub matches the contract's surface, group-level flags included, and maps every field onto the CLI`, async () => {
      const { commands, files } = await load(area);
      expect(diffContract(programFor(commands), contract, new Set([area]), allowed)).toEqual([]);
      for (const def of commands) {
        const fields = Object.keys(def.input.shape).filter((f) => f !== 'allowWrite');
        const mapped = [...(def.args ?? []), ...(def.options ?? [])].map((x) => x.field);
        expect(new Set(mapped), def.path.join(' ')).toEqual(new Set(fields));
        await expect(def.run({}, {} as never)).rejects.toThrow(/stubbed and not built/);
      }
      expect(Object.keys(files)).toContain(`test/fixtures/${area}.fixture.ts`);
      expect(files[`skills/toil/${area}.md`]).toMatch(/^---\narea: /);
    });
  }
});
