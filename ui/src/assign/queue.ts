/**
 * The assignment queue (#293): every assignment's state machine, in one
 * place the server and the preview both run. It knows nothing about SDKs,
 * files or HTTP: a `Runner` does the agent's work, a `Keeper` stores the
 * records, and `apply` runs a proposal's toil command. What it owns:
 *
 * - **States.** `queued` (waiting for a person to press Start, or for a free
 *   slot), `working`, `needs-you` (proposals or questions to review, or an
 *   item that looked like an injection attempt), `done` and `failed`.
 * - **One at a time by default.** Queued assignments start in order as
 *   slots free up (`concurrent` in the settings).
 * - **A time limit per run.** At the limit the run is aborted and the
 *   assignment fails saying so; a usage cap stops it the same way through
 *   the agent's own caps (#295), and says which.
 * - **The tracker only queues.** An item labelled `agent:<mode>` or assigned
 *   to one of the dossier's agents becomes a queued assignment waiting for
 *   Start, which only a person presses (principle 2).
 * - **Events.** Every change is an event with a sequence number, kept for a
 *   while and handed to subscribers: the page's live view and, later, #306's
 *   notifications.
 *
 * A dispatcher with one desk, one stamp, and a firm policy on walk-ins.
 */

import type { AnswerUsage } from '../model-usage.ts';
import type { PersonEntry } from '../model/people.ts';
import type { Proposal } from '../proposal.ts';
import type { Envelope, WorkItem } from '../toil.ts';
import {
  ADAPTERS,
  ADAPTER_NAME,
  MODES,
  MODE_INFO,
  inboxMatch,
  pending,
  proposalDiff,
  runMs,
  settledState,
  type AdapterChoice,
  type AssignAdapter,
  type AssignRequest,
  type AssignSettings,
  type Assignment,
  type AssignmentEvent,
  type AssignmentList,
  type AssignmentRecord,
  type AssignState,
  type Branch,
  type RepoChoice,
  type Report,
  type StartedOn,
  type Stop,
  type TranscriptEntry,
} from './model.ts';

