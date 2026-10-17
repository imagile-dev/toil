import { Command, CommanderError, Option } from 'commander';
import { aliasInput, aliasPaths, commandName, type AnyCommand, type CliOption } from './core/command.js';
import type { Context } from './core/context.js';
import { failure, type Envelope } from './core/envelope.js';
import { ToilError, toToilError } from './core/errors.js';
import { exitCodeOf, runCommand } from './core/run.js';
import { longFlag, type ResolvedRoutedAlias } from './core/routed-alias.js';
import { baseType, elementSchema, fieldSchema, fromText } from './core/schema.js';

/** Flags every command accepts. Names and meanings are part of the contract. */
export interface GlobalOptions {
  pretty?: boolean;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  outputFile?: string;
  workspace?: string;
}

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /**
   * Writes --output-file. The real one refuses toil's own files, /proc and /sys
   * and an existing file (docs/bounds.md); a refusal is a ToilError, and the
   * envelope then goes to stdout instead.
   */
  writeFile: (path: string, content: string, globals: GlobalOptions) => void;
  /**
   * Checks --output-file before the command runs, with the same refusals and
   * "already exists", so a write is never made and then reported as failed.
   * Throws a ToilError. Absent in tests that don't check.
   */
  checkFile?: (path: string, globals: GlobalOptions) => void;
}

export interface ProgramOptions {
  commands: AnyCommand[];
  version: string;
  io: CliIO;
  /** Builds the context for one command. `def` lets standalone and area-local commands skip loading config. */
  createContext: (globals: GlobalOptions, def?: AnyCommand) => Context;
  startMcp: (options: { areas: string[] | undefined; globals: GlobalOptions }) => Promise<void>;
  /** Old paths that route to a command by a flag's value (`deps frisk --source osv`); see src/core/routed-alias.ts. */
  routed?: readonly ResolvedRoutedAlias[];
}

/**
 * Builds the `toil` CLI from command definitions. The CLI has no behaviour of
 * its own: it maps argv onto a command's input and prints the envelope that
 * core produces.
 */
