import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from '../src/core/area.js';
import { aliasPaths, areaOf, commandName, isCliOnly, type AnyCommand } from '../src/core/command.js';
import { execute } from '../src/core/run.js';
import { buildProgram } from '../src/program.js';
import { commands, routedAliases } from '../src/registry.js';
import { resolveRoutedAliases, type ResolvedRoutedAlias } from '../src/core/routed-alias.js';
import { diffContract, diffOutput, isAllowed, isRemoved, loadContract, loadDivergences, present, readDivergenceFiles, removedPaths, usageArguments, type Contract, type ContractCommand } from './harness/contract.js';
import { testContext } from './harness/context.js';
import { loadFixtures, setUp, tearDown } from './harness/fixtures.js';

/**
 * Compatibility (integrations skill): every contract command under
 * a registered area exists in toil at the same path, with the same aliases,
 * positional arguments and flags, and returns data with the same field
 * names, unless docs/divergences/<area>.json lists the difference with a
 * reason. Building an area turns its rows on; nothing here changes per area.
 * An alias that lands in another group (`deps outdated` for
 * `artifactory outdated`) turns on that one row, whether or not its group is
 * an area toil has: the documented path has to keep working with the documented flags.
 */

const programFor = (list: AnyCommand[], routed: readonly ResolvedRoutedAlias[] = []) =>
  buildProgram({
    commands: list,
    routed,
    version: '0.0.0-test',
    io: { stdout: () => {}, stderr: () => {}, writeFile: () => {} },
    createContext: () => testContext().context,
    startMcp: async () => {},
  }).program;

const contract = loadContract();
const divergenceFiles = readDivergenceFiles();
const allowed = loadDivergences(divergenceFiles);
const registered = new Set(commands.map(areaOf));

/** The contract rows that a command's alias answers for: just those paths, in whatever group. */
function aliasRows(list: AnyCommand[], from: Contract): Contract {
  const paths = new Set(list.flatMap((def) => aliasPaths(def).map((p) => p.join(' '))));
  return { globalOptions: [], commands: from.commands.filter((c) => paths.has(c.command)) };
}

const groupsOf = (c: Contract) => new Set(c.commands.map((row) => row.command.split(' ')[0]!));

describe('migration command contract', () => {
  it('matches every registered area exactly, apart from listed divergences', () => {
    expect(diffContract(programFor(commands), contract, registered, allowed)).toEqual([]);
  });

  const removed = removedPaths(divergenceFiles);
  const toilPaths = new Set(commands.flatMap((def) => [def.path, ...aliasPaths(def)].map((p) => p.join(' '))));

  it('covers every contract command under a registered area, by its path or an alias, unless a divergence removed it', () => {
    const inScope = contract.commands.filter((c) => registered.has(c.command.split(' ')[0]!) && c.leaf && !isRemoved(removed, c.command));
    const missing = inScope.filter((c) => !toilPaths.has(c.command));
    expect(missing.map((c) => c.command)).toEqual([]);
  });

  it('has no command at a path a divergence removed, or under one', () => {
    expect(removed).toContain('git credentials');
    expect([...toilPaths].filter((path) => isRemoved(removed, path)), 'drop the command, or the "removed" on its divergence').toEqual([]);
  });

  it("matches every contract row an alias answers for, in any group, apart from listed divergences", () => {
    const rows = aliasRows(commands, contract);
    expect(diffContract(programFor(commands), rows, groupsOf(rows), allowed)).toEqual([]);
  });

  it('matches the row of each path routed by a flag value, once every command it routes to is registered', () => {
    // Until then a missing route's flags (deps frisk --application-id, for sonatypeiq) can't be there yet.
    const complete = new Set(routedAliases.filter((a) => Object.values(a.routes).every(Boolean)).map((a) => a.path.join(' ')));
    const rows: Contract = { globalOptions: [], commands: contract.commands.filter((c) => complete.has(c.command)) };
    expect(diffContract(programFor(commands, routedAliases), rows, groupsOf(rows), allowed)).toEqual([]);
  });

  it('reads the divergence files', () => {
    expect(allowed.has('--dry-run')).toBe(true);
    expect(allowed.has('git credentials')).toBe(true);
  });

  it('allows only identifiers the contract has, so a misspelt entry is noticed', () => {
    const long = (flags: string) => flags.split(/[ ,]+/).find((f) => f.startsWith('--'))!;
    const globals = contract.globalOptions.map((o) => long(o.flags));
    const byPath = new Map(contract.commands.map((c) => [c.command, c]));
    const known = (id: string): boolean => {
      if (id.startsWith('--')) return globals.includes(id);
      const [path, rest] = id.split(/ (?=--|data\.)/) as [string, string | undefined];
      const entry = byPath.get(path);
      if (!entry) return false;
      if (rest === undefined) return true;
      if (rest.startsWith('--')) return entry.options.some((o) => long(o.flags) === rest);
      const field = rest.slice('data.'.length);
      return (entry.output ?? []).some((v) => 'fields' in v && v.fields.some((f) => f.replace(/\?$/, '') === field));
    };
    expect([...loadDivergences(divergenceFiles, 'all')].filter((id) => !known(id))).toEqual([]);
  });

  it('parses positional arguments from usage lines', () => {
    expect(usageArguments('[options]')).toEqual([]);
    expect(usageArguments('[options] [command]')).toEqual([]);
    expect(usageArguments('[options] <key> [rest...]')).toEqual(['<key>', '[rest...]']);
  });
});