/** A refusal or a failure the page shows as it is: what went wrong, and what to do. */
export class AssignError extends Error {
  constructor(
    message: string,
    readonly fix: string,
    /** The HTTP status the server answers with. */
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Thrown by a runner that stopped short: at a usage cap, on an injection attempt, or failing. */
export class RunStopped extends Error {
  constructor(
    readonly reason: Stop['reason'],
    message: string,
    readonly fix: string | null,
    readonly usage: AnswerUsage | null = null,
  ) {
    super(message);
  }
}

/** What a runner is handed for one run. */
export interface RunContext {
  assignment: Assignment;
  item: WorkItem;
  signal: AbortSignal;
  /** Adds a line to the transcript as the run goes. */
  record(entry: Omit<TranscriptEntry, 'at'>): void;
}

/** What a finished run hands back. */
export interface RunResult {
  report: Report | null;
  proposals: Proposal[];
  questions: string[];
  /** Why the item looks like an injection attempt, when the agent said so and stopped. */
  injection: string | null;
  usage: AnswerUsage | null;
  startedOn: StartedOn;
  branch: Branch | null;
}

export interface Runner {
  adapters(): AdapterChoice[];
  /** The adapter chosen in Settings, which the dialog offers first. */
  preferred(): AssignAdapter | null;
  run(ctx: RunContext): Promise<RunResult>;
}

/** Where records live: files under the cache for the server, memory for the preview and the tests. */
export interface Keeper {
  load(): AssignmentRecord[];
  save(record: AssignmentRecord): void;
}

export interface QueueOptions {
  keeper: Keeper;
  runner: Runner;
  /** The dossier's synced items, or null when it has never synced. */
  items(dossier: string): WorkItem[] | null;
  /** The dossier's people, for the agents an item may be assigned to on the tracker. */
  people(dossier: string): Promise<PersonEntry[]>;
  /** The dossier's repositories with a local path, for implement mode. */
  repos(dossier: string): Promise<RepoChoice[]>;
  /** Runs one proposal's toil command through the write gate, for this assignment. */
  apply(assignment: Assignment, proposal: Proposal): Promise<Envelope>;
  settings(): AssignSettings;
  now(): string;
  newId(): string;
  /**
   * Sample data: an assignment saved as working stays working, holding its
   * slot, so the sample shows the state; anywhere else one is a run Toil UI
   * lost when it stopped.
   */
  sample?: boolean;
  /** Timers, so the tests can run the clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** How many events are kept for a page that reads them from a sequence number. */
export const KEEP_EVENTS = 500;
/** The most a transcript keeps; older lines are dropped and the transcript says so. */
export const MAX_TRANSCRIPT = 2000;

const strip = ({ transcript: _, ...rest }: AssignmentRecord): Assignment => rest;

export class AssignmentQueue {
  private readonly records = new Map<string, AssignmentRecord>();
  private readonly running = new Map<string, AbortController>();
  private readonly listeners = new Set<(e: AssignmentEvent) => void>();
  private readonly events: AssignmentEvent[] = [];
  private seq = 0;
  /** The sample's seeded working assignments: they hold a slot and never run. */
  private readonly held = new Set<string>();

  constructor(private readonly o: QueueOptions) {
    for (const r of o.keeper.load()) {
      // A run that was going when Toil UI stopped didn't finish, and nothing resumes it on its own.
      if (r.state === 'working' && o.sample) {
        this.held.add(r.id);
        this.running.set(r.id, new AbortController());
      } else if (r.state === 'working') {
        r.state = 'failed';
        r.endedAt = o.now();
        r.stop = { reason: 'interrupted', message: 'Toil UI stopped while this assignment was running, so it never finished.', fix: 'Assign the item again.' };
        o.keeper.save(r);
      }
      this.records.set(r.id, r);
    }
    queueMicrotask(() => this.pump());
  }

  /** An assignment without its transcript, with how long it has run by the queue's own clock. */
  private summary(r: AssignmentRecord): Assignment {
    return { ...strip(r), ranMs: runMs(r, this.o.now()) };
  }

  /** Starts whatever the limits now allow: after the settings change. */
  wake() {
    this.pump();
  }

  /** Whether any assignment is running now. */
  get busy(): boolean {
    return this.running.size > 0;
  }

  /** Forgets every assignment, after the cache that held them was wiped. Refused while one runs. */
  wipe() {
    if (this.busy) throw new AssignError('An assignment is running, so the cache stays until it ends.', 'Stop it from its page, or wait for it to finish, then wipe.', 409);
    this.records.clear();
    this.events.length = 0;
  }

  /** Every assignment for a dossier, newest first, after the tracker's inbox is read again. */
  async list(dossier: string): Promise<AssignmentList> {
    await this.inbox(dossier);
    const repos = await this.o.repos(dossier).catch((): RepoChoice[] => []);
    return {
      assignments: [...this.records.values()].filter((r) => r.dossier === dossier).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => this.summary(r)),
      settings: this.o.settings(),
      adapters: this.o.runner.adapters(),
      repos,
      preferred: this.o.runner.preferred(),
    };
  }

  /** Every assignment, in every dossier: the People view and #307 read this. */
  all(): Assignment[] {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => this.summary(r));
  }

  get(id: string): AssignmentRecord {
    const r = this.records.get(id);
    if (!r) throw new AssignError(`There is no assignment ${id}.`, 'Open the Agents lane on the dossier to see its assignments.', 404);
    return { ...structuredClone(r), ranMs: runMs(r, this.o.now()) };
  }

  /** Listens to every event from now on; returns the way to stop. */
  subscribe(listener: (e: AssignmentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The events after a sequence number that are still kept. */
  since(seq: number): AssignmentEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  /**
   * Assigns an item to an agent and queues the run: the server function the
   * Assign dialog and the Command Center (#307) call. It starts as soon as a
   * slot is free.
   */
  async assign(request: AssignRequest): Promise<Assignment> {
    const req = this.check(request);
    const item = this.item(req.dossier, req.item);
    const repo = req.mode === 'implement' ? (await this.repoFor(req.dossier, req.repo)).name : null;
    const record = this.create({ dossier: req.dossier, item, mode: req.mode, adapter: req.adapter, origin: 'person', trigger: null, waiting: 'slot', repo });
    this.pump();
    return this.summary(this.records.get(record.id)!);
  }

  /** Starts a tracker-queued assignment, which waits for this. */
  async start(id: string, adapter?: AssignAdapter): Promise<Assignment> {
    const r = this.mutable(id);
    if (r.state !== 'queued' || r.waiting !== 'start') throw new AssignError(`Assignment ${id} isn't waiting for Start: it is ${r.state}.`, 'Only an assignment the tracker queued waits for a person to start it.', 409);
    const chosen = adapter ?? r.adapter;
    if (!chosen) throw new AssignError('Choose an adapter to start this assignment.', 'Pick Claude, Copilot or Codex in the dialog, then press Start.');
    if (!ADAPTERS.includes(chosen)) throw new AssignError(`${String(chosen)} isn't an adapter.`, 'Choose claude, copilot or codex.');
    this.usable(chosen, r.mode);
    if (r.mode === 'implement') r.repo = (await this.repoFor(r.dossier, r.repo ?? undefined)).name;
    r.adapter = chosen;
    r.waiting = 'slot';
    this.note(r, 'note', `Started from the inbox by a person in Toil UI, on ${ADAPTER_NAME[chosen]}.`);
    this.save(r, 'state', r.state, 'Started by a person; waiting for a free slot.');
    this.pump();
    return this.summary(r);
  }

  /** Stops a run, or takes a queued assignment off the queue. */
  cancel(id: string): Assignment {
    const r = this.mutable(id);
    const run = this.running.get(id);
    if (run && this.held.delete(id)) {
      this.running.delete(id);
      this.end(r, 'failed', { reason: 'cancelled', message: 'Stopped by a person in Toil UI.', fix: null });
      this.pump();
      return this.summary(r);
    }
    if (run) {
      run.abort('cancelled');
      return this.summary(r);
    }
    if (r.state !== 'queued') throw new AssignError(`Assignment ${id} is ${r.state}, so there is nothing to stop.`, 'Only a queued or working assignment can be stopped.', 409);
    this.end(r, 'failed', { reason: 'cancelled', message: 'Taken off the queue by a person before it started.', fix: null });
    return this.summary(r);
  }

  /** Runs one pending proposal through toil's write gate and records what came of it. */
  async apply(id: string, proposalId: string): Promise<Assignment> {
    const r = this.mutable(id);
    const p = r.proposals.find((x) => x.id === proposalId);
    if (!p) throw new AssignError(`Assignment ${id} has no proposal ${proposalId}.`, 'Reload the assignment; its proposals are listed on its page.', 404);
    if (p.status === 'applied') throw new AssignError(`That proposal was applied ${p.outcome?.at ?? 'already'}.`, 'Nothing to do: it is in the tracker.', 409);
    if (p.status === 'dismissed') throw new AssignError('That proposal was dismissed.', 'Assign the item again for a fresh proposal.', 409);
    if (!p.command || !p.input) throw new AssignError("toil has no command for this proposal, so there is nothing to apply here.", p.note ?? 'Make the change by hand.');
    const envelope = await this.o.apply(this.summary(r), p);
    const at = this.o.now();
    p.status = envelope.ok ? 'applied' : 'failed';
    p.outcome = envelope.ok
      ? { at, ok: true, message: `Applied with toil ${p.command}.` }
      : { at, ok: false, message: `${envelope.error.message}${envelope.error.fix ? ` ${envelope.error.fix}` : ''}` };
    this.note(r, 'proposal', `${envelope.ok ? 'Applied' : 'Tried to apply'}: ${p.title}`, p.outcome.message);
    this.settle(r, `${envelope.ok ? 'Applied' : 'Apply failed'}: ${p.title}`);
    return this.summary(r);
  }

  dismiss(id: string, proposalId: string): Assignment {
    const r = this.mutable(id);
    const p = r.proposals.find((x) => x.id === proposalId);
    if (!p) throw new AssignError(`Assignment ${id} has no proposal ${proposalId}.`, 'Reload the assignment; its proposals are listed on its page.', 404);
    if (!pending(p) && p.status !== 'failed') throw new AssignError(`That proposal is ${p.status}.`, 'Only a proposal still waiting can be dismissed.', 409);
    p.status = 'dismissed';
    this.note(r, 'proposal', `Dismissed: ${p.title}`);
    this.settle(r, `Dismissed: ${p.title}`);
    return this.summary(r);
  }

  /** A person has read the questions and the report: done, with any proposal left dismissed. */
  finish(id: string): Assignment {
    const r = this.mutable(id);
    if (r.state !== 'needs-you') throw new AssignError(`Assignment ${id} is ${r.state}, not waiting on you.`, 'Only an assignment that needs you can be marked reviewed.', 409);
    for (const p of r.proposals) if (pending(p)) p.status = 'dismissed';
    r.questions = [];
    this.note(r, 'note', 'Marked reviewed by a person.');
    const previous = r.state;
    r.state = 'done';
    this.save(r, 'state', previous, 'Marked reviewed.');
    return this.summary(r);
  }

  // ---------------------------------------------------------------- inside

  private check(input: AssignRequest): AssignRequest {
    const r = (typeof input === 'object' && input !== null ? input : {}) as Partial<AssignRequest>;
    const shape = 'Send { "dossier": "<name>", "item": "<owi id>", "mode": "refine", "adapter": "codex" }, with "repo" for implement.';
    if (typeof r.dossier !== 'string' || !r.dossier) throw new AssignError('An assignment needs a dossier.', shape);
    if (typeof r.item !== 'string' || !r.item) throw new AssignError('An assignment needs the OWI id of a work item.', shape);
    if (!MODES.includes(r.mode as never)) throw new AssignError(`${JSON.stringify(r.mode)} isn't a mode.`, 'Choose refine, investigate or implement.');
    if (!ADAPTERS.includes(r.adapter as never)) throw new AssignError(`${JSON.stringify(r.adapter)} isn't an adapter.`, 'Choose claude, copilot or codex.');
    if (r.repo !== undefined && (typeof r.repo !== 'string' || !r.repo)) throw new AssignError('repo names one of the dossier\'s repositories.', shape);
    this.usable(r.adapter!, r.mode!);
    return r as AssignRequest;
  }

  /** Refuses an adapter that can't run here, or can't take this mode. */
  private usable(adapter: AssignAdapter, mode: Assignment['mode']) {
    const choice = this.o.runner.adapters().find((a) => a.name === adapter);
    if (choice?.problem) throw new AssignError(choice.problem, 'Set the adapter up under Settings, Agent, or choose another.');
    if (mode === 'implement' && choice?.implement) throw new AssignError(choice.implement, 'Choose an adapter the dialog offers for implement mode, or refine or investigate instead.');
  }

  private item(dossier: string, id: string): WorkItem {
    const items = this.o.items(dossier);
    if (!items) throw new AssignError(`Toil UI hasn't synced ${dossier} yet, so the agent has no item to work on.`, 'Press Sync now in the Sync panel, then assign again.', 409);
    const item = items.find((i) => i.id === id);
    if (!item) throw new AssignError(`${dossier} has no item ${id} in Toil UI's last sync.`, 'Sync the dossier, or pick an item its board shows.', 404);
    return item;
  }

  private async repoFor(dossier: string, name: string | undefined): Promise<RepoChoice> {
    const repos = await this.o.repos(dossier);
    if (!repos.length) throw new AssignError(`${dossier} lists no repository with a local path, so implement mode has nothing to clone.`, `Add one with toil dossiers add-repo ${dossier} <name> --path <folder>, then assign again.`);
    if (name === undefined) {
      if (repos.length === 1) return repos[0]!;
      throw new AssignError(`${dossier} lists ${repos.length} repositories; say which one to work in.`, `Choose one of ${repos.map((r) => r.name).join(', ')}.`);
    }
    const hit = repos.find((r) => r.name === name);
    if (!hit) throw new AssignError(`${dossier} has no repository ${name} with a local path.`, `Choose one of ${repos.map((r) => r.name).join(', ')}.`);
    return hit;
  }

  /** Reads the tracker's own requests for an agent: each new one becomes an assignment waiting for Start. */
  private async inbox(dossier: string) {
    const items = this.o.items(dossier);
    if (!items) return;
    const people = await this.o.people(dossier).catch(() => []);
    const agents = people.filter((p) => p.kind === 'agent');
    const preferred = this.o.runner.preferred();
    for (const item of items) {
      const match = inboxMatch(item, agents);
      if (!match) continue;
      // One per item, mode and trigger, ever: a dismissed or finished one isn't queued again by the same label.
      const seen = [...this.records.values()].some((r) => r.dossier === dossier && r.item === item.id && r.mode === match.mode && r.origin === 'tracker' && r.trigger === match.trigger);
      if (seen) continue;
      this.create({ dossier, item, mode: match.mode, adapter: preferred, origin: 'tracker', trigger: match.trigger, waiting: 'start', repo: null });
    }
  }

  private create(o: Pick<Assignment, 'dossier' | 'mode' | 'adapter' | 'origin' | 'trigger' | 'waiting' | 'repo'> & { item: WorkItem }): AssignmentRecord {
    const at = this.o.now();
    const record: AssignmentRecord = {
      id: this.o.newId(),
      dossier: o.dossier,
      item: o.item.id,
      itemTitle: o.item.title,
      mode: o.mode,
      adapter: o.adapter,
      origin: o.origin,
      trigger: o.trigger,
      state: 'queued',
      waiting: o.waiting,
      repo: o.repo,
      createdAt: at,
      startedAt: null,
      endedAt: null,
      stop: null,
      report: null,
      questions: [],
      proposals: [],
      usage: null,
      startedOn: null,
      branch: null,
      transcript: [],
    };
    const who = o.origin === 'tracker' ? `Queued by the tracker (${o.trigger}); it starts only when a person presses Start.` : `Assigned by a person in Toil UI to ${o.adapter ? ADAPTER_NAME[o.adapter] : 'an agent'}, in ${MODE_INFO[o.mode].label.toLowerCase()} mode.`;
    record.transcript.push({ at, kind: 'note', title: who });
    this.records.set(record.id, record);
    this.save(record, 'created', null, who);
    return record;
  }

  private mutable(id: string): AssignmentRecord {
    const r = this.records.get(id);
    if (!r) throw new AssignError(`There is no assignment ${id}.`, 'Open the Agents lane on the dossier to see its assignments.', 404);
    return r;
  }

  private note(r: AssignmentRecord, kind: TranscriptEntry['kind'], title: string, detail?: string) {
    r.transcript.push({ at: this.o.now(), kind, title, ...(detail !== undefined ? { detail } : {}) });
    if (r.transcript.length > MAX_TRANSCRIPT) r.transcript.splice(1, r.transcript.length - MAX_TRANSCRIPT, { at: this.o.now(), kind: 'note', title: `Earlier lines were dropped: a transcript keeps the first line and the last ${MAX_TRANSCRIPT - 2}.` });
  }

  private save(r: AssignmentRecord, kind: AssignmentEvent['kind'], previous: AssignState | null, message: string) {
    this.o.keeper.save(r);
    const event: AssignmentEvent = { seq: ++this.seq, at: this.o.now(), id: r.id, dossier: r.dossier, item: r.item, kind, state: r.state, previous, message };
    this.events.push(event);
    if (this.events.length > KEEP_EVENTS) this.events.splice(0, this.events.length - KEEP_EVENTS);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A listener that throws loses the event, never the assignment.
      }
    }
  }

  /** After a person acted on a proposal: needs you while anything waits, else done. */
  private settle(r: AssignmentRecord, message: string) {
    const previous = r.state;
    if (r.state === 'needs-you') r.state = settledState(r);
    this.save(r, previous === r.state ? 'proposal' : 'state', previous, message);
  }

  private end(r: AssignmentRecord, state: AssignState, stop: Stop | null) {
    const previous = r.state;
    r.state = state;
    r.waiting = null;
    r.endedAt = this.o.now();
    r.stop = stop;
    if (stop) this.note(r, stop.reason === 'injection' ? 'note' : 'error', stop.message, stop.fix ?? undefined);
    this.save(r, 'state', previous, stop?.message ?? (state === 'needs-you' ? 'Finished: proposals or questions wait on you.' : 'Finished.'));
  }

  /** Starts queued assignments, oldest first, while slots are free. */
  private pump() {
    const { concurrent } = this.o.settings();
    while (this.running.size < concurrent) {
      const next = [...this.records.values()].filter((r) => r.state === 'queued' && r.waiting === 'slot').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) return;
      void this.run(next);
    }
  }