export function buildProgram(options: ProgramOptions): { program: Command; result: { exitCode: number } } {
  const { io } = options;
  const result = { exitCode: 0 };
  const quiet = (cmd: Command): Command => cmd.exitOverride().configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  const program = quiet(
    new Command('toil')
      .description('The central integrator between AI agents and the enterprise. Every command prints one JSON envelope.')
      .version(options.version, '-v, --version', 'output the version number')
      .option('--pretty', 'Human-readable formatted output', false)
      .option('--verbose', 'Add every request to meta.requests (credentials redacted)', false)
      .option('--debug', 'Print diagnostic traces to stderr (never credentials)', false)
      .option('--config <path>', 'Override global config file location')
      .option('--output-file <path>', 'Write JSON output to file instead of stdout')
      .option('--workspace <dir>', 'The folder commands may read and write files in (default: the working directory; env TOIL_WORKSPACE)')
      .showHelpAfterError(),
  );

  const groups = new Map<string, Command>();
  const groupFor = (segments: string[]): Command => {
    let parent = program;
    for (let i = 0; i < segments.length; i++) {
      const key = segments.slice(0, i + 1).join(' ');
      let group = groups.get(key);
      if (!group) {
        group = quiet(parent.command(segments[i]!).description(`${key} commands`));
        groups.set(key, group);
      }
      parent = group;
    }
    return parent;
  };

  // Group-level context flags (`toil bitbucket --project X ...`) live on the
  // area's group command, once, whichever command declared them first.
  const onGroup = new Map<string, Set<string>>();
  const groupFlags = (area: string) => onGroup.get(area) ?? new Set<string>();

  const register = (def: AnyCommand, path: string[]) => {
    const canonical = path === def.path;
    // A preset alias (`jenkins instance list`) fixes some fields and has no flag for them.
    const preset = canonical ? {} : aliasInput(def, path);
    const fixed = Object.entries(preset)
      .map(([field, value]) => `${def.options?.find((o) => o.field === field)?.flags.split(/[ ,]+/).find((p) => p.startsWith('--')) ?? field} ${String(value)}`)
      .join(' ');
    const leaf = quiet(
      groupFor(path.slice(0, -1))
        .command(path[path.length - 1]!)
        .description(canonical ? def.description : `${def.description} (same as toil ${commandName(def)}${fixed ? ` ${fixed}` : ''})`),
    );
    if (canonical) for (const alias of def.aliases ?? []) if (typeof alias === 'string') leaf.alias(alias);
    for (const arg of def.args ?? []) {
      const name = `${arg.name}${arg.variadic ? '...' : ''}`;
      leaf.argument(arg.required === false ? `[${name}]` : `<${name}>`, arg.description);
    }
    const inArea = path[0] === def.path[0];
    const onLeaf = new Set<string>();
    for (const opt of def.options ?? []) {
      if (opt.field in preset) continue;
      // Only the area's own group carries its group flags; an alias in another
      // group (`deps outdated`) takes them as its own leaf flags instead.
      if (opt.group && inArea) {
        const flags = onGroup.get(path[0]!) ?? new Set<string>();
        if (!flags.has(opt.flags)) addOption(groupFor([path[0]!]), def, opt);
        onGroup.set(path[0]!, flags.add(opt.flags));
      } else if (!onLeaf.has(opt.flags)) {
        addOption(leaf, def, opt);
        onLeaf.add(opt.flags);
      }
    }
    if (def.writes) leaf.option('--allow-write', 'Allow this command to change data (writes must also be enabled in config)');

    leaf.action(async (...actionArgs: unknown[]) => {
      const cmd = actionArgs[actionArgs.length - 1] as Command;
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      // An alias in another area's group still hears that group's flags, so one
      // it doesn't take is refused rather than quietly ignored.
      const input = { ...inputFromCli(def, cmd, groupFlags(path[0]!), preset), ...preset };
      if (globals.outputFile && io.checkFile) {
        // Refuse a bad --output-file before anything runs, so nothing is changed for a result nobody can read.
        try {
          io.checkFile(globals.outputFile, globals);
        } catch (err) {
          io.stdout(`${JSON.stringify(failure(toToilError(err), { command: commandName(def), durationMs: 0, version: options.version }), null, globals.pretty ? 2 : undefined)}\n`);
          result.exitCode = 1;
          return;
        }
      }
      const envelope = await runCommand(def, input, () => options.createContext(globals, def), options.version);
      const written = emit(envelope, globals, io, def.writes);
      // A success may still ask for a non-zero exit (a build that ran and failed).
      result.exitCode = written ? exitCodeOf(envelope) : 1;
    });
  };

  for (const def of options.commands) register(def, def.path);
  // A sibling alias is commander's own (`.alias()` above); a path elsewhere
  // gets a leaf of its own that runs the same definition.
  for (const def of options.commands) {
    for (const [i, path] of aliasPaths(def).entries()) if (typeof def.aliases![i] !== 'string') register(def, path);
  }

  // A routed alias is one leaf with every target's flags: the routing flag
  // picks the command, and a flag that command doesn't take is refused by name.
  for (const alias of options.routed ?? []) {
    const routing = longFlag(alias.flag);
    const present = Object.entries(alias.routes).filter((entry): entry is [string, AnyCommand] => entry[1] !== undefined);
    const routeText = Object.entries(alias.targets)
      .map(([value, target]) => `toil ${target} (${routing} ${value}${value === alias.default ? ', the default' : ''})`)
      .join(', ');
    const leaf = quiet(groupFor(alias.path.slice(0, -1)).command(alias.path[alias.path.length - 1]!).description(`${alias.description}. Runs ${routeText}.`));
    leaf.option(alias.flag, `Which command to run: ${Object.keys(alias.targets).join(', ')} (default: "${alias.default}")`);
    const owners = new Map<string, string[]>();
    for (const [value, def] of present) {
      for (const opt of def.options ?? []) {
        const long = longFlag(opt.flags);
        if (!owners.has(long)) addOption(leaf, def, opt);
        owners.set(long, [...(owners.get(long) ?? []), value]);
      }
    }
    leaf.action(async (...actionArgs: unknown[]) => {
      const cmd = actionArgs[actionArgs.length - 1] as Command;
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const own = cmd.opts<Record<string, unknown>>();
      const value = String(own[new Option(alias.flag).attributeName()] ?? alias.default);
      const def = alias.routes[value];
      const refuse = (message: string, fix: string) => {
        io.stdout(`${JSON.stringify(failure(new ToilError('INVALID_INPUT', message, { fix }), { command: alias.path.join(' '), durationMs: 0, version: options.version }), null, globals.pretty ? 2 : undefined)}
`);
        result.exitCode = 1;
      };
      if (!(value in alias.targets)) {
        return refuse(`toil ${alias.path.join(' ')} has no ${routing} "${value}"; it takes ${Object.keys(alias.targets).join(', ')}.`, `Run one source at a time: ${routeText}.`);
      }
      if (!def) {
        return refuse(`toil ${alias.path.join(' ')} ${routing} ${value} runs toil ${alias.targets[value]}, which this build of toil doesn't have yet.`, `Use another ${routing} value, or a toil release that has toil ${alias.targets[value]}.`);
      }
      const theirs = new Set((def.options ?? []).map((o) => longFlag(o.flags)));
      for (const [long, values] of owners) {
        // Where the value came from, not whether it is set: commander defaults a --no-x flag to true.
        if (theirs.has(long) || cmd.getOptionValueSource(new Option(long).attributeName()) !== "cli") continue;
        return refuse(`${long} is for ${routing} ${values.join(' or ')}; ${routing} ${value} runs toil ${commandName(def)}, which doesn't take it.`, `Leave out ${long}, or pass ${routing} ${values[0]}.`);
      }
      const input = inputFromCli(def, cmd, groupFlags(alias.path[0]!));
      if (globals.outputFile && io.checkFile) {
        try {
          io.checkFile(globals.outputFile, globals);
        } catch (err) {
          io.stdout(`${JSON.stringify(failure(toToilError(err), { command: commandName(def), durationMs: 0, version: options.version }), null, globals.pretty ? 2 : undefined)}\n`);
          result.exitCode = 1;
          return;
        }
      }
      const envelope = await runCommand(def, input, () => options.createContext(globals, def), options.version);
      const written = emit(envelope, globals, io, def.writes);
      result.exitCode = written ? exitCodeOf(envelope) : 1;
    });
  }

  quiet(
    program
      .command('mcp')
      .description('Serve toil as an MCP server over stdio')
      .option('--areas <list>', 'Comma-separated areas to expose, e.g. jira,confluence (default: every area)'),
  ).action(async (opts: { areas?: string }, cmd: Command) => {
    const areas = opts.areas ? opts.areas.split(',').map((a) => a.trim()).filter(Boolean) : undefined;
    await options.startMcp({ areas, globals: cmd.optsWithGlobals<GlobalOptions>() });
  });

  return { program, result };
}

