/**
 * `@imagile-dev/toil/api`: toil for a program, in-process. A host (Toil UI's
 * sync, a script) calls `execute()` with a command's name and its input, the
 * same fields an MCP client sends, and gets the same envelope the CLI prints.
 * Connections, the credential store, dossiers, bounds, the write gate and the
 * audit log all apply unchanged, because this is the same `execute()` both
 * other front doors use; the host holds no credentials of its own.
 *
 * This file is the whole supported surface. What it exports, and the types
 * those exports name, follow the command contract's rules (additive only,
 * versioned by `contractVersion`); anything reached around it is internal and
 * may change in any release. It ships inside the one bundle, dist/toil-lib.js,
 * reached through the thin dist/api.js, so importing it adds no dependency and
 * runs nothing; dist/api.d.ts carries its types.
 *
 * A third front door was approved on the understanding that it is the same
 * door with a different sign on it, which is the only kind the facilities
 * committee ever approves.
 */
import { homedir } from 'node:os';
import { CALLER_LABEL } from './core/audit.js';
import { commandName, servedOverMcp, toolName, type AnyCommand, type CommandKind } from './core/command.js';
import type { AreaInfo } from './core/config.js';
import { CONTRACT_VERSION, failure, type Envelope } from './core/envelope.js';
import { ToilError } from './core/errors.js';
import { createSecretStore, type SecretStore } from './core/keychain.js';
import type { ProgressEvent } from './core/progress.js';
import { runCommand } from './core/run.js';
import { inputSchemaFor } from './mcp/server.js';
import { createNodeContext } from './node-context.js';
import { areas, commands } from './registry.js';
import { VERSION } from './version.js';
import { documentsFrom, fieldOverrides, inputValues, mapOwi as mapDocuments, OWI_VERSION, parseOwiInput, type OwiResult } from './core/owi/index.js';
import owiSchemaJson from '../docs/owi/schema.json' with { type: 'json' };

export type { ApiAnswer, ContextReport, ContextSource, ContextValue, DossierReport, Envelope, ErrorBody, Meta, Page, Warning } from './core/envelope.js';
export type { ErrorCode } from './core/errors.js';
export type { PageProgress, ProgressEvent, RequestProgress, RetryProgress } from './core/progress.js';
export type { CommandKind } from './core/command.js';
export type { Body, Estimate, EstimateUnit, FieldOverrides, History, Iteration, IterationChange, Link, LinkType, OrphanHistory, OwiResult, OwiSkipped, Person, StatusCategory, Transition, Unmapped, WorkItem, WorkItemType } from './core/owi/index.js';

/** This toil's version, as `toil version` and every envelope's `meta.version` report it. */
export const version: string = VERSION;

/**
 * The command contract's version, as on every envelope's `meta.contractVersion`.
 * A host built against version N works with any toil that reports N; refuse
 * any other with a fix that names the toil to install. It goes up only with a
 * breaking change to the contract (docs/command-contract.md).
 */
export const contractVersion: number = CONTRACT_VERSION;

/** One command `execute()` can run. */
export interface CommandInfo {
  /** What `execute()` takes and `meta.command` reports: `jira search`. */
  name: string;
  /** Its MCP tool name: `jira_search`. */
  tool: string;
  path: readonly string[];
  /** The area it belongs to, or its group for core commands (`connections`). */
  area: string;
  kind: CommandKind;
  description: string;
  /** Every call writes: refused under `readOnly`, and gated by `writes` plus `allowWrite` otherwise. */
  writes: boolean;
  /** Every call changes something on this machine (toil's config or dossiers, a download): refused under `readOnly`. */
  writesLocal: boolean;
  /** Some calls write, depending on the input (the raw passthrough's POST, a file named with `out`); those are refused under `readOnly`. */
  writesDependOnInput: boolean;
  /** The JSON Schema of its input, strict, as MCP advertises it, `select` included. */
  inputSchema: Record<string, unknown>;
}

/** One area toil has. */
export interface AreaSummary {
  name: string;
  description: string;
}

/**
 * The commands and areas this toil has. `commands` is what `execute()`
 * serves: every command MCP would serve with every area set up. The CLI-only
 * ones (they prompt on a terminal, or change connections) and deletes are a
 * person's, on the CLI, and aren't here.
 */
export interface Registry {
  readonly areas: readonly AreaSummary[];
  readonly commands: readonly CommandInfo[];
}

/** Options for one call. More fields may be added; none will change meaning. */
export interface ExecuteOptions {
  /**
   * Refuse the call, before anything resolves or is sent, if it would change
   * anything: a write to a service, or on this machine (toil's config or
   * dossiers, a download, a file named with `out`). The refusal is
   * `WRITE_DISABLED`, whatever the config says. A read-only call writes
   * nothing but its audit line.
   */
  readOnly?: boolean;
  /**
   * Who is calling, recorded as `caller` on the call's audit line beside
   * `via: "api"`: lowercase letters, digits, `.`, `_` and `-`, up to 64
   * characters, starting with a letter or digit (`toil-ui`).
   */
  caller?: string;
  /** Cancels the call; the envelope is then `CANCELLED`. */
  signal?: AbortSignal;
  /**
   * Hears progress while the call runs: every request (redacted URL, status,
   * time), every page a listing reads, every 429 retry and how long it waits.
   * It never changes the envelope. One that throws stops hearing for that
   * call, and the envelope warns `PROGRESS_LISTENER_FAILED`.
   */
  onProgress?: (event: ProgressEvent) => void;
  /** Another config file instead of `~/.toil/config.json`, as `--config` names one. */
  config?: string;
  /** The folder file commands may read and write in, as `--workspace`; else TOIL_WORKSPACE, else the working directory. */
  workspace?: string;
  /** Add every request to `meta.requests`, as `--verbose` does. */
  verbose?: boolean;
}

