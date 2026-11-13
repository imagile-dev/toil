/**
 * What the page holds while someone sorts work into categories (#566): the
 * ledger as it was last read (kept in the App, so every view classifies by it),
 * the AI agent's answers waiting to be accepted, and the one line that says what
 * the last change was and offers to take it back. A decision is never held here
 * as a promise to write: a person's word is recorded in their ledger at once (a
 * local write, on a press), and what is waiting for the tracker is worked out
 * each time from the tracker's own labels (model/classify.ts), so a reload loses
 * nothing and Apply can't forget. Accepting the AI agent's suggestion is a
 * person's word like any pick: it is recorded as a correction, with the agent's
 * reason in it, and the item then stands, waits for the tracker and stays
 * settled after Apply exactly as a pick made by hand does.
 *
 * The undo is one more correction, because the ledger is append-only: changing
 * back is recorded as what the item stood at before, and says so ("Changed
 * back"). The ledger remembers every change of mind, and the minutes keep them
 * all, which is why the minutes are never read aloud.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AgentVerdict } from '../../src/core/classify/types.ts';
import { LEDGER_TEXT_MAX } from '../../src/core/classify/ledger-types.ts';
import type { AgentAnswers, ClassifyApi } from './classify-api.ts';
import { useData } from './data.ts';
import { useWorkInsights } from './insights-data.ts';
import { needsAPerson, pendingChanges, TOOK_BACK, type NeedsRow, type PendingRow, type Say } from './model/classify.ts';
import type { WorkItem } from './toil.ts';

/** How a ledger line for an accepted suggestion begins; the agent's reason follows. */
export const ACCEPTED_REASON = "Accepted the AI agent's suggestion: ";

/** What the line under the tabs says about the last change. */
export type ClassifyNotice =
  | { kind: 'changed'; id: string; key: string; to: string; previous: Say | null }
  /** "Accept all": every item it recorded, so one Undo takes them all back. */
  | { kind: 'accepted'; changes: Array<{ id: string; key: string; previous: Say | null }> }
  | { kind: 'reverted'; key: string; count?: number }
  | { kind: 'failed'; message: string };

export interface ClassifyContext {
  api: ClassifyApi | undefined;
  /** Whether the ledger could be read; where it can't, categories still show, but nothing a person said does. */
  ledgerRead: boolean;
  standing: Readonly<Record<string, Say>>;
  /** Items waiting for a person's answer. */
  needs: NeedsRow[];
  /** Decided items the tracker does not yet say so for. */
  pending: PendingRow[];
  /** The AI agent's answers, not yet accepted, by item id. */
  proposals: ReadonlyMap<string, AgentVerdict>;
  setProposals(answers: AgentAnswers['answers']): void;
  /** Records the person's yes to these suggestions, one correction each (the same route a pick takes), stopping at the first that fails; a failure is the notice and the rest stay suggestions. */
  accept(ids: string[]): Promise<void>;
  dismiss(ids: string[]): void;
  /** Records a person's word on an item, then reads the ledger again. Throws with the reason when it can't. */
  reclassify(item: WorkItem, to: string | null, reason: string): Promise<void>;
  notice: ClassifyNotice | null;
  setNotice(notice: ClassifyNotice | null): void;
  undo(): Promise<void>;
  /** Called after an Apply: the tracker now says these, so they are no longer waiting. */
  applied(done: ReadonlyArray<{ id: string; category: string }>): void;
}

const Ctx = createContext<ClassifyContext | null>(null);

const NONE: ClassifyContext = {
  api: undefined,
  ledgerRead: false,
  standing: {},
  needs: [],
  pending: [],
  proposals: new Map(),
  setProposals: () => undefined,
  accept: async () => undefined,
  dismiss: () => undefined,
  reclassify: async () => {
    throw new Error('This view has no ledger to record in.');
  },
  notice: null,
  setNotice: () => undefined,
  undo: async () => undefined,
  applied: () => undefined,
};

/** The Classify state for the toil project on screen. Outside a provider (a view rendered on its own) it is empty and writes nothing. */
export const useClassify = (): ClassifyContext => useContext(Ctx) ?? NONE;

/** The nearest ancestors of an item the page holds, which its verdict can depend on (its parent chain). */
export function ancestorsOf(item: WorkItem, byId: ReadonlyMap<string, WorkItem>): WorkItem[] {
  const out: WorkItem[] = [];
  const seen = new Set<string>([item.id]);
  for (let next = item.parent; next && !seen.has(next); ) {
    seen.add(next);
    const found = byId.get(next);
    if (!found) break;
    out.push(found);
    next = found.parent;
  }
  return out;
}

