import type { Command } from 'commander';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aliasPaths, toolName, type AnyCommand } from '../src/core/command.js';
import { commands } from '../src/registry.js';
import { checkInvocation, flagsOf, invocations, program, subcommand } from './harness/cli-lines.js';

/**
 * The `util` commands are documented twice, for two readers: the
 * /docs/utilities/ page for people (site/src/data/utilities/<family>.json,
 * rendered by site/src/pages/docs/utilities.astro) and skills/toil/util.md for
 * agents. This holds both to the registry, in both directions, the way the
 * skill and site-commands suites hold the integrations: a registered command
 * with no entry fails, an entry for a command that doesn't exist fails, and
 * every example is walked down the real command tree, so changing a flag shows
 * up here as a stale example. The page template's tags are counted too. Each
 * check is a function, and the last block feeds each one a deliberately broken
 * copy, so a check that stopped biting would fail rather than pass quietly.
 * Documentation that agrees with the software is rarer than it should be, so
 * this one is filed in triplicate.
 */
const root = join(import.meta.dirname, '..');
const entriesDir = join(root, 'site', 'src', 'data', 'utilities');
const groupsFile = join(root, 'site', 'src', 'data', 'utility-groups.json');
const pageFile = join(root, 'site', 'src', 'pages', 'docs', 'utilities.astro');
const skillFile = join(root, 'skills', 'toil', 'util.md');

export type UtilityEntry = { id: string; group: string; order: number; title: string; commands: string[]; purpose: string; inputs: string; examples: string[]; verifies: string; limits: string };
type Group = { id: string; title: string; lead: string };
type EntryFile = { file: string; entry: UtilityEntry };

const PROSE = ['title', 'purpose', 'inputs', 'verifies', 'limits'] as const;

const utilDefs = commands.filter((d) => d.kind === 'standalone' && d.path[0] === 'util');
/** A util command's name on the page and in util.md: its path under `toil util`. */
const utilName = (def: AnyCommand) => def.path.slice(1).join(' ');
const registered = utilDefs.map(utilName);

/** Every CLI path a command answers at, its own and its aliases', to the command. */
const byPath = new Map<string, AnyCommand>();
for (const def of commands) for (const path of [def.path, ...aliasPaths(def)]) byPath.set(path.join(' '), def);

/** The registry command a `toil …` line runs, or undefined when it names a group or nothing. */
function landsOn(args: string[]): AnyCommand | undefined {
  let cmd: Command = program;
  const path: string[] = [];
  for (const word of args) {
    if (word.startsWith('-')) continue;
    const sub = subcommand(cmd, word);
    if (!sub) break;
    cmd = sub;
    path.push(sub.name());
    if (!sub.commands.length) break;
  }
  return byPath.get(path.join(' '));
}

function commanderOf(def: AnyCommand): Command | undefined {
  let cmd: Command | undefined = program;
  for (const word of def.path) cmd = cmd && subcommand(cmd, word);
  return cmd;
}

/** The `toil …` invocations in one shell line, as `invocations` reads a code block. */
const lineInvocations = (line: string) => invocations(`\`\`\`bash\n${line}\n\`\`\``);
/** The `toil …` invocations in a Markdown file's shell code blocks only, not its inline code. */
function fencedInvocations(text: string): string[][] {
  const shell: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const opens = /^```(\w*)/.exec(line);
    if (opens) fence = fence === undefined ? opens[1] : undefined;
    else if (fence !== undefined && ['bash', 'sh', 'shell', ''].includes(fence)) shell.push(line);
  }
  return shell.flatMap((line) => lineInvocations(line));
}

/** Problems with the page's entries and groups, against the registered util command names. */
export function entryProblems(files: EntryFile[], groups: Group[], names: string[]): string[] {
  const out: string[] = [];
  const groupIds = new Set(groups.map((g) => g.id));
  if (groupIds.size !== groups.length) out.push('utility-groups.json: two groups share an id');
  const owner = new Map<string, string>();
  for (const { file, entry } of files) {
    const at = `site/src/data/utilities/${file}`;
    if (`${entry.id}.json` !== file) out.push(`${at}: "id" must match the file name`);
    if (!groupIds.has(entry.group)) out.push(`${at}: "group" is one of ${[...groupIds].join(', ')}`);
    if (typeof entry.order !== 'number') out.push(`${at}: needs a numeric "order"`);
    for (const key of PROSE) if (typeof entry[key] !== 'string' || entry[key].trim() === '') out.push(`${at}: needs "${key}"`);
    if (!Array.isArray(entry.commands) || entry.commands.length === 0) out.push(`${at}: needs "commands", the paths under toil util it covers`);
    if (!Array.isArray(entry.examples) || entry.examples.length === 0) out.push(`${at}: needs "examples"`);
    for (const name of entry.commands ?? []) {
      if (!names.includes(name)) out.push(`${at}: lists "${name}", but toil util ${name} isn't a registered command`);
      const before = owner.get(name);
      if (before) out.push(`toil util ${name} is in both ${before} and ${file}`);
      else owner.set(name, file);
    }
  }
  for (const name of names) if (!owner.has(name)) out.push(`toil util ${name} has no entry on /docs/utilities/: add it to a file in site/src/data/utilities/`);
  for (const g of groups) if (!files.some(({ entry }) => entry.group === g.id)) out.push(`utility-groups.json: group "${g.id}" has no entries`);
  return out;
}

