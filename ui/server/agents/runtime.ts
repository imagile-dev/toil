/**
 * What the three adapters share (#251). An adapter is a `Runtime`: the SDK
 * package it loads, the CLI it starts, and one `run` that sends the system
 * prompt, the question and the tools, streams the text back and returns the
 * final answer. Everything else lives here once: loading the SDK with a
 * dynamic import (it's an optional peer dependency, so it may not be there),
 * finding the CLI, building the dossier's read-only tools and their ledger,
 * streaming, and the checks in answer.ts. Three plugs, one socket.
 */

import type { ContextUse, PremiumQuota, UsageRecord } from '../../src/model-usage.ts';
import { AgentError, findCli } from './cli.ts';
import type { ToolSpec } from './tools.ts';

export type AdapterName = 'claude' | 'copilot' | 'codex';

/** Loads a module by name: `import()`, or a stub in the tests. */
export type Importer = (specifier: string) => Promise<unknown>;

/** Tools served over loopback HTTP as an MCP server, for an SDK that takes tools only that way (Codex). */
export interface ServedTools {
  url: string;
  /** A bearer token good for this one run; it goes to the CLI in its environment, never on its command line. */
  token: string;
  close(): void;
}
export type ServeTools = (tools: ToolSpec[]) => ServedTools;

export interface RunRequest {
  system: string;
  prompt: string;
  tools: ToolSpec[];
  model: string | null;
  /** The CLI to start, as findCli found it. */
  cli: string;
  /** An empty folder of Toil UI's own to run in, so the CLI picks up no project's files. */
  workDir: string;
  /** Toil UI's data folder, where an adapter may keep the CLI's own home (Codex, codex.ts). */
  dataDir: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  /** The answer's text so far: the whole of it each time, not a delta. */
  onText(text: string): void;
  serveTools: ServeTools;
  /** Settings that only one adapter reads (Claude's endpoint). */
  endpoint: Endpoint | null;
  importer: Importer;
  usage: UsageSink;
  /** Unique to this run: part of a usage report's id where the SDK gives the call none of its own. */
  runId: string;
}

export type Endpoint = 'anthropic' | 'bedrock' | 'foundry' | 'vertex';

/** One usage report in the SDK's own figures; the host adds the chat, turn, dossier, adapter and time (#295). */
export type UsageReport = Omit<UsageRecord, 'chatId' | 'turn' | 'dossier' | 'adapter' | 'at'>;

/** Where an adapter sends what its SDK reports about usage, as it reports it (#295). */
export interface UsageSink {
  /** Every report of this run so far, replacing what the adapter sent before. */
  report(records: UsageReport[]): void;
  /** How full the model's context is, where the SDK says. */
  context(c: ContextUse): void;
  /** Copilot: the premium requests left, from the SDK's experimental quota call. */
  quota(q: PremiumQuota): void;
}

export interface Runtime {
  name: AdapterName;
  /** How the UI names it. */
  label: string;
  /** The SDK's npm name, loaded only if installed. */
  package: string;
  /** The CLI on PATH: `claude`, `copilot`, `codex`. */
  command: string;
  /** The CLI's own name, for messages. */
  cliLabel: string;
  /** Its SDK reports usage only once a turn is over (Codex), so a cap can't stop a run partway: it refuses the next question. */
  usageAtEnd?: boolean;
  /** Sends one question; resolves with the final answer's text. */
  run(sdk: unknown, request: RunRequest): Promise<string>;
}

const missing = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find (module|package)/.test(String((e as Error | undefined)?.message));
};

/** The SDK module, or an AgentError naming the package to install. */
export async function loadSdk(runtime: Pick<Runtime, 'label' | 'package'>, importer: Importer): Promise<unknown> {
  try {
    return await importer(runtime.package);
  } catch (e) {
    if (missing(e)) {
      throw new AgentError(
        `The ${runtime.label} adapter needs ${runtime.package}, which isn't installed beside Toil UI.`,
        `If your organization approves it, install it where toil-ui is installed (npm install -g ${runtime.package} beside a global toil-ui), then ask again; or choose another adapter in Settings.`,
      );
    }
    throw new AgentError(`${runtime.package} is installed but failed to load: ${e instanceof Error ? e.message : String(e)}`, `Reinstall ${runtime.package}, or choose another adapter in Settings.`);
  }
}

/** The CLI for a runtime: the configured path, else PATH. */
export function cliFor(runtime: Pick<Runtime, 'cliLabel' | 'command'>, configured: string | null, env: Record<string, string | undefined>, platform: NodeJS.Platform, isFile?: (p: string) => boolean, cwd?: string): string {
  return findCli({ label: runtime.cliLabel, command: runtime.command, configured: configured ?? undefined, env, platform, ...(isFile ? { isFile } : {}), ...(cwd ? { cwd } : {}) });
}

/** The real importer. The specifier is a variable, so the bundler leaves the import for Node to resolve at run time. */
export const nodeImporter: Importer = (specifier) => import(/* @vite-ignore */ specifier);

/**
 * A callback-fed async iterable: the adapters push text as the SDK streams
 * it, and the agent yields each value. The last pushed value wins when the
 * reader falls behind, since each value is the whole answer so far.
 */
export class Latest<T> implements AsyncIterable<T> {
  private value: { v: T } | null = null;
  private done = false;
  private error: unknown = null;
  private wake: (() => void) | null = null;
  push(v: T) {
    this.value = { v };
    this.wake?.();
  }
  end(error?: unknown) {
    this.done = true;
    if (error !== undefined) this.error = error;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.value) {
        const { v } = this.value;
        this.value = null;
        yield v;
        continue;
      }
      if (this.done) {
        if (this.error !== null) throw this.error;
        return;
      }
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}
