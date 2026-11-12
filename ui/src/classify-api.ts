/**
 * The Classify view's seam (#566): what the page reads from the person's
 * classification ledger and asks for, the same whoever answers. The local
 * server answers through toil's own `classify` commands (ui/server/classify.ts);
 * the site preview and `toil-ui --sample` answer from a small scripted ledger
 * (src/fixtures/classify.ts) and write nothing.
 *
 * Nothing here is a write path of its own. A correction is `classify correct`
 * on a press, a plan is `classify run`, and a tracker is changed only by the
 * tracker's own `categorize` command, behind the connection's `writes` and the
 * call's `allowWrite`, after the person has read every change on an approval
 * card. The AI agent has no tool here: it returns answers, which the page shows
 * as proposals, and a person accepts them one at a time or all at once. The
 * only thing the agent has ever been trusted with in a spreadsheet is the
 * column it was told to leave alone.
 */

import type { AgentVerdict, ClassifyArea, Scheme } from '../../src/core/classify/types.ts';
import type { ClassifyStats } from '../../src/core/classify/ledger-types.ts';
import type { WorkItem } from './toil.ts';
import type { Say } from './model/classify.ts';

export type { ClassifyStats };

/** Where the scheme is kept, in words: never a path. `beside` is a file next to the toil project's own file. */
export type SchemeKept = 'built-in' | 'yours' | 'shared' | 'beside';

/** What the ledger says now: the scheme toil resolved, how it has been doing, and each item's last say. */
export interface LedgerView {
  scheme: Scheme;
  kept: SchemeKept;
  /** null where the figures could not be read: not read yet, never zero. */
  stats: ClassifyStats | null;
  standing: Record<string, Say>;
  /** Plain-words notes: what could not be read, and why. */
  notes: string[];
}

/** The AI agents that can be asked, as the page lists them; none when no agent is set up. */
export interface AgentChoice {
  name: string;
  label: string;
  ready: boolean;
  problem: string | null;
}

/** What the agent answered for the items it was asked about, after every id and category was checked. */
export interface AgentAnswers {
  by: string;
  answers: AgentVerdict[];
  /** Items the answer was cut short on: more were unsure than one prompt holds. */
  omitted: number;
  /** What the checks found, in words. */
  warnings: string[];
}

/** One item's change on the approval card: the label and the field, from and to. */
export interface PlanChange {
  id: string;
  key: string;
  title: string;
  category: string;
  /** The scheme's labels the item carries now, which come off. */
  labelsFrom: string[];
  labelsAdd: string[];
  labelsRemove: string[];
  /** The field the project names for this tracker, and what it is set to; null where the project names none. */
  field: { name: string; from: string | null | undefined; to: string } | null;
}

/** One tracker connection's share of a plan: one `categorize` call. */
export interface PlanGroupView {
  area: ClassifyArea;
  connection: string;
  changes: PlanChange[];
  /** The one command that applies it, for the approval card: the one place a command line is shown. */
  command: { name: string; input: Record<string, unknown> };
  /** Whether the connection's `writes` is on; null where it could not be read. */
  writes: boolean | null;
}

export interface ApplyPlan {
  /** Names this plan for Apply: what is written is exactly the plan the card showed. The server keeps the plan a short while. */
  id: string;
  groups: PlanGroupView[];
  /** What the plan leaves out and why, in words. */
  notes: string[];
}

/** What one connection's `categorize` did, item by item. */
export interface ApplyOutcome {
  connection: string;
  changed: Array<{ key: string; text: string }>;
  unchanged: string[];
  failed: Array<{ key: string; reason: string }>;
  /** Set where the call was refused as a whole, with toil's own words. */
  refused: string | null;
}

export interface ApplyResult {
  outcomes: ApplyOutcome[];
  /** The ledger now knows these verdicts (`classify run --record`), or why it could not be told. */
  recorded: { ok: true } | { ok: false; message: string };
}

/** What the agent proposed for a scheme, and how it scored, before anything is changed. */
export interface TuneResult {
  /** Names the revision for Apply; the server keeps the file, the page never sees a path. */
  id: string;
  by: string;
  before: Scheme;
  after: Scheme;
  /** Plain lines: what was added, removed or changed. */
  changes: string[];
  backtest: {
    heldBack: number;
    before: { agreed: number; agreement: number | null };
    after: { agreed: number; agreement: number | null };
    worse: boolean;
  } | null;
  warnings: string[];
}

export interface SaveResult {
  revision: number;
  /** How it was kept, in words. */
  kept: SchemeKept;
  /** Set when the toil project does not read the scheme just saved (it names none, so it uses the built-in one): the name to point it at. */
  pointProject?: string;
  warnings: string[];
}

export interface ClassifyApi {
  /** Why nothing here can write (the sample), or null. */
  readonly disabled: string | null;
  ledger(toilProject: string): Promise<LedgerView>;
  /** Tells the ledger what these items' verdicts are now, so a confirmation counts as agreement (`classify run --record`). */
  record(toilProject: string, items: WorkItem[]): Promise<void>;
  /**
   * Records a person's word on one item: first what its verdict is now (so a confirmation counts as agreement, which needs
   * a verdict to confirm), then the correction itself. `to` null takes the category back to unsure. Changes nothing in a tracker.
   */
  correct(toilProject: string, change: { item: WorkItem; context: WorkItem[]; to: string | null; reason: string }): Promise<void>;
  /** The adapters the agent can be asked on; empty with none. */
  agents(): Promise<AgentChoice[]>;
  ask(toilProject: string, items: WorkItem[], adapter?: string): Promise<AgentAnswers>;
  plan(toilProject: string, work: ApplyWork): Promise<ApplyPlan>;
  /** Applies exactly the plan `plan` returned under this id; an id the server no longer keeps is refused. */
  apply(toilProject: string, planId: string): Promise<ApplyResult>;
  tune(toilProject: string, items: WorkItem[], adapter?: string): Promise<TuneResult>;
  applyRevision(id: string): Promise<SaveResult>;
  saveScheme(toilProject: string, scheme: Scheme): Promise<SaveResult>;
}

/** The decided items an Apply reads: the items themselves. What was decided is in the person's ledger, the AI agent's accepted suggestions included. */
export interface ApplyWork {
  items: WorkItem[];
}

/** The plain refusal in a sample: it can show every step and write none. */
export const SAMPLE_CANNOT_WRITE = "This is sample data, so nothing here can be written. Everything you see is what would happen with your own work.";