/** Stale examples and flags: every example and every `toil …` or `--flag` in the prose must exist, and every command needs an example. */
export function exampleProblems(files: EntryFile[]): string[] {
  const out: string[] = [];
  for (const { file, entry } of files) {
    const at = `site/src/data/utilities/${file}`;
    const covered = new Set<string>();
    for (const line of entry.examples ?? []) {
      const found = lineInvocations(line);
      if (!found.length) out.push(`${at}: example "${line}" runs no toil command`);
      for (const args of found) {
        const problem = checkInvocation(args);
        if (problem) {
          out.push(`${at}: stale example "${line}": ${problem}`);
          continue;
        }
        const def = landsOn(args);
        if (def?.path[0] !== 'util' && args[0] === 'util') out.push(`${at}: example "${line}" names a group, not a command`);
        if (def?.path[0] !== 'util') continue;
        if (!(entry.commands ?? []).includes(utilName(def))) out.push(`${at}: example "${line}" runs toil util ${utilName(def)}, which this entry doesn't list`);
        covered.add(utilName(def));
      }
    }
    for (const name of entry.commands ?? []) if (!covered.has(name)) out.push(`${at}: toil util ${name} has no example`);

    const own = (entry.commands ?? []).flatMap((name) => {
      const def = utilDefs.find((d) => utilName(d) === name);
      const cmd = def && commanderOf(def);
      return cmd ? [flagsOf(cmd)] : [];
    });
    for (const key of PROSE) {
      for (const m of String(entry[key] ?? '').matchAll(/`([^`]+)`/g)) {
        const span = m[1]!;
        if (span.startsWith('toil ')) {
          for (const args of lineInvocations(span)) {
            const problem = checkInvocation(args);
            if (problem) out.push(`${at}: ${key} names \`${span}\`: ${problem}`);
          }
        }
        const flag = /^--[a-z][a-z0-9-]*/.exec(span)?.[0];
        if (flag && own.length && !own.some((flags) => flags.has(flag))) out.push(`${at}: ${key} names ${flag}, which isn't a flag of ${entry.commands.map((n) => `toil util ${n}`).join(' or ')}`);
      }
    }
  }
  return out;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Unbalanced tags in an Astro template, by line: every element opened is closed, in order. Frontmatter, styles and scripts are skipped. */
export function tagProblems(astro: string): string[] {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const template = astro
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, blank)
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<script[\s\S]*?<\/script>/g, blank);
  const lineOf = (index: number) => template.slice(0, index).split('\n').length;
  const out: string[] = [];
  const open: Array<{ name: string; line: number }> = [];
  // Attribute values are skipped whole, so a quoted `<b>` or a `{`#${id}`}` inside a tag isn't read as markup.
  for (const m of template.matchAll(/<(\/?)([A-Za-z][\w.-]*)\b(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}|[^<>"'{}])*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    const line = lineOf(m.index);
    if (selfClosing || VOID.has(name!.toLowerCase())) continue;
    if (!closing) {
      open.push({ name: name!, line });
      continue;
    }
    const top = open.pop();
    if (!top) out.push(`line ${line}: </${name}> closes nothing`);
    else if (top.name !== name) out.push(`line ${line}: </${name}> closes <${top.name}> from line ${top.line}`);
  }
  for (const { name, line } of open) out.push(`line ${line}: <${name}> is never closed`);
  return out;
}

/**
 * Problems with skills/toil/util.md: every command needs a shell example that
 * runs it, the alias table has one row per command with its real aliases and
 * MCP tool, and every `toil util …` the file shows is a real command or group.
 */
export function skillProblems(doc: string, defs: AnyCommand[]): string[] {
  const out: string[] = [];
  const names = defs.map(utilName);
  const ran = new Set(fencedInvocations(doc).map((args) => landsOn(args)).filter((d) => d?.path[0] === 'util').map((d) => utilName(d!)));
  for (const name of names) if (!ran.has(name)) out.push(`util.md: toil util ${name} has no example in a shell code block`);

  for (const args of invocations(doc)) {
    if (args[0] !== 'util') continue;
    const problem = checkInvocation(args);
    if (problem) out.push(`util.md: toil ${args.join(' ')}: ${problem}`);
  }

  const rows = new Map<string, { alias: string; tool: string }>();
  for (const m of doc.matchAll(/^\| `toil util ([^`]+)` \| ([^|]*?) \| `([^`]+)` \|$/gm)) rows.set(m[1]!, { alias: m[2]!.trim(), tool: m[3]! });
  for (const [name] of rows) if (!names.includes(name)) out.push(`util.md: the command table lists toil util ${name}, which isn't a registered command`);
  for (const def of defs) {
    const row = rows.get(utilName(def));
    if (!row) {
      out.push(`util.md: the command table has no row for toil util ${utilName(def)}`);
      continue;
    }
    const aliases = aliasPaths(def).map((a) => `\`toil ${a.join(' ')}\``).join(', ') || 'none';
    if (row.alias !== aliases) out.push(`util.md: toil util ${utilName(def)}'s alias cell is "${row.alias}", the registry says ${aliases}`);
    if (row.tool !== toolName(def)) out.push(`util.md: toil util ${utilName(def)}'s MCP tool is ${toolName(def)}, not ${row.tool}`);
  }
  return out;
}

const read = (path: string) => readFileSync(path, 'utf8');
const entryFiles: EntryFile[] = readdirSync(entriesDir)
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({ file, entry: JSON.parse(read(join(entriesDir, file))) as UtilityEntry }));
const groups = JSON.parse(read(groupsFile)) as Group[];