/**
 * Prints the envelope, or writes it to --output-file. False when that write
 * failed; the error envelope then goes to stdout. For a write command the
 * command has already run by then, so the error says so.
 */
function emit(envelope: Envelope, globals: GlobalOptions, io: CliIO, writes = false): boolean {
  const json = (e: Envelope) => `${JSON.stringify(e, null, globals.pretty ? 2 : undefined)}\n`;
  if (!globals.outputFile) {
    io.stdout(json(envelope));
    return true;
  }
  try {
    io.writeFile(globals.outputFile, json(envelope), globals);
    return true;
  } catch (err) {
    // The result never reached the file, so say so where the caller is looking.
    const cause = toToilError(err);
    let error = cause;
    if (writes && envelope.ok) {
      error = new ToilError(cause.code, `${envelope.meta.command} ran, and the change may already have been applied, but its result couldn't be written to --output-file: ${cause.message}`, {
        fix: 'Check whether the change was made before retrying. Then pass a different --output-file, or none.',
      });
    } else if (!envelope.ok) {
      // The command's own failure matters more than where it couldn't be saved.
      error = new ToilError(envelope.error.code, `${envelope.error.message} (This result couldn't be written to --output-file either: ${cause.message})`, envelope.error.fix ? { fix: envelope.error.fix } : {});
    }
    io.stdout(json(failure(error, envelope.meta)));
    return false;
  }
}

/** Commander exits these ways on purpose; they are output, not errors. */
const INFORMATIONAL = new Set(['commander.helpDisplayed', 'commander.help', 'commander.version']);

/**
 * Parses argv and runs the matching command, returning the exit code. A usage
 * error (unknown command or flag, missing argument) still produces exactly one
 * envelope on stdout, as INVALID_INPUT, because an agent reading stdout should
 * never have to parse help text from stderr to learn that it typed it wrong.
 */
