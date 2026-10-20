import type { CommandContext } from '../../../core/context.js';
import { ToilError } from '../../../core/errors.js';
import type { RecordSkipped } from '../../../core/owi/records.js';
import { MAX_BOOST, SIMILAR_DEFAULT_LIMIT, SIMILAR_DEFAULT_THRESHOLD, SIMILAR_FIELDS, SIMILAR_METHOD, type PairSearch, type SimilarField, type SimilarMatch, type SimilarPair, type SimilarRef, type SimilarRequest, type SimilarWhy } from '../../../core/owi/similar.js';
import type { UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';
import { MAX_SIMILAR_ITEMS, type SimilarTaskOutput } from './similar-task.js';

/**
 * The command side of `util owi similar`, loaded only when it runs
 * (docs/util.md, Lazy loading): check which question was asked, hand the
 * input's bytes to the bounded worker (the parsing and scoring happen there,
 * so a large set never holds the CLI or the MCP server), then report what the
 * worker found and what it checked. Every result says what its score is, and
 * every item scored on less than it might have been is named. A finding with
 * its working shown, which is the only kind an auditor signs.
 */

/**
 * The limits scoring runs under, measured with the built CLI on a Windows
 * laptop (Node 24.14): 20,000 items (8 MB, titles of five words and bodies of
 * about sixty) read, indexed and paired in about 3.7 s, a query or an
 * item over the same set in about 1.8 s. The deadline leaves room for a set
 * near the input cap; one past it, or whose items share far more than real
 * backlogs do, stops with TIMEOUT rather than holding the process.
 */
export const SIMILAR_LIMITS = { timeoutMs: 30_000, maxMemoryMb: 1_536 } as const;
const SIMILAR_FIX = 'Pass fewer items (filter the search that produced them), or compare fewer fields with --fields title.';

export interface OwiSimilarInput {
  bytes: Uint8Array;
  source: UtilInput;
  query?: string | undefined;
  item?: string | undefined;
  pairs?: boolean | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  fields?: string | undefined;
}

export interface OwiSimilarOutput {
  mode: 'query' | 'item' | 'pairs';
  method: string;
  fields: SimilarField[];
  threshold: number;
  limit: number;
  /** The text `--query` ranked against, or null. */
  query: string | null;
  /** The item `--item` ranked against, or null. */
  item: SimilarRef | null;
  /** Distinct items scored. */
  items: number;
  /** How many matches or pairs scored at or above the threshold; the list holds the first `limit`. */
  count: number;
  matches: SimilarMatch[];
  pairs: SimilarPair[];
  /** For --pairs, how the pairs were found; null otherwise. */
  search: PairSearch | null;
  /** How many items have no body and were scored on their titles alone. */
  titleOnly: number;
  skipped: RecordSkipped[];
  verified: Verified;
}

/** The one question asked: exactly one of query, item and pairs. */
export function similarRequest(input: Pick<OwiSimilarInput, 'query' | 'item' | 'pairs'>): SimilarRequest {
  const asked = [input.query !== undefined && 'query', input.item !== undefined && 'item', input.pairs === true && 'pairs'].filter((x): x is string => typeof x === 'string');
  if (asked.length !== 1) {
    throw new ToilError('INVALID_INPUT', asked.length ? `Ask one question at a time: ${asked.join(' and ')} were both given.` : 'Nothing to rank by: pass a query, an item or pairs.', {
      fix: 'Use exactly one of --query "<text>" (rank against some text), --item <owi id> (rank against one item in the set) or --pairs (list likely duplicate pairs).',
    });
  }
  if (input.query !== undefined) return { query: input.query };
  if (input.item !== undefined) return { item: input.item };
  return { pairs: true };
}

/** `--fields title,body`: the fields to compare, checked, in the scorer's order. */
export function similarFields(text: string | undefined): SimilarField[] {
  if (text === undefined) return [...SIMILAR_FIELDS];
  const named = text.split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = named.filter((f) => !(SIMILAR_FIELDS as readonly string[]).includes(f));
  if (unknown.length || !named.length) {
    throw new ToilError('INVALID_INPUT', unknown.length ? `${unknown.map((f) => `"${f}"`).join(', ')} ${unknown.length > 1 ? "aren't fields" : "isn't a field"} the scorer compares.` : 'No fields were named to compare.', {
      fix: `Name one or more of ${SIMILAR_FIELDS.join(', ')}, separated by commas (--fields title,body).`,
    });
  }
  if (!named.includes('title') && !named.includes('body')) {
    throw new ToilError('INVALID_INPUT', 'Labels, parents and links only add small boosts, so they need a title or a body to compare as well.', { fix: 'Add title or body to --fields (--fields title,labels).' });
  }
  return SIMILAR_FIELDS.filter((f) => named.includes(f));
}

/** Up to five ids, and how many more. */
const some = (ids: string[]) => `${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}`;

export async function similarOwi(ctx: Pick<CommandContext, 'warn' | 'signal'>, input: OwiSimilarInput): Promise<OwiSimilarOutput> {
  const request = similarRequest(input);
  const fields = similarFields(input.fields);
  const limit = input.limit ?? SIMILAR_DEFAULT_LIMIT;
  const threshold = input.threshold ?? SIMILAR_DEFAULT_THRESHOLD;

  const { boundedError, movable, runBounded } = await import('../kit/bounded.js');
  const bytes = movable({ bytes: input.bytes, format: 'json' }).bytes;
  const outcome = await runBounded<SimilarTaskOutput>(
    { kind: 'owi-similar', bytes, request, options: { fields, limit, threshold } },
    { ...SIMILAR_LIMITS, signal: ctx.signal, transfer: [bytes.buffer as ArrayBuffer] },
  );
  if (!outcome.ok) throw boundedError(`Scoring ${input.source.label} for similar items`, outcome, SIMILAR_LIMITS, SIMILAR_FIX);
  const found = outcome.value;
  const { result } = found;

  if (found.items === 0) {
    const label = input.source.label;
    throw new ToilError('INVALID_INPUT', `${label[0]!.toUpperCase()}${label.slice(1)} holds no OWI records to compare${found.skipped.length ? `: ${found.skipped.length} were skipped (${found.skipped[0]!.reason})` : ''}.`, {
      fix: 'Pass what toil util owi map printed (pipe it in, or save it and pass the file), or a JSON array of OWI records.',
    });
  }
  if (found.capped) ctx.warn({ code: 'OWI_SIMILAR_CAPPED', message: `The input holds ${found.items + found.capped} records; the first ${MAX_SIMILAR_ITEMS} were scored and ${found.capped} left out. Narrow the search that produced them.` });
  if (found.skipped.length) ctx.warn({ code: 'OWI_SIMILAR_SKIPPED', message: `${found.skipped.length} record${found.skipped.length > 1 ? 's were' : ' was'} skipped: ${found.skipped[0]!.at}, ${found.skipped[0]!.reason}. data.skipped lists each.` });
  if (found.duplicateIds.length) ctx.warn({ code: 'OWI_SIMILAR_DUPLICATE_ID', message: `${found.duplicateIds.length} id${found.duplicateIds.length > 1 ? 's appear' : ' appears'} more than once (${some(found.duplicateIds)}); each was scored as it first appeared.` });
  if (found.titleOnly.length) {
    ctx.warn({ code: 'OWI_SIMILAR_TITLE_ONLY', message: `${found.titleOnly.length} of ${found.items} items have no body, so they were scored on their titles alone: ${some(found.titleOnly)}. Where the tracker holds a body for them, map them from a command that returns it (jira issue get, or jira issue search with description in --fields).` });
  }
  if (found.cutBodies.length) ctx.warn({ code: 'OWI_SIMILAR_BODY_CUT', message: `${found.cutBodies.length} item${found.cutBodies.length > 1 ? 's have bodies' : ' has a body'} longer than the 5,000 terms scored; the rest was left out: ${some(found.cutBodies)}.` });
  if (threshold <= MAX_BOOST) ctx.warn({ code: 'OWI_SIMILAR_LOW_THRESHOLD', message: `A threshold of ${threshold} lets boosts alone (shared labels, the same parent, a link, up to ${MAX_BOOST}) count as a match, with no shared words. Raise --threshold above ${MAX_BOOST} for likely duplicates.` });

  const v = new Verifier(ctx.warn);
  const scored = [...result.matches.map((m) => ({ at: m.id, score: m.score, why: m.why })), ...result.pairs.map((p) => ({ at: `${p.a.id} and ${p.b.id}`, score: p.score, why: p.why }))];
  for (const s of scored) {
    const sum = partsTotal(s.why);
    v.expect('score.parts', s.score >= 0 && s.score <= 1 && Math.abs(Math.min(1, sum) - s.score) <= 0.0005, { at: s.at, expected: `a score in 0 to 1 equal to its parts (${sum.toFixed(4)})`, actual: s.score }, { code: 'OWI_SIMILAR_MISMATCH' });
  }
  if (!scored.length) v.unchecked('score.parts', 'nothing scored at or above the threshold');
  const postings = found.postings;
  if (postings) {
    if (!postings.checked) v.unchecked('pairs.postings', 'no pair scored at or above the threshold');
    for (const d of postings.failed) v.expect('pairs.postings', false, { at: d.at, expected: `${d.expected}, worked out in full`, actual: `${d.actual}, summed from the postings` }, { code: 'OWI_SIMILAR_MISMATCH' });
    for (let i = postings.failed.length; i < postings.checked; i++) v.pass('pairs.postings');
  }
  v.approximated('score.meaning', SIMILAR_METHOD.replace(/\.$/, ''));
  if (result.search?.skippedFeatures) {
    v.approximated('pairs.search', `${result.search.skippedFeatures} terms and trigrams were each in more than ${result.search.maxItemsPerFeature} items, too many to look pairs up by, so a pair sharing only those was not compared. Every pair that was compared is scored in full`);
  }
  v.inputComplete(input.source);

  return {
    mode: result.mode,
    method: result.method,
    fields,
    threshold,
    limit,
    query: 'query' in request ? request.query : null,
    item: found.subject,
    items: found.items,
    count: result.count,
    matches: result.matches,
    pairs: result.pairs,
    search: result.search,
    titleOnly: found.titleOnly.length,
    skipped: found.skipped,
    verified: v.done(),
  };
}

function partsTotal(why: SimilarWhy): number {
  const p = why.parts;
  return p.terms + p.trigram + p.labels + p.parent + p.link;
}