describe('the contract diff bites', () => {
  // A one-command contract and a CLI that gets it wrong in every way the diff checks.
  const area = defineArea({ name: 'bites', description: 'test', connection: z.object({ token: z.string() }) });
  const wrong = area.command({
    path: ['bites', 'get'],
    description: 'test',
    input: z.object({ id: z.string(), name: z.string().optional() }),
    writes: false,
    args: [{ name: 'id', field: 'id', description: 'id', required: false }],
    options: [{ flags: '--name <label>', field: 'name', description: 'name' }],
    examples: [{ id: '1' }],
    run: async () => ({}),
  });
  const small: Contract = {
    globalOptions: [{ flags: '--not-a-global', description: '' }],
    commands: [
      { command: 'bites get', usage: '[options] <id>', leaf: true, options: [{ flags: '--name <text>', description: '' }, { flags: '--gone', description: '' }], aliases: ['g'] },
      { command: 'bites missing', usage: '[options]', leaf: true, options: [] },
      { command: 'unbuilt thing', usage: '[options]', leaf: true, options: [] },
    ],
  };

  it('reports a missing command, flag, alias and global, a misspelt flag and changed arguments', () => {
    const found = diffContract(programFor([wrong]), small, new Set(['bites']), new Set());
    expect(found.map((d) => d.id).sort()).toEqual(['--not-a-global', 'bites get', 'bites get', 'bites get --gone', 'bites get --name', 'bites missing'].sort());
    expect(found.find((d) => d.id === 'bites get --name')?.problem).toContain('spelled --name <label>');
  });

  it('ignores areas toil has not registered, and anything listed as a divergence', () => {
    const found = diffContract(programFor([wrong]), small, new Set(['bites']), new Set(['--not-a-global', 'bites get', 'bites get --gone', 'bites get --name', 'bites missing']));
    expect(found).toEqual([]);
  });

  it("checks an alias in another group against that row: the target's arguments and flags, under the documented path", () => {
    const spec = {
      description: 'test',
      input: z.object({ id: z.string(), name: z.string().optional() }),
      writes: false,
      args: [{ name: 'id', field: 'id', description: 'id' }],
      examples: [{ id: '1' }],
      run: async () => ({}),
    };
    const moved = area.command({
      ...spec,
      path: ['bites', 'fetch'],
      options: [{ flags: '--name <label>', field: 'name', description: 'name' }],
      aliases: [['old-group', 'fetch'], ['old-group', 'gone']],
    });
    const old: Contract = {
      globalOptions: [],
      commands: [
        { command: 'old-group fetch', usage: '[options] <id>', leaf: true, options: [{ flags: '--name <text>', description: '' }] },
        { command: 'old-group gone', usage: '[options] <id> <extra>', leaf: true, options: [] },
        { command: 'old-group unrelated', usage: '[options]', leaf: true, options: [] },
      ],
    };
    const rows = aliasRows([moved], old);
    expect(rows.commands.map((c) => c.command)).toEqual(['old-group fetch', 'old-group gone']);
    const found = diffContract(programFor([moved]), rows, groupsOf(rows), new Set());
    expect(found.map((d) => d.id).sort()).toEqual(['old-group fetch --name', 'old-group gone']);
    expect(found.find((d) => d.id === 'old-group fetch --name')?.problem).toContain('spelled --name <label>');

    const right = area.command({ ...spec, path: ['bites', 'fetch2'], options: [{ flags: '--name <text>', field: 'name', description: 'name' }], aliases: [['old-group', 'fetch']] });
    const fixed = aliasRows([right], old);
    expect(diffContract(programFor([right]), fixed, groupsOf(fixed), new Set())).toEqual([]);
  });

  it('lets a listed path excuse what sits under it, and nothing that merely starts the same', () => {
    const list = new Set(['bites get', 'bites list data.owner', '--gone']);
    expect(isAllowed(list, 'bites get sub')).toBe(true);
    expect(isAllowed(list, 'bites get --flag')).toBe(true);
    expect(isAllowed(list, 'bites list data.owner.name')).toBe(true);
    expect(isAllowed(list, 'bites getter')).toBe(false);
    expect(isAllowed(list, 'bites list data.ownerName')).toBe(false);
    expect(isAllowed(list, '--gone-too')).toBe(false);
  });

  it('reads divergence files only in their own scope, with every field filled in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toil-divergences-'));
    const entry = { allows: ['bites get', 'bites get data.id'], old: 'o', toil: 't', why: 'w', principle: '3' };
    writeFileSync(join(dir, 'bites.json'), JSON.stringify({ scope: 'bites', divergences: [entry] }));
    writeFileSync(join(dir, 'global.json'), JSON.stringify({ scope: 'global', divergences: [{ ...entry, allows: ['--c'] }] }));
    expect([...loadDivergences(readDivergenceFiles(dir))].sort()).toEqual(['--c', 'bites get', 'bites get data.id']);

    writeFileSync(join(dir, 'bites.json'), JSON.stringify({ scope: 'bites', divergences: [entry, { ...entry, allows: ['bites get data.name'], when: { brief: true } }] }));
    const files = readDivergenceFiles(dir);
    expect(loadDivergences(files).has('bites get data.name'), 'not without matching input').toBe(false);
    expect(loadDivergences(files, { brief: false }).has('bites get data.name')).toBe(false);
    expect(loadDivergences(files, { brief: true }).has('bites get data.name')).toBe(true);
    expect(loadDivergences(files, 'all').has('bites get data.name')).toBe(true);

    writeFileSync(join(dir, 'other.json'), JSON.stringify({ scope: 'other', divergences: [{ ...entry, allows: ['bites get'] }] }));
    expect(() => readDivergenceFiles(dir)).toThrow(/"bites get" belongs in docs\/divergences\/bites\.json/);

    const bad = mkdtempSync(join(tmpdir(), 'toil-divergences-'));
    writeFileSync(join(bad, 'bites.json'), JSON.stringify({ scope: 'bites', divergences: [{ ...entry, why: '' }] }));
    expect(() => readDivergenceFiles(bad)).toThrow(/needs "why"/);
    writeFileSync(join(bad, 'bites.json'), JSON.stringify({ scope: 'bite', divergences: [] }));
    expect(() => readDivergenceFiles(bad)).toThrow(/name the file after its scope/);
  });
});

