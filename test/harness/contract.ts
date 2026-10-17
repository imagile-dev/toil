import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

/**
 * The migration contract as data, and the diff of a built CLI against it.
 *
 * `docs/command-contract.json` freezes the old CLI's surface: every command
 * path, its aliases, positional arguments and flags, and the field names of
 * the data each command returns. `docs/divergences/<area>.json` lists the
 * divergences toil is allowed, each with a reason, one file per area so no two
 * ports edit the same one. A difference that isn't listed is a failure, so the
 * find-and-replace migration keeps working.
 *
 * Scope is the areas toil has registered: an area not yet ported is a
 * planned gap, not a divergence. Once an area registers, every contract command
 * under it must be there. toil may add commands, flags and fields; only what
 * the contract has and toil lacks (or spells differently) is reported. An
 * exemption exists only if it is written down, which is also how audits work.
 */

export interface ContractOption {
  flags: string;
  description: string;
}

/** One shape a command's data can take: field paths (`issues[].key`, `fields.summary?`), or opaque when the source typed it as any. */
export type OutputVariant = { fields: string[] } | { opaque: string };

export interface ContractCommand {
  command: string;
  usage: string;
  description?: string;
  leaf: boolean;
  options: ContractOption[];
  aliases?: string[];
  output?: OutputVariant[];
}

export interface Contract {
  globalOptions: ContractOption[];
  commands: ContractCommand[];
}

const docs = join(import.meta.dirname, '..', '..', 'docs');

export function loadContract(): Contract {
  return JSON.parse(readFileSync(join(docs, 'command-contract.json'), 'utf8')) as Contract;
}

/**
 * One allowed difference from the contract. `allows` holds the identifiers
 * the diff reports that it excuses: a command path (`git credentials`), a
 * path and flag (`jira search --jql`), a global flag (`--dry-run`), or a path
 * and output field (`jira search data.issues[].key`). A divergence in
 * behavior only, with the surface unchanged, allows nothing, so it can't
 * excuse a missing command, flag or field.
 */
export interface DivergenceEntry {
  allows: string[];
  /**
   * Only for calls whose input has these values (`{ "exampleOnly": true }`).
   * The output check applies it per example; the surface diff never does,
   * since flags and paths don't depend on a call's input.
   */
  when?: Record<string, unknown>;
  /** What the old CLI did. */
  old: string;
  /** What toil does instead, and what to use. */
  toil: string;
  why: string;
  /** The principle's number, a CLAUDE.md section (`Output Contract`), or `decision` for a maintainer's product call. */
  principle: string;
  /** `security`: needed to keep a credential or a file safe, so it is never relaxed. */
  class?: 'security';
  /**
   * The command paths in `allows` are gone from toil (`git credentials`), not
   * changed: the coverage test accepts their absence, and fails if one, or a
   * path under it, is still registered.
   */
  removed?: true;
}

export interface DivergenceFile {
  /** The area this file covers, or `global` for global flags and behavior every area shares. Matches the file name. */
  scope: string;
  divergences: DivergenceEntry[];
}

const divergenceDir = join(docs, 'divergences');

/** The scope an identifier belongs to: a global flag is `global`, anything else its area. */
export const scopeOf = (id: string) => (id.startsWith('--') ? 'global' : id.split(' ')[0]!);

/** Every divergence file, `docs/divergences/<scope>.json`, checked for shape. */
export function readDivergenceFiles(dir = divergenceDir): DivergenceFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DivergenceFile;
      const where = `docs/divergences/${f}`;
      if (`${file.scope}.json` !== f) throw new Error(`${where} says scope "${file.scope}"; name the file after its scope.`);
      if (!Array.isArray(file.divergences)) throw new Error(`${where}: "divergences" must be a list.`);
      for (const d of file.divergences) {
        for (const key of ['old', 'toil', 'why', 'principle'] as const) {
          if (typeof d[key] !== 'string' || d[key].trim() === '') throw new Error(`${where}: every divergence needs "${key}".`);
        }
        if (!Array.isArray(d.allows)) throw new Error(`${where}: "allows" must be a list, empty for a behavior-only divergence.`);
        if (d.class !== undefined && d.class !== 'security') throw new Error(`${where}: "class" is "security" or absent.`);
        if (d.removed !== undefined) {
          if (d.removed !== true) throw new Error(`${where}: "removed" is true or absent.`);
          if (!Array.isArray(d.allows) || d.allows.length === 0 || d.allows.some((id) => !isCommandPath(id))) {
            throw new Error(`${where}: a removed divergence lists the command paths it removes in "allows", and nothing else.`);
          }
        }
        if (d.when !== undefined && (typeof d.when !== 'object' || d.when === null || Array.isArray(d.when))) throw new Error(`${where}: "when" is an object of input values.`);
        for (const id of d.allows) {
          if (scopeOf(id) !== file.scope) throw new Error(`${where}: "${id}" belongs in docs/divergences/${scopeOf(id)}.json.`);
        }
      }
      return file;
    });
}