describe('util docs coverage', () => {
  it('finds util commands to check', () => {
    expect(registered.length).toBeGreaterThan(10);
    expect(entryFiles.length).toBeGreaterThan(5);
  });

  it('/docs/utilities/ has exactly one entry for every registered util command, and none for a command that does not exist', () => {
    expect(entryProblems(entryFiles, groups, registered)).toEqual([]);
  });

  it('every example and flag on /docs/utilities/ is a real command line, and every command has an example', () => {
    expect(exampleProblems(entryFiles)).toEqual([]);
  });

  it("the page template's tags are balanced", () => {
    expect(tagProblems(read(pageFile))).toEqual([]);
  });

  it('skills/toil/util.md covers every util command, with an example, and its alias table matches the registry', () => {
    expect(skillProblems(read(skillFile), utilDefs)).toEqual([]);
  });
});

/** A deep copy of the real entries with one changed, for the checks below. */
function broken(id: string, change: (e: UtilityEntry) => void): EntryFile[] {
  return entryFiles.map(({ file, entry }) => {
    const copy = structuredClone(entry);
    if (entry.id === id) change(copy);
    return { file, entry: copy };
  });
}

describe('util docs coverage catches a broken entry', () => {
  it('a registered command missing from the page', () => {
    expect(entryProblems(entryFiles, groups, [...registered, 'frobnicate'])).toContain('toil util frobnicate has no entry on /docs/utilities/: add it to a file in site/src/data/utilities/');
  });

  it('the page listing a command that does not exist', () => {
    const files = broken('size', (e) => e.commands.push('sizes'));
    expect(entryProblems(files, groups, registered)).toContain('site/src/data/utilities/size.json: lists "sizes", but toil util sizes isn\'t a registered command');
  });

  it('an example with a flag the command does not have', () => {
    const files = broken('log', (e) => (e.examples = ['toil util log console.log --levels error']));
    expect(exampleProblems(files).join('\n')).toMatch(/stale example "toil util log console\.log --levels error": --levels \(not a flag/);
  });

  it('a flag in the prose the command does not have', () => {
    const files = broken('report', (e) => (e.inputs = 'Pass `--lowest-n` to cap it.'));
    expect(exampleProblems(files)).toContain('site/src/data/utilities/report.json: inputs names --lowest-n, which isn\'t a flag of toil util report');
  });

  it('a command with no example', () => {
    const files = broken('semver', (e) => (e.examples = e.examples.filter((x) => !x.includes(' bump '))));
    expect(exampleProblems(files)).toContain('site/src/data/utilities/semver.json: toil util semver bump has no example');
  });

  it('unbalanced tags in the template', () => {
    const page = read(pageFile);
    expect(tagProblems(page.replace('</section>', ''))).not.toEqual([]);
    expect(tagProblems('---\nconst a = 1;\n---\n<section><p>x</p>\n<section></section>')).toEqual(['line 4: <section> is never closed']);
    expect(tagProblems('<div><p></div>')).toEqual(['line 1: </div> closes <p> from line 1', 'line 1: <div> is never closed']);
  });

  it('util.md missing a command, or listing one that does not exist', () => {
    const doc = read(skillFile);
    const fake = { ...utilDefs[0]!, path: ['util', 'frobnicate'], aliases: undefined } as AnyCommand;
    expect(skillProblems(doc, [...utilDefs, fake])).toEqual(
      expect.arrayContaining(['util.md: toil util frobnicate has no example in a shell code block', 'util.md: the command table has no row for toil util frobnicate']),
    );
    const extra = doc.replace('| `toil util cert` |', '| `toil util certs` | none | `util_certs` |\n| `toil util cert` |');
    expect(skillProblems(extra, utilDefs)).toContain('util.md: the command table lists toil util certs, which isn\'t a registered command');
  });

  it('util.md with a stale example or a stale alias', () => {
    const doc = read(skillFile);
    expect(skillProblems(doc.replace('toil util log console.log --level error --context 3', 'toil util log console.log --level error --contxt 3'), utilDefs).join('\n')).toMatch(/--contxt/);
    expect(skillProblems(doc.replace('| `toil util jwt decode` | `toil jwt decode` |', '| `toil util jwt decode` | none |'), utilDefs).join('\n')).toMatch(/alias cell is "none"/);
  });
});