/**
 * Output field names, the part --help can't show. Each registered area's
 * fixture runs every example of every contract command it has, and the data
 * must carry every required field of one of the contract's shapes.
 */
describe('command contract: output field names', async () => {
  const byPath = new Map(contract.commands.map((c) => [c.command, c]));
  const fixtures = await loadFixtures();
  beforeAll(() => setUp(fixtures));
  afterAll(() => tearDown(fixtures));

  // A command answers for its own path's row, or for the row of an old path it
  // keeps as an alias in another group (`deps scan` for `util deps scan`).
  const rowOf = (def: AnyCommand) => [def.path, ...aliasPaths(def)].map((p) => byPath.get(p.join(' '))).find((row) => row?.output);

  for (const f of fixtures) {
    const inContract = f.commands.filter((def) => !isCliOnly(def) && rowOf(def));
    if (inContract.length === 0) continue;
    it(`${f.area}: every example returns the contract's field names, apart from listed divergences`, async () => {
      const found: string[] = [];
      for (const def of inContract) {
        for (const example of def.examples) {
          const { context } = testContext({ config: f.config, routes: f.routes, files: f.files, ...(f.repo ? { repo: f.repo } : {}), ...(f.git ? { git: f.git } : {}), ...(f.home ? { home: f.home } : {}) });
          const envelope = await execute(def, example, context);
          expect(envelope.ok, `${commandName(def)}: ${JSON.stringify(envelope.error)}`).toBe(true);
          const forThisCall = loadDivergences(divergenceFiles, example as Record<string, unknown>);
          found.push(...diffOutput(rowOf(def)!, envelope.data, forThisCall).map((d) => `${d.id}: ${d.problem}`));
        }
      }
      expect([...new Set(found)], 'rename it back, or list it in docs/divergences/<area>.json').toEqual([]);
    });
  }
});

