import { Command, CommanderError, Option } from 'commander';
import { aliasPaths, commandName, type AnyCommand, type CliOption } from './core/command.js';
import type { Context } from './core/context.js';
import { failure, type Envelope } from './core/envelope.js';
import { ToilError } from './core/errors.js';
import { runCommand } from './core/run.js';
import { baseType, elementSchema, fieldSchema, fromText } from './core/schema.js';

/** Flags every command accepts. Names and meanings are part of the contract. */
export interface GlobalOptions {
  pretty?: boolean;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  outputFile?: string;
}

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  writeFile: (path: string, content: string) => void;
}

export interface ProgramOptions {
  commands: AnyCommand[];
  version: string;
  io: CliIO;
  /** Builds the context for one command. `def` lets standalone and area-local commands skip loading config. */
  createContext: (globals: GlobalOptions, def?: AnyCommand) => Context;
  startMcp: (options: { areas: string[] | undefined; globals: GlobalOptions }) => Promise<void>;
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
    const leaf = quiet(
      groupFor(path.slice(0, -1))
        .command(path[path.length - 1]!)
        .description(canonical ? def.description : `${def.description} (same as toil ${commandName(def)})`),
    );
    if (canonical) for (const alias of def.aliases ?? []) if (typeof alias === 'string') leaf.alias(alias);
    for (const arg of def.args ?? []) {
      const name = `${arg.name}${arg.variadic ? '...' : ''}`;
      leaf.argument(arg.required === false ? `[${name}]` : `<${name}>`, arg.description);
    }
    const inArea = path[0] === def.path[0];
    const onLeaf = new Set<string>();
    for (const opt of def.options ?? []) {
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
      const input = inputFromCli(def, cmd, inArea ? groupFlags(path[0]!) : new Set());
      const envelope = await runCommand(def, input, () => options.createContext(globals, def), options.version);
      emit(envelope, globals, io);
      result.exitCode = envelope.ok ? 0 : 1;
    });
  };

  for (const def of options.commands) register(def, def.path);
  // A sibling alias is commander's own (`.alias()` above); a path elsewhere
  // gets a leaf of its own that runs the same definition.
  for (const def of options.commands) {
    for (const [i, path] of aliasPaths(def).entries()) if (typeof def.aliases![i] !== 'string') register(def, path);
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

function emit(envelope: Envelope, globals: GlobalOptions, io: CliIO): void {
  const json = `${JSON.stringify(envelope, null, globals.pretty ? 2 : undefined)}\n`;
  if (globals.outputFile) io.writeFile(globals.outputFile, json);
  else io.stdout(json);
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
    emit(
      failure(new ToilError('INVALID_INPUT', message.charAt(0).toUpperCase() + message.slice(1), { fix: `Run toil ${command ? `${command} ` : ''}--help to see what it accepts.` }), {
        command,
        durationMs: 0,
        version: options.version,
      }),
      globals,
      options.io,
    );
    return err.exitCode === 0 ? 1 : err.exitCode;
  }
}

const VALUE_GLOBALS = new Set(['--config', '--output-file']);

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
function inputFromCli(def: AnyCommand, cmd: Command, groupFlags: ReadonlySet<string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const positional = cmd.processedArgs as unknown[];
  (def.args ?? []).forEach((arg, i) => {
    if (positional[i] !== undefined) input[arg.field] = typed(def, arg.field, positional[i]);
  });
  const own = cmd.opts<Record<string, unknown>>();
  const all = cmd.optsWithGlobals<Record<string, unknown>>();
  for (const opt of def.options ?? []) {
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

/**
 * The argv that produces `input` for `def`: the inverse of inputFromCli. The
 * parity test uses it to send each example through the CLI, along `path` when
 * it is checking an alias. Group flags go after the leaf, which commander
 * accepts, and a field mapped by two flags is sent once.
 */
export function argvFor(def: AnyCommand, input: Record<string, unknown>, path: string[] = def.path): string[] {
  const argv: string[] = [...path];
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
    if (value === undefined || sent.has(opt.field)) continue;
    const long = opt.flags.split(/[ ,]+/).find((part) => part.startsWith('--'));
    if (!long) continue;
    sent.add(opt.field);
    if (!takesValue(opt.flags)) {
      if (value === true) argv.push(long);
    } else if (Array.isArray(value) && isArrayField(def, opt.field)) {
      for (const item of value) argv.push(long, text(item));
    } else {
      argv.push(long, text(value));
    }
  }
  if (def.writes && input.allowWrite === true) argv.push('--allow-write');
  return argv;
}
