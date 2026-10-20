/**
 * The agent the server runs (#251): one `Agent` that answers through the
 * adapter chosen in Settings (Claude, Copilot or Codex), or through the
 * fallback (`noAgent`, which names the three) when none is chosen. It also
 * reports which SDKs and CLIs are on this machine for the Settings page, and
 * saves the choice to `~/.toil-ui/agent.json`.
 *
 * Every question runs with the dossier's read-only tools and a fresh ledger,
 * streams its text, and ends with answer.ts's checks: citations held to the
 * tool results, writes turned into proposals the pane shows and nobody here
 * runs. Each question is recorded as an agent run (#308) as it starts and
 * again as it ends, finished, failed or stopped, with its answer and
 * proposals, for the worklog. A switchboard with three lines and no outgoing
 * calls.
 *
 * Usage (#295): every adapter hands what its SDK reports to a sink here,
 * which stamps each report with the chat, turn, dossier and time, prices
 * Codex's from the person's rates, and holds it against the caps as it
 * arrives: a cap already reached refuses the question, and one passed during
 * a run stops it cleanly. Whatever the outcome, the run's records go to the
 * ledger before the answer or the error does, and the answer carries them.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Answer, Starter } from '../../src/agent.ts';
import { runFromAnswer, type AgentRun } from '../../src/model/worklog.ts';
import { capStandings, capStop, capWarning, codexCost, UsageSettingsError, WARN_AT, type AnswerUsage, type CapStanding, type ChatTurn, type UsageRecord } from '../../src/model-usage.ts';
import type { Execute } from '../../src/toil.ts';
import type { Agent } from '../agent.ts';
import type { RequestContext } from '../context.ts';
import { finish, partial, writeCommands, type WriteCommand } from './answer.ts';
import { claudeRuntime } from './claude.ts';
import { AgentError } from './cli.ts';
import { codexRuntime } from './codex.ts';
import { copilotRuntime } from './copilot.ts';
import { promptFor, STARTERS, systemPrompt } from './prompts.ts';
import { agentEnv } from './env.ts';
import { cliFor, Latest, loadSdk, nodeImporter, type AdapterName, type Importer, type Runtime, type ServeTools, type UsageReport } from './runtime.ts';
import { loadUsageSettings, memoryLedger, type UsageLedger } from '../usage.ts';
import { checkAgentSettings, loadAgentSettings, saveAgentSettings, DEFAULT_AGENT_SETTINGS, ENDPOINTS, type AgentSettings } from './settings.ts';
import { promptStyle, type StyleChoice } from './voices.ts';
import { cacheTools, dossierReader, Ledger, liveTools, peopleTools, proposalTool, prTools, recorded, standupTool, worklogTool, type AgentData, type MapIds, type ReadCommand, type ToolSpec } from './tools.ts';

export interface AgentHostOptions {
  dataDir: string;
  /** Toil UI's version, for the SDKs' client labels. */
  version: string;
  /** The dossier's synced rows, or null when it has never synced. */
  data(dossier: string): AgentData | null;
  /** toil's registry: the live tools come from its reads, the proposals' commands from its writes. */
  registry: readonly ReadCommand[];
  execute: Execute;
  mapIds: MapIds;
  serveTools: ServeTools;
  /** What answers when no adapter is chosen. */
  fallback: Agent;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  importer?: Importer;
  /** Whether a package resolves from here, without loading it. */
  installed?: (specifier: string) => boolean;
  isFile?: (path: string) => boolean;
  /** The working directory, which a PATH search skips; process.cwd() by default. */
  cwd?: string;
  runtimes?: Runtime[];
  now?: () => string;
  /**
   * Each question, as an agent run (#308): once as it starts and once as it
   * ends. The worklog keeps it. A failure here is never the question's.
   */
  onRun?: (run: AgentRun) => Promise<void> | void;
  /** Where usage records go (#295): the cache's ledger, or one in memory. */
  ledger?: UsageLedger;
}

/** What the Settings page shows about one adapter on this machine. */
export interface AdapterStatus {
  name: AdapterName;
  label: string;
  package: string;
  /** The SDK resolves beside Toil UI. */
  installed: boolean;
  /** The CLI this adapter would start, or why there is none. */
  cli: { path: string | null; problem: string | null; fix: string | null };
  /** Claude only: the endpoints it can be pointed at. */
  endpoints: readonly string[];
}