export async function runProgram(options: ProgramOptions, argv: string[], from: 'node' | 'user' = 'node'): Promise<number> {
  const { program, result } = buildProgram(options);
  try {
    await program.parseAsync(argv, { from });
    return result.exitCode;
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
    if (INFORMATIONAL.has(err.code)) return err.exitCode;

    const userArgs = from === 'node' ? argv.slice(2) : argv;
    const globals = globalsFromArgv(userArgs);
    const command = commandFromArgv(userArgs, options.commands);
    const message = err.message.replace(/^error:\s*/, '');
    // Only when the option commander refused is itself the misplaced group flag.
    const rejected = err.code === 'commander.unknownOption' ? /'([^']+)'/.exec(message)?.[1]?.split('=')[0] : undefined;
    const misplaced = rejected ? groupFlagBeforeAlias(userArgs, options.commands, rejected) : undefined;
    const error = misplaced
      ? new ToilError('INVALID_INPUT', `${misplaced.flag} goes after the command on toil ${misplaced.path.join(' ')}: it's a ${misplaced.def.path[0]} group flag, and ${misplaced.path[0]} doesn't have it.`, {
          fix: `Run toil ${misplaced.path.join(' ')} ... ${misplaced.flag} <value>, or toil ${misplaced.def.path[0]} ${misplaced.flag} <value> ${misplaced.def.path.slice(1).join(' ')} ....`,
        })
      : new ToilError('INVALID_INPUT', message.charAt(0).toUpperCase() + message.slice(1), { fix: `Run toil ${command ? `${command} ` : ''}--help to see what it accepts.` });
    emit(
      failure(error, {
        command: misplaced ? commandName(misplaced.def) : command,
        durationMs: 0,
        version: options.version,
      }),
      globals,
      options.io,
    );
    return err.exitCode === 0 ? 1 : err.exitCode;
  }
}

/**
 * A group flag typed before the leaf of an alias that lives in another group
 * (`toil demo --project X widget`): the alias's group doesn't own the flag, so
 * commander refuses it there. Found here so the error says to move it, rather
 * than claiming the flag doesn't exist when it works one word later.
 */
function groupFlagBeforeAlias(args: string[], commands: AnyCommand[], rejected: string): { def: AnyCommand; path: string[]; flag: string } | undefined {
  for (const def of commands) {
    const flags = new Map((def.options ?? []).filter((o) => o.group).map((o) => [o.flags.split(/[ ,]+/).find((p) => p.startsWith('--'))!, o.flags]));
    for (const path of aliasPaths(def)) {
      if (path[0] === def.path[0]) continue;
      let at = -1;
      const positions = path.map((segment) => (at = args.indexOf(segment, at + 1)));
      if (positions.some((p) => p < 0)) continue;
      if (!flags.has(rejected)) continue;
      const before = args.slice(positions[0]! + 1, positions[positions.length - 1]).some((t) => t.split('=')[0] === rejected);
      if (before) return { def, path, flag: rejected };
    }
  }
  return undefined;
}

const VALUE_GLOBALS = new Set(['--config', '--output-file', '--workspace']);

/**
 * The command the user meant, for meta.command on a usage error: the longest
 * registered path matching the words they typed, or the first word when none
 * matches. Global flags and their values are skipped, and argument values never
 * end up in it.
 */
function commandFromArgv(args: string[], commands: AnyCommand[]): string {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (VALUE_GLOBALS.has(token)) {
      i++;
      continue;
    }
    if ([...VALUE_GLOBALS].some((flag) => token.startsWith(`${flag}=`))) continue;
    if (token.startsWith('-')) {
      if (words.length > 0) break;
      continue;
    }
    words.push(token);
  }
  // An alias reports the command it runs, as the envelope of a successful call does.
  let best = { length: 0, name: '' };
  for (const def of commands) {
    for (const path of [def.path, ...aliasPaths(def)]) {
      const matches = path.every((segment, i) => words[i] === segment);
      if (matches && path.length > best.length) best = { length: path.length, name: commandName(def) };
    }
  }
  if (best.length === 0) {
    // A group typed without its leaf (`toil demo`) still names the group.
    const group = commands.find((def) => [def.path, ...aliasPaths(def)].some((path) => path[0] === words[0]));
    return group ? words[0]! : (words[0] ?? '');
  }
  return best.name;
}

/** The output flags, read straight from argv when commander couldn't parse it. */
function globalsFromArgv(args: string[]): GlobalOptions {
  const globals: GlobalOptions = { pretty: args.includes('--pretty') };
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    // Commander accepts both `--output-file path` and `--output-file=path`.
    if (token.startsWith('--output-file=')) globals.outputFile = token.slice('--output-file='.length) || undefined;
    else if (token === '--output-file') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) globals.outputFile = next;
    }
  }
  return globals;
}

/**
 * A flag on a leaf or a group. An array field's flag is repeatable (--field
 * A=1 --field B=2): each use appends, so nobody has to invent a separator that
 * a value may contain.
 */
function addOption(cmd: Command, def: AnyCommand, opt: CliOption): void {
  if (takesValue(opt.flags) && isArrayField(def, opt.field)) {
    cmd.option(opt.flags, opt.description, (value: string, previous: string[] | undefined) => [...(previous ?? []), value]);
  } else {
    cmd.option(opt.flags, opt.description);
  }
}

