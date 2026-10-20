import { parseOwiRecords, type RecordSkipped } from '../../../core/owi/records.js';
import { askIndex, SIMILAR_METHOD, SimilarityIndex, type SimilarOptions, type SimilarRef, type SimilarRequest, type SimilarResult } from '../../../core/owi/similar.js';

/**
 * The work of `util owi similar`, run inside the bounded worker (kit/bounded.ts):
 * read the records from the input's bytes and score them with the core scorer.
 * For --pairs it also checks the one shortcut the scorer takes: each pair's
 * score is summed from the postings it shares, and every pair returned is
 * worked out again in full, so the two must agree. It is imported only by
 * kit/bounded-task.ts, so none of this loads on the command's thread. Two
 * methods arriving at one figure is the closest thing to sign-off this
 * department has.
 */

/** The most records one call scores; the rest are left out with a warning. */
export const MAX_SIMILAR_ITEMS = 50_000;

export interface SimilarTaskInput {
  bytes: Uint8Array;
  request: SimilarRequest;
  options: SimilarOptions;
}

/** A pair whose score from the postings disagreed with its score worked out in full. */
export interface Disagreement {
  at: string;
  expected: number;
  actual: number;
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
  /** For --pairs, each returned pair's two scores compared; how many were, and which disagreed. Null otherwise. */
  postings: { checked: number; failed: Disagreement[] } | null;
}

export function similarTask({ bytes, request, options }: SimilarTaskInput): SimilarTaskOutput {
  const { items, skipped } = parseOwiRecords(new TextDecoder('utf-8').decode(bytes));
  const kept = items.slice(0, MAX_SIMILAR_ITEMS);
  const index = new SimilarityIndex(kept, options.fields ? { fields: options.fields } : {});
  let postings: SimilarTaskOutput['postings'] = null;
  let result: SimilarResult;
  if ('pairs' in request) {
    const check = { checked: 0, failed: [] as Disagreement[] };
    const found = index.pairs(options, {
      rescored: ({ a, b, summed, full, exact }) => {
        // With common features skipped the summed score is a lower bound, and only that can be held to it.
        check.checked++;
        // One rounding step apart is the same figure: the two add the same products in a different order.
        if (exact ? Math.abs(summed - full) > 0.00011 : summed > full + 0.00011) check.failed.push({ at: `${a} and ${b}`, expected: full, actual: summed });
      },
    });
    postings = check;
    result = { mode: 'pairs', method: SIMILAR_METHOD, count: found.count, matches: [], pairs: found.pairs, search: found.search };
  } else {
    result = askIndex(index, request, options);
  }
  return {
    result,
    subject: 'item' in request ? (index.ref(request.item) ?? null) : null,
    items: index.size,
    capped: items.length - kept.length,
    skipped,
    duplicateIds: index.duplicateIds,
    titleOnly: index.titleOnlyIds(),
    cutBodies: index.cutBodyIds(),
    postings,
  };
}