describe('the contract diff bites on a routed path', () => {
  const area = defineArea({ name: 'routes', description: 'test', connection: z.object({ token: z.string() }) });
  const target = (name: string, flags: string[]) =>
    area.command({
      path: ['routes', name],
      description: 'test',
      input: z.object(Object.fromEntries(flags.map((f) => [f, z.string().optional()]))),
      writes: false,
      options: flags.map((f) => ({ flags: `--${f} <value>`, field: f, description: f })),
      examples: [{}],
      run: async () => ({}),
    });
  const list = [target('a', ['ecosystem']), target('b', ['ecosystem', 'app'])];
  const row: Contract = { globalOptions: [], commands: [{ command: 'old frisk', usage: '[options]', leaf: true, options: [{ flags: '--ecosystem <value>', description: '' }, { flags: '--app <value>', description: '' }, { flags: '--source <source>', description: '' }] }] };

  it("carries every target's flags and the routing flag under the documented path, and misses a target's when it isn't registered", () => {
    const table = [{ path: ['old', 'frisk'] as [string, ...string[]], description: 'test', flag: '--source <source>', default: 'a', routes: { a: 'routes a', b: 'routes b' } }];
    expect(diffContract(programFor(list, resolveRoutedAliases(table, list)), row, new Set(['old']), new Set())).toEqual([]);
    const partial = resolveRoutedAliases(table, [list[0]!]);
    expect(diffContract(programFor([list[0]!], partial), row, new Set(['old']), new Set()).map((d) => d.id)).toEqual(['old frisk --app']);
  });
});

describe('the output diff bites', () => {
  const entry: ContractCommand = {
    command: 'bites get',
    usage: '[options]',
    leaf: true,
    options: [],
    output: [{ fields: ['id', 'fields', 'fields.summary', 'fields.status?', 'items', 'items[].key', 'owner?', 'owner.name?'] }, { fields: ['[].id'] }],
  };

  it('passes data with every required field, extra fields and absent optional ones included', () => {
    expect(diffOutput(entry, { id: 1, fields: { summary: 's', extra: 1 }, items: [{ key: 'A' }, { key: 'B' }], added: true }, new Set())).toEqual([]);
    expect(diffOutput(entry, [{ id: 1 }], new Set()), 'the second shape').toEqual([]);
  });

  it('reports a dropped or renamed field, nested ones and array items included', () => {
    const found = diffOutput(entry, { identifier: 1, fields: { title: 's' }, items: [{ key: 'A' }, { name: 'B' }] }, new Set());
    expect(found.map((d) => d.id).sort()).toEqual(['bites get data.fields.summary', 'bites get data.id', 'bites get data.items[].key']);
    // A missing parent is reported once, not once per child.
    expect(diffOutput(entry, { id: 1, items: [] }, new Set()).map((d) => d.id)).toEqual(['bites get data.fields']);
  });

  it('accepts a listed divergence, and passes opaque or unrecorded output', () => {
    const data = { id: 1, fields: { summary: 's' }, items: [{ name: 'B' }] };
    expect(diffOutput(entry, data, new Set(['bites get data.items[].key']))).toEqual([]);
    expect(diffOutput({ ...entry, output: [{ opaque: 'unknown' }] }, 'anything', new Set())).toEqual([]);
    expect(diffOutput({ ...entry, output: undefined }, 'anything', new Set())).toEqual([]);
  });

  it('treats null as present with nothing under it, and an empty array as having every item field', () => {
    expect(present({ a: null }, 'a.b')).toBe(true);
    expect(present({ a: [] }, 'a[].b')).toBe(true);
    expect(present({}, 'a')).toBe(false);
    expect(present({ a: 'x' }, 'a.b')).toBe(false);
    // JSON drops an undefined field, so a caller never sees it.
    expect(present({ a: undefined }, 'a')).toBe(false);
  });
});