const served: AnyCommand[] = commands.filter(servedOverMcp);
const byName = new Map(served.map((def) => [commandName(def), def]));
const areaInfo: AreaInfo[] = areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks, contextInputs: Object.keys(a.context) }));

let listed: CommandInfo[] | undefined;
/** Built on first read: a JSON Schema for every command takes a moment, and most hosts look once. */
export const registry: Registry = {
  areas: areas.map((a) => ({ name: a.name, description: a.description })),
  get commands() {
    listed ??= served.map((def) => ({
      name: commandName(def),
      tool: toolName(def),
      path: [...def.path],
      area: def.path[0],
      kind: def.kind ?? 'area',
      description: def.description,
      writes: def.writes,
      writesLocal: def.writesLocal === true,
      writesDependOnInput: def.writesWhen !== undefined || def.writesLocalWhen !== undefined,
      inputSchema: inputSchemaFor(def),
    }));
    return listed;
  },
};

// Nothing is spawned until a `keychain:` reference is actually read.
let secrets: SecretStore | undefined;

/**
 * Runs one command, as `toil <name>` would, and returns its envelope. Never
 * throws: an unknown command, a bad option or a failure inside is an envelope
 * with `ok: false`, like every other. `input` is the command's MCP fields
 * (`{ jql: "project = PAY", maxResults: 50 }`), checked strictly.
 */
export async function execute(command: string, input: Record<string, unknown> = {}, options: ExecuteOptions = {}): Promise<Envelope> {
  const refuse = (message: string, fix: string): Envelope => failure(new ToilError('INVALID_INPUT', message, { fix }), { command, durationMs: 0, version: VERSION });
  const def = byName.get(command);
  if (!def) {
    const known = commands.find((d) => commandName(d) === command);
    return known
      ? refuse(`${command} isn't served through the API: it's a person's command, on the CLI.`, `Run toil ${command} in a terminal.`)
      : refuse(`toil has no command ${JSON.stringify(command)}.`, 'Use a name from registry.commands, such as "version" or "jira search".');
  }
  if (options.caller !== undefined && (typeof options.caller !== 'string' || !CALLER_LABEL.test(options.caller))) {
    return refuse(`caller must be a short name such as "toil-ui", not ${JSON.stringify(options.caller)}.`, 'Use lowercase letters, digits, ".", "_" and "-", up to 64 characters, starting with a letter or digit.');
  }
  secrets ??= createSecretStore();
  const signal = options.signal ?? new AbortController().signal;
  const context = (d: AnyCommand) =>
    createNodeContext({
      globals: { config: options.config, workspace: options.workspace, verbose: options.verbose === true },
      def: d,
      signal,
      // A program's stdin isn't toil's to read, so `-` refuses, as over MCP; the working directory is still the workspace.
      stdin: false,
      door: 'api',
      env: process.env,
      cwd: process.cwd(),
      home: homedir(),
      areas: areaInfo,
      version: VERSION,
      stderr: (text) => process.stderr.write(text),
      secrets,
      ...(options.onProgress ? { progress: options.onProgress } : {}),
    });
  return runCommand(def, input, context, VERSION, 'api', { targets: served }, { ...(options.readOnly ? { readOnly: true } : {}), ...(options.caller ? { caller: options.caller } : {}) });
}


/**
 * The Open Work Item mappers (docs/owi/spec.md), for a host that already
 * holds envelopes: the same mapping `util owi map` does, in-process and
 * synchronous. `input` is envelopes (one, an array, or JSON or JSON Lines
 * text), or a command's bare `data` with `command` named; `fields` is a
 * dossier section's `fields` object (`{ estimate: "customfield_10234",
 * estimateUnit: "points" }`). It doesn't validate against the schema the way
 * `execute('util owi map', …)` does, which runs the check in a worker; use
 * that, or `owiSchema`, to check. Refusals (an override OWI has no field for,
 * output it can't map) throw a ToilError with a fix.
 */
export function mapOwi(input: unknown, options: OwiMapOptions = {}): OwiResult {
  const values = typeof input === 'string' ? parseOwiInput(input) : inputValues(input);
  const { documents, skipped } = documentsFrom(values, { command: options.command, key: options.key });
  return mapDocuments(documents, { fields: fieldOverrides(options.fields), skipped });
}

export interface OwiMapOptions {
  /** OWI fields pointed at a team's own fields: a dossier section's `fields`, or `name=field` strings. */
  fields?: Record<string, string> | string[];
  /** The command whose bare `data` the input is (`jira search`). */
  command?: string;
  /** The item a keyless history (`jira get-changelog`, `github issue-events`) belongs to. */
  key?: string;
}

/** The OWI version this toil writes, as every item's `owi` says. */
export const owiVersion: string = OWI_VERSION;

/** docs/owi/schema.json, the JSON Schema (2020-12) every OWI item validates against. */
export const owiSchema: Record<string, unknown> = owiSchemaJson as Record<string, unknown>;