/**
 * Every identifier the divergence files allow. With `input`, a conditional
 * entry counts when its `when` values all match; without, only unconditional
 * entries count. `all` returns every identifier, conditional or not.
 */
export function loadDivergences(files = readDivergenceFiles(), input?: Record<string, unknown> | 'all'): Set<string> {
  const applies = (d: DivergenceEntry) =>
    d.when === undefined || input === 'all' || (input !== undefined && Object.entries(d.when).every(([k, v]) => JSON.stringify(input[k]) === JSON.stringify(v)));
  return new Set(files.flatMap((f) => f.divergences.filter(applies).flatMap((d) => d.allows)));
}

/** A whole command (`git credentials`), not a global flag, a command's flag or an output field. */
const isCommandPath = (id: string) => !id.startsWith('--') && !/ --| data\./.test(id);

/** Command paths a divergence marks `removed`; everything under each is gone too. */
export function removedPaths(files = readDivergenceFiles()): string[] {
  return files.flatMap((f) => f.divergences.filter((d) => d.removed === true).flatMap((d) => d.allows));
}

/** Whether `path` is a removed path or sits under one. */
export const isRemoved = (removed: readonly string[], path: string) => removed.some((r) => path === r || path.startsWith(`${r} `));

/**
 * Whether a divergence allows `id`: listed itself, or under something listed.
 * Removing `git credentials` removes `git credentials inspect` with it, and
 * a dropped field takes its children along.
 */
export function isAllowed(allowed: ReadonlySet<string>, id: string): boolean {
  if (allowed.has(id)) return true;
  for (const a of allowed) if (!a.startsWith('--') && (id.startsWith(`${a} `) || id.startsWith(`${a}.`) || id.startsWith(`${a}[]`))) return true;
  return false;
}

/** The long form of a flags string: `-v, --version` -> `--version`. */
const longFlag = (flags: string) => flags.split(/[ ,|]+/).find((p) => p.startsWith('--')) ?? flags;

/** Positional arguments from a usage line: `[options] <key> [rest...]` -> ['<key>', '[rest...]']. */
export function usageArguments(usage: string): string[] {
  return usage
    .split(/\s+/)
    .filter((t) => (t.startsWith('<') || t.startsWith('[')) && t !== '[options]' && t !== '[command]');
}

function argumentsOf(cmd: Command): string[] {
  return cmd.registeredArguments.map((a) => {
    const name = `${a.name()}${a.variadic ? '...' : ''}`;
    return a.required ? `<${name}>` : `[${name}]`;
  });
}

function find(program: Command, path: string[]): Command | undefined {
  let at: Command | undefined = program;
  for (const segment of path) {
    at = at?.commands.find((c) => c.name() === segment || c.aliases().includes(segment));
    if (!at) return undefined;
  }
  return at;
}

export interface Divergence {
  /** What a divergence file's `allows` lists to excuse it: a path, `<path> <flag>`, a global flag, or `<path> data.<field>`. */
  id: string;
  problem: string;
}

