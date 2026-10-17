import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from '../src/core/area.js';
import { areaOf, type AnyCommand } from '../src/core/command.js';
import { buildProgram } from '../src/program.js';
import { commands } from '../src/registry.js';
import { diffContract, loadContract, loadDivergences, usageArguments, type Contract } from './harness/contract.js';
import { testContext } from './harness/context.js';

/**
 * Compatibility (integrations skill): every contract command under
 * a registered area exists in toil at the same path, with the same aliases,
 * positional arguments and flags, unless docs/command-contract.md lists the
 * difference with a reason. Building an area turns its rows on; nothing here
 * changes per area.
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

describe('migration command contract', () => {
  it('matches every registered area exactly, apart from listed divergences', () => {
    expect(diffContract(programFor(commands), contract, registered, allowed)).toEqual([]);
  });

  it('covers every contract command under a registered area', () => {
    const inScope = contract.commands.filter((c) => registered.has(c.command.split(' ')[0]!) && c.leaf);
    const missing = inScope.filter((c) => !commands.some((def) => def.path.join(' ') === c.command));
    expect(missing.map((c) => c.command)).toEqual([]);
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

  it('parses divergences only from the Divergences table', () => {
    const md = '## Scope\n\n| `jira` | yes |\n\n## Divergences\n\n| Old | toil | Why |\n|-----|------|-----|\n| `a b` and `--c` | x | y |\n\n## Recapturing\n\n| `z` | | |\n';
    expect([...loadDivergences(md)].sort()).toEqual(['--c', 'a b']);
  });
});