export function ClassifyProvider({ children }: { children: ReactNode }) {
  const { toilProject, byId, classification } = useData();
  const ins = useWorkInsights();
  const api = classification?.api;
  const standing = useMemo(() => classification?.view?.standing ?? {}, [classification]);
  const scheme = classification?.view?.scheme ?? null;
  const [proposed, setProposed] = useState<ReadonlyMap<string, AgentVerdict>>(new Map());
  const [notice, setNotice] = useState<ClassifyNotice | null>(null);
  // What an Apply wrote this session, by item: stands for the tracker until a sync reads it back.
  const [writtenNow, setWrittenNow] = useState<ReadonlyMap<string, string>>(new Map());

  const needs = useMemo(() => (scheme ? needsAPerson(ins.items, scheme, standing) : []), [ins.items, scheme, standing]);
  const pending = useMemo(() => (scheme ? pendingChanges(ins.items, scheme, standing, {}, writtenNow) : []), [ins.items, scheme, standing, writtenNow]);

  const reload = classification?.reload;
  const write = useCallback(
    async (item: WorkItem, to: string | null, reason: string) => {
      if (!api) throw new Error('This view has no ledger to record in.');
      await api.correct(toilProject.name, { item, context: ancestorsOf(item, byId), to, reason });
      await reload?.();
    },
    [api, toilProject.name, byId, reload],
  );
  const reclassify = useCallback(
    async (item: WorkItem, to: string | null, reason: string) => {
      const previous = standing[item.id] ?? null;
      try {
        await write(item, to, reason);
      } catch (e) {
        setNotice({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      // A person's word replaces any answer of the agent's they had not yet accepted.
      setProposed((p) => (p.has(item.id) ? new Map([...p].filter(([id]) => id !== item.id)) : p));
      setNotice({ kind: 'changed', id: item.id, key: item.source.key, to: to ?? 'unsure', previous });
    },
    [standing, write],
  );
  // Accepting is the person's yes, recorded as their word the way a pick is (and so with its Undo line), one item at a time: the ledger takes one
  // correction per request, and a batch route would be a second way to write to it. The reason says whose idea it was and carries the agent's own.
  const accept = useCallback(
    async (ids: string[]) => {
      const changes: Array<{ id: string; key: string; previous: Say | null }> = [];
      for (const id of ids) {
        const proposal = proposed.get(id);
        const item = ins.items.find((i) => i.id === id);
        if (!proposal || !item) continue;
        const previous = standing[id] ?? null;
        await reclassify(item, proposal.category === 'unsure' ? null : proposal.category, `${ACCEPTED_REASON}${proposal.reason}`.slice(0, LEDGER_TEXT_MAX));
        changes.push({ id, key: item.source.key, previous });
      }
      // Several at once are one change to take back: one line, one Undo.
      if (changes.length > 1) setNotice({ kind: 'accepted', changes });
    },
    [proposed, ins.items, standing, reclassify],
  );
  const undo = useCallback(async () => {
    if (notice?.kind !== 'changed' && notice?.kind !== 'accepted') return;
    const changes = notice.kind === 'changed' ? [{ id: notice.id, key: notice.key, previous: notice.previous }] : notice.changes;
    try {
      // The ledger only appends, so changing back is one more line each: what the item stood at, or a taking-back where it had no word.
      for (const c of changes) {
        const item = byId.get(c.id);
        if (item) await write(item, c.previous?.category ?? null, c.previous ? (c.previous.reason ?? '') : TOOK_BACK);
      }
      setNotice({ kind: 'reverted', key: changes[0]!.key, ...(changes.length > 1 ? { count: changes.length } : {}) });
    } catch (e) {
      setNotice({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }, [notice, byId, write]);

  const value = useMemo<ClassifyContext>(
    () => ({
      api,
      ledgerRead: Boolean(classification?.view),
      standing,
      needs,
      pending,
      proposals: proposed,
      setProposals: (answers) => setProposed(new Map(answers.filter((a) => a.category !== 'unsure').map((a) => [a.id, a]))),
      accept,
      dismiss: (ids) => setProposed((cur) => new Map([...cur].filter(([id]) => !ids.includes(id)))),
      reclassify,
      notice,
      setNotice,
      undo,
      applied: (done) => {
        setWrittenNow((cur) => new Map([...cur, ...done.map((d) => [d.id, d.category] as const)]));
      },
    }),
    [api, classification, standing, needs, pending, proposed, accept, reclassify, notice, undo],
  );
  return <Ctx value={value}>{children}</Ctx>;
}