  private async run(r: AssignmentRecord) {
    const controller = new AbortController();
    this.running.set(r.id, controller);
    const { timeLimitMinutes } = this.o.settings();
    const setTimer = this.o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = this.o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const timer = setTimer(() => controller.abort('time'), timeLimitMinutes * 60_000);
    const previous = r.state;
    r.state = 'working';
    r.waiting = null;
    r.startedAt = this.o.now();
    this.note(r, 'note', `Started on ${r.adapter ? ADAPTER_NAME[r.adapter] : 'no adapter'}, with a time limit of ${timeLimitMinutes} minutes.`);
    this.save(r, 'state', previous, 'Working.');
    try {
      const item = this.item(r.dossier, r.item);
      const result = await this.o.runner.run({ assignment: this.summary(r), item, signal: controller.signal, record: (e) => this.note(r, e.kind, e.title, e.detail) });
      if (controller.signal.aborted) throw controller.signal.reason;
      r.report = result.report;
      r.questions = result.questions;
      r.proposals = result.proposals.map((p) => ({ ...p, status: 'pending' as const, diff: proposalDiff(p, item) }));
      r.usage = result.usage;
      r.startedOn = result.startedOn;
      r.branch = result.branch;
      for (const p of r.proposals) this.note(r, 'proposal', `Proposed: ${p.title}`, p.command ? `toil ${p.command} ${JSON.stringify(p.input)}` : (p.note ?? undefined));
      const stop: Stop | null = result.injection ? { reason: 'injection', message: `The agent stopped: the item looks like an attempt to instruct it (${result.injection}).`, fix: 'Read the item yourself before assigning it again.' } : null;
      this.end(r, stop ? 'needs-you' : settledState(r), stop);
    } catch (e) {
      const why = controller.signal.aborted ? controller.signal.reason : null;
      if (e instanceof RunStopped && e.usage) r.usage = e.usage;
      let stop: Stop;
      if (why === 'time') stop = { reason: 'time', message: `Stopped at the time limit of ${timeLimitMinutes} minutes, before the agent finished.`, fix: 'Raise the limit under Settings, Agent, or assign a smaller piece of the item.' };
      else if (why === 'cancelled') stop = { reason: 'cancelled', message: 'Stopped by a person in Toil UI.', fix: null };
      else if (e instanceof RunStopped) stop = { reason: e.reason, message: e.message, fix: e.fix };
      else if (e instanceof AssignError) stop = { reason: 'error', message: e.message, fix: e.fix };
      else stop = { reason: 'error', message: e instanceof Error ? e.message : String(e), fix: null };
      this.end(r, stop.reason === 'injection' ? 'needs-you' : 'failed', stop);
    } finally {
      clearTimer(timer);
      this.running.delete(r.id);
      this.pump();
    }
  }
}