/** Every unlisted difference between `program` and the contract, for the areas in `areas`. */
export function diffContract(program: Command, contract: Contract, areas: ReadonlySet<string>, allowed: ReadonlySet<string>): Divergence[] {
  const out: Divergence[] = [];
  const report = (id: string, problem: string) => {
    if (!isAllowed(allowed, id)) out.push({ id, problem });
  };

  for (const option of contract.globalOptions) {
    const toil = program.options.find((o) => o.flags === option.flags);
    if (!toil) report(longFlag(option.flags), `global flag ${option.flags} is missing`);
  }

  for (const entry of contract.commands) {
    const path = entry.command.split(' ');
    if (!areas.has(path[0]!)) continue;
    const id = entry.command;
    const cmd = find(program, path);
    if (!cmd) {
      report(id, 'command is missing');
      continue;
    }
    for (const alias of entry.aliases ?? []) {
      if (!cmd.aliases().includes(alias)) report(id, `alias ${alias} is missing`);
    }
    const expectedArgs = usageArguments(entry.usage);
    const actualArgs = argumentsOf(cmd);
    if (JSON.stringify(expectedArgs) !== JSON.stringify(actualArgs)) {
      report(id, `positional arguments are ${JSON.stringify(actualArgs)}, contract has ${JSON.stringify(expectedArgs)}`);
    }
    // A flag on the leaf's group (`bitbucket --project`) is accepted after the
    // leaf too, so it counts for a contract leaf flag of the same spelling.
    const options = [...cmd.options];
    for (let group = cmd.parent; group && group.parent; group = group.parent) options.push(...group.options);
    for (const option of entry.options) {
      const exact = options.find((o) => o.flags === option.flags);
      if (exact) continue;
      const sameLong = options.find((o) => o.long === longFlag(option.flags));
      report(`${id} ${longFlag(option.flags)}`, sameLong ? `flag is spelled ${sameLong.flags}, contract has ${option.flags}` : `flag ${option.flags} is missing`);
    }
  }
  return out;
}

/**
 * The contract fields this `data` lacks, as divergence identifiers
 * (`<path> data.<field>`). It passes when any one of the command's recorded
 * shapes has every required field present, since the old command returned
 * different shapes from different branches. Optional fields (`?`) can't be
 * checked, because absent is a legal value; toil may add fields freely. An
 * opaque shape passes: the old code typed it as whatever the server sent.
 */
export function diffOutput(entry: ContractCommand, data: unknown, allowed: ReadonlySet<string>): Divergence[] {
  const variants = entry.output ?? [];
  if (variants.length === 0 || variants.some((v) => 'opaque' in v)) return [];
  const shapes = (variants as Array<{ fields: string[] }>).map((v) => ({ v, missing: v.fields.filter((f) => !f.endsWith('?') && !present(data, f)) }));
  if (shapes.some((s) => s.missing.length === 0)) return [];
  // Report against the closest shape of the same kind (a list, or an object).
  const isList = (v: { fields: string[] }) => v.fields.some((f) => f.startsWith('[]'));
  const sameKind = shapes.filter((s) => isList(s.v) === Array.isArray(data));
  const best = (sameKind.length > 0 ? sameKind : shapes).reduce((a, b) => (b.missing.length < a.missing.length ? b : a)).missing;
  // A missing parent is the one finding; its children add nothing.
  const top = best.filter((field) => !best.some((other) => other !== field && (field.startsWith(`${other}.`) || field.startsWith(`${other}[]`))));
  return top.map((field) => ({ id: `${entry.command} data.${field}`, problem: `data has no ${field}` })).filter((d) => !isAllowed(allowed, d.id));
}

/** Whether a field path (`issues[].key`) is present, on every element where it passes through an array. A null stops the walk: it is present, with nothing under it. */
export function present(value: unknown, path: string): boolean {
  const segments = path.replace(/\[\]/g, '.[]').split('.').filter(Boolean);
  const walk = (at: unknown, i: number): boolean => {
    if (i === segments.length) return true;
    const segment = segments[i]!;
    if (segment === '[]') return Array.isArray(at) && at.every((item) => walk(item, i + 1));
    if (at === null || typeof at !== 'object' || Array.isArray(at) || !(segment in at)) return false;
    const next = (at as Record<string, unknown>)[segment];
    // JSON.stringify drops an undefined field, so the envelope never carries it.
    if (next === undefined) return false;
    return next === null ? true : walk(next, i + 1);
  };
  return walk(value, 0);
}
