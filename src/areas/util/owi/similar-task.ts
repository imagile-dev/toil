import { parseOwiRecords, type RecordSkipped } from '../../../core/owi/records.js';
import { askIndex, SimilarityIndex, type SimilarOptions, type SimilarRef, type SimilarRequest, type SimilarResult } from '../../../core/owi/similar.js';

/**
 * The work of `util owi similar`, run inside the bounded worker (kit/bounded.ts):
 * read the records from the input's bytes, score them with the core scorer,
 * then ask again on a second index built from the records in reverse order:
 * a query or an item must give the same matches in the same order, and each
 * pair must score the same from its other side (worked out in full, where
 * the first pass summed it from the postings). A score that depended on
 * input order, on which item was named first, or on the shortcut, would
 * disagree with itself. It is imported only by
 * kit/bounded-task.ts, so none of this loads on the command's thread. Asking
 * the same question twice and comparing answers is called audit, and is
 * usually billed separately.
 */

/** The most records one call scores; the rest are left out with a warning. */
export const MAX_SIMILAR_ITEMS = 50_000;
/** The most records the self-check builds its second index for: past this, the two indexes would not fit the worker's memory together. */
export const RECHECK_MAX_ITEMS = 20_000;

export interface SimilarTaskInput {
  bytes: Uint8Array;
  request: SimilarRequest;
  options: SimilarOptions;
}

/** A returned score that came out differently the second time, for the self-check's failures. */
export interface Disagreement {
  at: string;
  expected: number;
  actual: number | null;
}

export interface SimilarTaskOutput {
  result: SimilarResult;
  /** The item `--item` named, as results name it. */
  subject: SimilarRef | null;
  /** Distinct records scored. */
  items: number;
  /** Records past {@link MAX_SIMILAR_ITEMS}, left out. */
  capped: number;
  skipped: RecordSkipped[];
  duplicateIds: string[];
  titleOnly: string[];
  cutBodies: string[];
  /** The self-check: each returned score worked out again on a second index, or why it wasn't. */
  recomputed: { checked: number; failed: Disagreement[] } | { unchecked: string };
}

export function similarTask({ bytes, request, options }: SimilarTaskInput): SimilarTaskOutput {
  const { items, skipped } = parseOwiRecords(new TextDecoder('utf-8').decode(bytes));
  const kept = items.slice(0, MAX_SIMILAR_ITEMS);
  const fields = options.fields ? { fields: options.fields } : {};
  const index = new SimilarityIndex(kept, fields);
  const result = askIndex(index, request, options);
  const base = {
    result,
    subject: 'item' in request ? (index.ref(request.item) ?? null) : null,
    items: index.size,
    capped: items.length - kept.length,
    skipped,
    duplicateIds: index.duplicateIds,
    titleOnly: index.titleOnlyIds(),
    cutBodies: index.cutBodyIds(),
  };
  if (index.size > RECHECK_MAX_ITEMS) return { ...base, recomputed: { unchecked: `the set holds ${index.size} items, more than the ${RECHECK_MAX_ITEMS} a second index is built for` } };
  // The records the index kept (the first of each id), in reverse order.
  const seen = new Set<string>();
  const again = new SimilarityIndex(kept.filter((i) => !seen.has(i.id) && seen.add(i.id)).reverse(), fields);

  const failed: Disagreement[] = [];
  let checked = 0;
  const expect = (at: string, expected: number, actual: number | undefined) => {
    checked++;
    if (actual !== expected) failed.push({ at, expected, actual: actual ?? null });
  };
  if ('pairs' in request) {
    for (const p of result.pairs) expect(`${p.b.id} against ${p.a.id}`, p.score, again.compare(p.b.id, p.a.id)?.score);
  } else {
    const second = askIndex(again, request, options).matches;
    result.matches.forEach((m, i) => expect(`${m.id}, match ${i + 1}`, m.score, second[i]?.id === m.id ? second[i].score : undefined));
  }

  return { ...base, recomputed: { checked, failed } };
}