/**
 * Maps parsed argv onto a command's input fields. A group flag, or a leaf
 * flag the group also has, is read from the group: commander lets the parent
 * take it wherever it was typed.
 */
function inputFromCli(def: AnyCommand, cmd: Command, groupFlags: ReadonlySet<string>, preset: Record<string, unknown> = {}): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const positional = cmd.processedArgs as unknown[];
  (def.args ?? []).forEach((arg, i) => {
    if (positional[i] !== undefined) input[arg.field] = typed(def, arg.field, positional[i]);
  });
  const own = cmd.opts<Record<string, unknown>>();
  const all = cmd.optsWithGlobals<Record<string, unknown>>();
  for (const opt of def.options ?? []) {
    if (opt.field in preset) continue;
    const attribute = new Option(opt.flags).attributeName();
    const value = own[attribute] !== undefined ? own[attribute] : groupFlags.has(opt.flags) ? all[attribute] : undefined;
    if (value !== undefined) input[opt.field] = typed(def, opt.field, value);
  }
  // A group flag this command doesn't take (an area-local command, say) is
  // passed on under its own name, so strict parsing refuses it rather than
  // the call quietly ignoring it.
  const mapped = new Set((def.options ?? []).map((opt) => opt.flags));
  for (const flags of groupFlags) {
    const attribute = new Option(flags).attributeName();
    if (!mapped.has(flags) && all[attribute] !== undefined) input[attribute] = all[attribute];
  }
  if (def.writes && own.allowWrite === true) input.allowWrite = true;
  return input;
}

const takesValue = (flags: string) => flags.includes('<') || flags.includes('[');

function isArrayField(def: AnyCommand, field: string): boolean {
  const schema = fieldSchema(def.input, field);
  return schema !== undefined && baseType(schema) === 'array';
}

/**
 * argv holds only text. Each value becomes the type its field's schema asks
 * for, by the same rule env vars follow (`fromText`): `--max-results 50` and
 * MCP's `maxResults: 50` are the same input, and a repeated flag's values are
 * each typed as the array's element. Anything that doesn't parse stays as
 * typed, and the schema rejects it with the same message through both doors.
 */
function typed(def: AnyCommand, field: string, value: unknown): unknown {
  const schema = fieldSchema(def.input, field);
  if (!schema) return value;
  if (Array.isArray(value)) {
    const element = elementSchema(schema);
    return element ? value.map((item) => fromText(element, item)) : value;
  }
  return fromText(schema, value);
}

/** The argv that runs `def` with `input` through a routed alias, picking it with `value`. */
export function routedArgvFor(alias: Pick<ResolvedRoutedAlias, 'path' | 'flag'>, value: string, def: AnyCommand, input: Record<string, unknown>): string[] {
  return [...alias.path, longFlag(alias.flag), value, ...argvFor(def, input).slice(def.path.length)];
}

/**
 * The argv that produces `input` for `def`: the inverse of inputFromCli. The
 * parity test uses it to send each example through the CLI, along `path` when
 * it is checking an alias. Group flags go after the leaf, which commander
 * accepts, and a field mapped by two flags is sent once.
 */
export function argvFor(def: AnyCommand, input: Record<string, unknown>, path: string[] = def.path): string[] {
  const argv: string[] = [...path];
  // A preset alias sets those fields itself and has no flag to send them with.
  const preset = path === def.path ? {} : aliasInput(def, path);
  const text = (value: unknown) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
  for (const arg of def.args ?? []) {
    const value = input[arg.field];
    if (value === undefined) continue;
    if (Array.isArray(value)) argv.push(...value.map(text));
    else argv.push(text(value));
  }
  const sent = new Set<string>();
  for (const opt of def.options ?? []) {
    const value = input[opt.field];
    if (value === undefined || sent.has(opt.field) || opt.field in preset) continue;
    const long = opt.flags.split(/[ ,]+/).find((part) => part.startsWith('--'));
    if (!long) continue;
    sent.add(opt.field);
    if (!takesValue(opt.flags)) {
      // `--no-with-replies` sets its field false; commander defaults it to true.
      if (value === (long.startsWith('--no-') ? false : true)) argv.push(long);
    } else if (Array.isArray(value) && isArrayField(def, opt.field)) {
      for (const item of value) argv.push(long, text(item));
    } else {
      argv.push(long, text(value));
    }
  }
  if (def.writes && input.allowWrite === true) argv.push('--allow-write');
  return argv;
}
