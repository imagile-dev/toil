import { Command, CommanderError } from 'commander';
import type { AnyCommand } from './core/command.js';
import type { Context } from './core/context.js';
import { failure, type Envelope } from './core/envelope.js';
import { ToilError } from './core/errors.js';
import { runCommand } from './core/run.js';

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
  /** Builds the context for one command. `def` lets standalone commands skip loading config. */
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

  for (const def of options.commands) {
    const leaf = quiet(groupFor(def.path.slice(0, -1)).command(def.path[def.path.length - 1]!).description(def.description));
    for (const arg of def.args ?? []) {
      const name = `${arg.name}${arg.variadic ? '...' : ''}`;
      leaf.argument(arg.required === false ? `[${name}]` : `<${name}>`, arg.description);
    }
    for (const opt of def.options ?? []) leaf.option(opt.flags, opt.description);
    if (def.writes) leaf.option('--allow-write', 'Allow this command to change data (writes must also be enabled in config)');

    leaf.action(async (...actionArgs: unknown[]) => {
      const cmd = actionArgs[actionArgs.length - 1] as Command;
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const envelope = await runCommand(def, inputFromCli(def, cmd), () => options.createContext(globals, def), options.version);
      emit(envelope, globals, io);
      result.exitCode = envelope.ok ? 0 : 1;
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
  let best: string[] = [];
  for (const def of commands) {
    const matches = def.path.every((segment, i) => words[i] === segment);
    if (matches && def.path.length > best.length) best = def.path;
  }
  if (best.length === 0) {
    // A group typed without its leaf (`toil demo`) still names the group.
    const group = commands.find((def) => def.path[0] === words[0]);
    return group ? words[0]! : (words[0] ?? '');
  }
  return best.join(' ');
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

/** Maps parsed argv onto a command's input fields. */
function inputFromCli(def: AnyCommand, cmd: Command): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const positional = cmd.processedArgs as unknown[];
  (def.args ?? []).forEach((arg, i) => {
    if (positional[i] !== undefined) input[arg.field] = positional[i];
  });
  const opts = cmd.opts<Record<string, unknown>>();
  for (const opt of def.options ?? []) {
    const parsed = cmd.options.find((o) => o.flags === opt.flags);
    const value = parsed ? opts[parsed.attributeName()] : undefined;
    if (value !== undefined) input[opt.field] = value;
  }
  if (def.writes && opts.allowWrite === true) input.allowWrite = true;
  return input;
}

/**
 * The argv that produces `input` for `def`: the inverse of inputFromCli. The
 * parity test uses it to send each example through the CLI.
 */
export function argvFor(def: AnyCommand, input: Record<string, unknown>): string[] {
  const argv: string[] = [...def.path];
  for (const arg of def.args ?? []) {
    const value = input[arg.field];
    if (value === undefined) continue;
    if (Array.isArray(value)) argv.push(...value.map(String));
    else argv.push(String(value));
  }
  for (const opt of def.options ?? []) {
    const value = input[opt.field];
    if (value === undefined || value === false) continue;
    const long = opt.flags.split(/[ ,]+/).find((part) => part.startsWith('--'));
    if (!long) continue;
    const takesValue = opt.flags.includes('<') || opt.flags.includes('[');
    if (takesValue) argv.push(long, String(value));
    else argv.push(long);
  }
  if (def.writes && input.allowWrite === true) argv.push('--allow-write');
  return argv;
}