export interface AgentStatus {
  settings: AgentSettings;
  /** Why the saved settings couldn't be read, if they couldn't. */
  problem: string | null;
  adapters: AdapterStatus[];
  /** What answers now: an adapter's name, or the fallback's kind. */
  kind: string;
}

/** How many questions may run at once (Bounds): each one starts a CLI. */
export const MAX_RUNS = 2;

const defaultInstalled = (specifier: string) => {
  try {
    import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
};

export class AgentHost implements Agent {
  private settings: AgentSettings;
  private problem: string | null = null;
  private running = 0;
  /** How many questions are running now. */
  get active(): number {
    return this.running;
  }
  private readonly runtimes: Runtime[];
  private readonly writes: Map<string, WriteCommand>;
  /** The usage ledger (#295). */
  readonly ledger: UsageLedger;

  constructor(private readonly o: AgentHostOptions) {
    this.runtimes = o.runtimes ?? [claudeRuntime(o.version), copilotRuntime(), codexRuntime()];
    this.ledger = o.ledger ?? memoryLedger();
    this.writes = writeCommands(o.registry);
    try {
      this.settings = loadAgentSettings(o.dataDir);
    } catch (e) {
      this.settings = { ...DEFAULT_AGENT_SETTINGS };
      this.problem = e instanceof AgentError ? `${e.message} ${e.fix}` : String(e);
    }
  }

  private runtime(): Runtime | null {
    return this.runtimes.find((r) => r.name === this.settings.adapter) ?? null;
  }

  get kind(): string {
    return this.runtime()?.name ?? this.o.fallback.kind;
  }

  async starters(ctx: RequestContext, dossier: string): Promise<Starter[]> {
    if (!this.runtime()) return this.o.fallback.starters(ctx, dossier);
    return STARTERS.map(({ id, label }) => ({ id, label }));
  }

  async ask(ctx: RequestContext, dossier: string, prompt: string, style: StyleChoice | null = null, chat?: ChatTurn): Promise<Answer> {
    let last: Answer | undefined;
    for await (const a of this.stream(ctx, dossier, prompt, style, chat)) last = a;
    if (!last) throw new AgentError('The agent ended without an answer.', 'Ask again.');
    return last;
  }

  /** The tools a question about this dossier gets, and the ledger they fill: what every adapter is handed. */
  tools(dossier: string, data: AgentData, ledger: Ledger): ToolSpec[] {
    const now = this.o.now ?? (() => new Date().toISOString());
    return recorded([...cacheTools(dossier, data, ledger), ...prTools(dossier, data, ledger), ...peopleTools(dossier, data, ledger, dossierReader(this.o.execute, dossier)), ...worklogTool(dossier, data, ledger, now), ...standupTool(dossier, data, ledger, now), proposalTool(this.o.registry), ...liveTools(dossier, this.o.registry, this.o.execute, this.o.mapIds, ledger)], ledger);
  }

  /**
   * The system prompt a question about this dossier gets now, in this style:
   * what every adapter is handed, for Settings' "Show the full prompt" (#283).
   */
  systemPrompt(dossier: string, style: StyleChoice | null): string {
    return systemPrompt(dossier, (this.o.now ?? (() => new Date().toISOString()))(), promptStyle(style, this.settings));
  }

  private clock(): string {
    return (this.o.now ?? (() => new Date().toISOString()))();
  }

  /**
   * The caps that apply to this adapter, against the chat's records and
   * today's (UTC) plus a run's own. A usage file that can't be read refuses
   * the question: a broken cap is never read as no cap.
   */
  private standings(adapter: AdapterName, chatId: string, run: readonly UsageRecord[]): CapStanding[] {
    let settings;
    try {
      settings = loadUsageSettings(this.o.dataDir);
    } catch (e) {
      if (e instanceof UsageSettingsError) throw new AgentError(e.message, e.fix);
      throw e;
    }
    const day = `${this.clock().slice(0, 10)}T00:00:00.000Z`;
    return capStandings(settings, adapter, [...this.ledger.chat(chatId), ...run], [...this.ledger.since(day), ...run]);
  }

  async *stream(ctx: RequestContext, dossier: string, prompt: string, style: StyleChoice | null = null, chat?: ChatTurn): AsyncIterable<Answer> {
    const runtime = this.runtime();
    if (!runtime) {
      yield await this.o.fallback.ask(ctx, dossier, prompt, style);
      return;
    }
    if (this.running >= MAX_RUNS) throw new AgentError(`${MAX_RUNS} questions are already running.`, 'Wait for an answer, then ask again.');
    // Counted from here, before anything can await, and given back in the finally whatever fails: the SDK load, the CLI search, the run.
    this.running++;
    let run: Promise<void> | undefined;
    const now = this.o.now ?? (() => new Date().toISOString());
    const asked = promptFor(dossier, prompt).label;
    let record: AgentRun = {
      id: randomUUID(), kind: 'ask', dossier, startedAt: now(), finishedAt: null, outcome: 'running',
      by: this.settings.model ? `${runtime.label} (${this.settings.model})` : runtime.label, prompt: asked, answer: null, error: null, citations: [], unverified: [], proposals: [],
    };
    const report = async () => {
      try {
        await this.o.onRun?.(record);
      } catch {
        // The worklog's record of a question never fails the question.
      }
    };
    await report();
    let last: Answer | undefined;
    let capHit = false;
    try {
      const data = this.o.data(dossier);
      if (!data) throw new AgentError(`Toil UI hasn't synced ${dossier} yet, so the agent has nothing to read.`, 'Press Sync now in the Sync panel, then ask again.');
      const importer = this.o.importer ?? nodeImporter;
      const env = this.o.env ?? process.env;
      const sdk = await loadSdk(runtime, importer);
      const cli = cliFor(runtime, this.settings.cliPath, env, this.o.platform ?? process.platform, this.o.isFile, this.o.cwd);

      // A question with no chat (an API caller) is a chat of its own.
      const turn: ChatTurn = chat ?? { id: `ask-${randomUUID()}`, turn: 1 };
      const reached = this.standings(runtime.name, turn.id, []).find((c) => c.share >= 1);
      if (reached) {
        capHit = true;
        const { message, fix } = capStop(reached);
        throw new AgentError(message, fix);
      }
      const rates = runtime.name === 'codex' ? this.usageRates() : null;
      let records: UsageRecord[] = [];
      const extra: Pick<AnswerUsage, 'context' | 'quota'> = {};
      let stopped: CapStanding | null = null;
      // The run stops on the page's cancel or at a cap, whichever comes first.
      const controller = new AbortController();
      const cancel = () => controller.abort(ctx.signal.reason);
      if (ctx.signal.aborted) cancel();
      else ctx.signal.addEventListener('abort', cancel, { once: true });
      const stamp = (r: UsageReport): UsageRecord => {
        const record: UsageRecord = { ...r, chatId: turn.id, turn: turn.turn, dossier, adapter: runtime.name, at: this.clock() };
        const cost = rates ? codexCost(record, rates) : undefined;
        return cost === undefined ? record : { ...record, costUsd: cost, costSource: 'your-rates' };
      };
      const usage = {
        report: (reports: UsageReport[]) => {
          records = reports.map(stamp);
          if (stopped || runtime.usageAtEnd) return;
          stopped = this.standings(runtime.name, turn.id, records).find((c) => c.share >= 1) ?? null;
          if (stopped) controller.abort(new Error('cap'));
        },
        context: (c: NonNullable<AnswerUsage['context']>) => void (extra.context = c),
        quota: (q: NonNullable<AnswerUsage['quota']>) => void (extra.quota = q),
      };
      // Before the answer or the error leaves: whatever the run used is in the ledger, and the answer says so.
      const settle = (): AnswerUsage => {
        this.ledger.add(records);
        let notices: string[];
        try {
          notices = this.standings(runtime.name, turn.id, []).filter((c) => c.share >= WARN_AT).map(capWarning);
        } catch (e) {
          notices = [e instanceof Error ? e.message : String(e)];
        }
        return { adapter: runtime.name, records, notices, ...extra };
      };

      const ledger = new Ledger();
      const tools = this.tools(dossier, data, ledger);
      const { label, text } = promptFor(dossier, prompt);
      const by = this.settings.model ? `${runtime.label} (${this.settings.model})` : runtime.label;
      const workDir = join(this.o.dataDir, 'agent');
      mkdirSync(workDir, { recursive: true, mode: 0o700 });

      const out = new Latest<Answer>();
      run = runtime
        .run(sdk, {
          // The rules, then the theme's voice or the person's own, then their instructions (prompts.ts): the same for all three adapters.
          system: this.systemPrompt(dossier, style),
          prompt: text,
          tools,
          model: this.settings.model,
          cli,
          workDir,
          dataDir: this.o.dataDir,
          // Only what this CLI needs: never toil's variables, GITHUB_TOKEN or CI tokens (env.ts).
          env: agentEnv(env, runtime.name),
          signal: controller.signal,
          onText: (t) => out.push(partial(t, { prompt: label, by })),
          serveTools: this.o.serveTools,
          endpoint: runtime.name === 'claude' ? this.settings.endpoint : null,
          importer,
          usage,
          runId: randomUUID(),
        })
        .then(
          (final) => {
            const used = settle();
            const cap = stopped as CapStanding | null;
            // An SDK that finished anyway after the stop still doesn't get past the cap.
            capHit = cap !== null;
            if (cap) return out.end(Object.assign(new AgentError(capStop(cap).message, capStop(cap).fix), { usage: used }));
            out.push({ ...finish(final, { dossier, prompt: label, by, ledger, writes: this.writes }), usage: used });
            out.end();
          },
          (e: unknown) => {
            // The error carries what the run used, so the chat counts it as the ledger just did.
            const used = settle();
            const cap = stopped as CapStanding | null;
            capHit = cap !== null;
            const failure = cap
              ? new AgentError(capStop(cap).message, capStop(cap).fix)
              : e instanceof AgentError
                ? e
                : new AgentError(`${runtime.label} failed: ${e instanceof Error ? e.message : String(e)}`, `Check that ${runtime.cliLabel} is signed in (run ${runtime.command} once on its own), then ask again.`);
            if (used.records.length) failure.usage = used;
            out.end(failure);
          },
        )
        .finally(() => ctx.signal.removeEventListener('abort', cancel));
      for await (const answer of out) {
        last = answer;
        yield answer;
      }
      record = runFromAnswer(record, now(), last ?? { prompt: asked, parts: [], citations: [], by, proposals: [] });
    } catch (e) {
      const message = e instanceof AgentError ? `${e.message} ${e.fix}` : e instanceof Error ? e.message : String(e);
      // A run stopped at a usage cap (#295) is the worklog's `capped`, whether it was refused before it began or stopped partway.
      record = { ...(last ? runFromAnswer(record, now(), last) : { ...record, finishedAt: now() }), outcome: capHit ? 'capped' : ctx.signal.aborted ? 'stopped' : 'failed', error: message };
      throw e;
    } finally {
      await run;
      this.running--;
      // The person closed the pane or the page mid-answer: the run stopped, with what it had said so far.
      if (record.outcome === 'running') record = { ...(last ? runFromAnswer(record, now(), last) : { ...record, finishedAt: now() }), outcome: 'stopped' };
      await report();
    }
  }

  /** The Codex rates the person entered, or null; a broken usage file has already refused the question. */
  private usageRates() {
    try {
      return loadUsageSettings(this.o.dataDir).codexRates;
    } catch {
      return null;
    }
  }

  /** The adapters on this machine and the saved choice, for the Settings page. */
  status(): AgentStatus {
    const installed = this.o.installed ?? defaultInstalled;
    const env = this.o.env ?? process.env;
    const adapters = this.runtimes.map((r): AdapterStatus => {
      let cli: AdapterStatus['cli'];
      try {
        cli = { path: cliFor(r, r.name === this.settings.adapter ? this.settings.cliPath : null, env, this.o.platform ?? process.platform, this.o.isFile, this.o.cwd), problem: null, fix: null };
      } catch (e) {
        cli = { path: null, problem: e instanceof Error ? e.message : String(e), fix: e instanceof AgentError ? e.fix : null };
      }
      return { name: r.name, label: r.label, package: r.package, installed: installed(r.package), cli, endpoints: r.name === 'claude' ? ENDPOINTS : [] };
    });
    return { settings: { ...this.settings }, problem: this.problem, adapters, kind: this.kind };
  }

  /** Checks and saves a new choice; the next question uses it. */
  save(input: unknown): AgentStatus {
    const next = checkAgentSettings(input);
    saveAgentSettings(this.o.dataDir, next);
    this.settings = next;
    this.problem = null;
    return this.status();
  }
}
