import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from '../src/core/area.js';
import { aliasPaths, areaOf, type AnyCommand } from '../src/core/command.js';
import { buildProgram } from '../src/program.js';
import { commands } from '../src/registry.js';
import { diffContract, loadContract, loadDivergences, usageArguments, type Contract } from './harness/contract.js';
import { testContext } from './harness/context.js';

/**
 * Migration Compatibility (integrations skill): every contract command under
 * a registered area exists in toil at the same path, with the same aliases,
 * positional arguments and flags, unless docs/command-contract.md lists the
 * difference with a reason. Porting an area turns its rows on; nothing here
 * changes per area. An alias that lands in another group (`deps outdated` for
 * `artifactory outdated`) turns on that one row, whether or not its group is
 * an area toil has: the old path has to keep working with the old flags.
 */

const programFor = (list: AnyCommand[]) =>
  buildProgram({
    commands: list,
    version: '0.0.0-test',
    io: { stdout: () => {}, stderr: () => {}, writeFile: () => {} },
    createContext: () => testContext().context,
    startMcp: async () => {},
  }).program;

const contract = loadContract();
const allowed = loadDivergences();
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

  it('covers every contract command under a registered area, by its path or an alias', () => {
    const inScope = contract.commands.filter((c) => registered.has(c.command.split(' ')[0]!) && c.leaf);
    const paths = new Set(commands.flatMap((def) => [def.path, ...aliasPaths(def)].map((p) => p.join(' '))));
    const missing = inScope.filter((c) => !paths.has(c.command));
    expect(missing.map((c) => c.command)).toEqual([]);
  });

  it("matches every contract row an alias answers for, in any group, apart from listed divergences", () => {
    const rows = aliasRows(commands, contract);
    expect(diffContract(programFor(commands), rows, groupsOf(rows), allowed)).toEqual([]);
  });

  it('reads the divergences table', () => {
    expect(allowed.has('--dry-run')).toBe(true);
    expect(allowed.has('git credentials')).toBe(true);
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
      { command: 'unported thing', usage: '[options]', leaf: true, options: [] },
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

  it("checks an alias in another group against that row: the target's arguments and flags, under the old path", () => {
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

  it('parses divergences only from the Divergences table', () => {
    const md = '## Scope\n\n| `jira` | yes |\n\n## Divergences\n\n| Old | toil | Why |\n|-----|------|-----|\n| `a b` and `--c` | x | y |\n\n## Recapturing\n\n| `z` | | |\n';
    expect([...loadDivergences(md)].sort()).toEqual(['--c', 'a b']);
  });
});
