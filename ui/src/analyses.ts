/**
 * The history of analyses (#395), as the page reads it: every Analyze kept
 * per dossier, newest first, each saying what changed since the one before,
 * and any one opened again. The server keeps them in its cache
 * (server/analyses.ts) and records each Analyze itself as its answer ends,
 * so the page only reads. The preview, which has no server, keeps them in
 * memory (`memoryAnalyses`) and records them from the chat, which is what
 * `record` is for. The rules are src/model/analysis.ts's either way.
 */

import type { Answer } from './agent.ts';
import { MAX_ANALYSES, historyOf, recordOf, snapshotOf, viewOf, type AnalysisRecord, type AnalysisSummary, type AnalysisView } from './model/analysis.ts';
import type { WorkItem } from './toil.ts';

export interface AnalysesApi {
  /** The dossier's analyses, newest first. */
  list(dossier: string): Promise<AnalysisSummary[]>;
  /** One analysis in full, or null when the history no longer has it. */
  get(dossier: string, id: string): Promise<AnalysisView | null>;
  /**
   * Keeps an Analyze answer the page just finished, with the dossier's items
   * as the page read them at `now`. Only where the page keeps the history itself (the
   * preview); the server records its own, so its client has none.
   */
  record?(dossier: string, answer: Answer, at: { startedAt: string; at: string; items: readonly WorkItem[]; now: string }): Promise<string>;
}

/** The history in memory: the preview's, and the App's when it is given none. `seed` is what it starts with. */
export function memoryAnalyses(seed: readonly AnalysisRecord[] = []): AnalysesApi {
  const kept: AnalysisRecord[] = [...seed];
  let n = 0;
  const of = (dossier: string) => kept.filter((r) => r.dossier === dossier);
  return {
    list: async (dossier) => historyOf(of(dossier)),
    get: async (dossier, id) => viewOf(of(dossier), id),
    record: async (dossier, answer, { startedAt, at, items, now }) => {
      const id = `analysis-${Date.parse(at).toString(36)}-${(n++).toString(36)}`;
      kept.push(recordOf(answer, { id, dossier, startedAt, at, snapshot: snapshotOf(items, now) }));
      // The oldest go first, as the server's do.
      const mine = of(dossier).sort((a, b) => a.at.localeCompare(b.at));
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_ANALYSES))) kept.splice(kept.indexOf(old), 1);
      return id;
    },
  };
}
