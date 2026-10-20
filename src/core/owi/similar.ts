import { ToilError } from '../errors.js';
import type { Body, Link, LinkType, WorkItem } from './types.js';

/**
 * Likely duplicates among Open Work Items, found by lexical scoring alone: no
 * model, no network, and the same answer on every run and every platform.
 * `toil util owi similar` runs it in the bounded worker; Toil UI's item page
 * and its agent call it directly on the items they hold, and anything that
 * needs "does this already exist?" (#304) imports it from here.
 *
 * How a score is made, so its `why` can say exactly what drove it:
 *
 * - **Terms.** Titles and bodies (Markdown, wiki markup, HTML and ADF, read
 *   as plain text) become lowercase words, with accents folded, common English
 *   words dropped and a light suffix stemmer applied. Each term is weighted by
 *   BM25: its IDF over the set, times its saturated, length-normalised
 *   frequency, with a title occurrence worth twice a body one.
 *   - Two items: the cosine of their BM25 vectors. When either has no body,
 *     both are compared on their titles alone, so a missing body never counts
 *     against an item.
 *   - A query: how much of the query's IDF the item covers, a term in its title
 *     counting fully and one only in its body at most 0.7.
 * - **Trigrams.** The character trigrams of the titles' words (each padded with
 *   a space), compared with Dice's coefficient, which catches typos and other
 *   forms of a word the stemmer leaves apart.
 * - **Boosts.** Small ones for shared labels (rarer labels count more), the
 *   same parent, and a direct link between the two items. Together they can't
 *   reach the default threshold on their own.
 *
 * The score is 0.7 of the terms and 0.3 of the trigrams (all terms when titles
 * aren't compared), plus the boosts, capped at 1 and rounded to four places.
 * It measures shared words, not meaning: two items that describe one problem
 * in entirely different words score low, and the docs say so.
 *
 * Determinism: items are indexed in id order, every sum runs in a fixed order,
 * a pair is always scored from its lower id, ties are broken by id with a
 * plain code-unit comparison (never the locale's), and only the rounded
 * figures leave this module. Two runs on the same input are byte-identical,
 * which is more than can be said for the minutes of most duplicate-review
 * meetings.
 */

/** What the scorer can compare. `parent` and `links` only ever add a small boost. */
export const SIMILAR_FIELDS = ['title', 'body', 'labels', 'parent', 'links'] as const;
export type SimilarField = (typeof SIMILAR_FIELDS)[number];

export const SIMILAR_DEFAULT_LIMIT = 10;
export const SIMILAR_DEFAULT_THRESHOLD = 0.35;

/** One sentence on what the score is, for every result that carries one (principle 4). */
export const SIMILAR_METHOD =
  'Lexical similarity: BM25-weighted shared terms in titles and bodies, title character trigrams, and small boosts for shared labels, the same parent and a direct link. It measures shared words, not meaning, so a duplicate written in entirely different words scores low.';

/** The parts of an item the scorer reads. A full OWI record has all of them. */
export type SimilarItem = Pick<WorkItem, 'id' | 'title'> & Partial<Pick<WorkItem, 'body' | 'labels' | 'parent' | 'links' | 'source' | 'url'>>;

export interface SimilarOptions {
  /** What to compare. Default: all of {@link SIMILAR_FIELDS}. */
  fields?: readonly SimilarField[];
  /** The most matches or pairs to return. Default {@link SIMILAR_DEFAULT_LIMIT}. */
  limit?: number;
  /** The lowest score returned, 0 to 1. Default {@link SIMILAR_DEFAULT_THRESHOLD}. */
  threshold?: number;
}

/** What each signal added to a score. They sum to the score, before it is capped at 1. */
export interface SimilarParts {
  terms: number;
  trigram: number;
  labels: number;
  parent: number;
  link: number;
}

/** Why two things matched: every signal that added to the score, and what it found. */
export interface SimilarWhy {
  /** The same, in one line. */
  summary: string;
  /** Shared terms found in both titles (for a query: in the item's title), strongest first. */
  titleTerms: string[];
  /** Shared terms found in a body on at least one side, strongest first. */
  bodyTerms: string[];
  /** How alike the titles' character trigrams are, 0 to 1. */
  trigram: number;
  /** Labels both items carry. */
  labels: string[];
  /** The parent both items share, or null. */
  parent: string | null;
  /** A direct link between the two, as the first item records it, or null. */
  link: { type: LinkType; direction: 'outward' | 'inward'; name: string } | null;
  /** True when the two were compared on their titles alone, because one has no body. */
  titleOnly: boolean;
  parts: SimilarParts;
}

/** An item as a result names it. */
export interface SimilarRef {
  id: string;
  title: string;
  source: WorkItem['source'] | null;
  url: string | null;
}

export interface SimilarMatch extends SimilarRef {
  score: number;
  why: SimilarWhy;
}

export interface SimilarPair {
  score: number;
  /** The pair's lower id. */
  a: SimilarRef;
  b: SimilarRef;
  why: SimilarWhy;
}

/** How `pairs()` chose which pairs to compare. */
export interface PairSearch {
  /** Pairs scored in full. */
  compared: number;
  /**
   * Terms and trigrams too common to look pairs up by, and the most items any
   * of them was in: a pair sharing only those wasn't compared. Zero when every
   * pair that could reach the threshold was compared.
   */
  skippedFeatures: number;
  /** The most items a feature used to find pairs was in; null when none were skipped. */
  maxItemsPerFeature: number | null;
}

/** Callbacks into `pairs()`, for a caller that checks its shortcut (util owi similar's self-check). */
export interface PairHooks {
  /**
   * Called for each pair returned, with the score summed from the postings and
   * the score worked out in full. `exact` is false when common features were
   * skipped, where the summed score is a lower bound rather than the same figure.
   */
  rescored?: (pair: { a: string; b: string; summed: number; full: number; exact: boolean }) => void;
}

export interface MatchesResult {
  /** How many items scored at or above the threshold; `matches` holds the first `limit` of them. */
  count: number;
  matches: SimilarMatch[];
}

export interface PairsResult {
  /** How many pairs scored at or above the threshold; `pairs` holds the first `limit` of them. */
  count: number;
  pairs: SimilarPair[];
  search: PairSearch;
}

// ---------------------------------------------------------------------------
// Text

/** Common English words that say nothing about which problem an item is. */
const STOPWORDS = new Set(
  'a about above after again all also am an and any are as at be been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours see per via etc get got'.split(' '),
);

/** Words and numbers, after Unicode letters lose their accents. */
const WORD = /[\p{L}\p{N}]+/gu;
const MARKS = /\p{M}+/gu;

/** A body's longest run of terms that is read; the rest is cut, and counted. */
export const MAX_BODY_TERMS = 5000;

/**
 * A light, deterministic suffix stemmer: plurals, -ed and -ing, enough that
 * "times" meets "time" and "payments" meets "payment". It never looks a word up.
 */
export function stem(word: string): string {
  if (word.length <= 3 || /^\d/.test(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercase words, accents folded, in order. */
export function words(text: string): string[] {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase().match(WORD) ?? [];
}

/** Whether a word can be a term: two characters or more, not a common word, and not a one- or two-digit number (the 02 of 02:00). */
const termWord = (word: string) => word.length >= 2 && !STOPWORDS.has(word) && !/^\d{1,2}$/.test(word);

/** The terms in some text, stemmed, in order. Each keeps the word it came from. */
export function terms(text: string): Array<{ term: string; word: string }> {
  const out: Array<{ term: string; word: string }> = [];
  for (const word of words(text)) if (termWord(word)) out.push({ term: stem(word), word });
  return out;
}

/** The character trigrams of some text's words, each word padded with a space: " ti", "tim", ..., "ut ". */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(text)) {
    if (!termWord(word)) continue;
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * An OWI body as plain text, for scoring only: Markdown, Jira wiki markup and
 * HTML lose their markup and URLs (a link's text stays), and ADF gives the
 * text of its nodes in document order. Every pattern here is linear in the
 * text: each negated class excludes its own opening character, so a body of
 * nothing but `<` or `[` can't make every position scan to the end, and a URL
 * is matched only from the start of its run. The body is never rendered.
 * Bodies come from tracker items anyone with access can write, and this runs
 * unbounded in Toil UI and the API, so linear is a requirement, not a nicety.
 */
export function bodyText(body: Body | null | undefined): string {
  if (!body) return '';
  if (body.format === 'adf' || typeof body.content !== 'string') return adfText(body.content);
  let s = body.content;
  if (body.format === 'html') {
    s = s.replace(/<[^<>]*>/g, ' ').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name] ?? ' ');
  } else if (body.format === 'wiki') {
    s = s
      .replace(/\[([^|[\]]*)\|[^[\]]*\]/g, '$1')
      .replace(/\{[A-Za-z]+(?::[^{}]*)?\}/g, ' ')
      .replace(/^h[1-6]\.\s/gm, ' ');
  } else {
    s = s
      .replace(/!?\[([^[\]]*)\]\([^()]*\)/g, '$1')
      .replace(/<[^<>]*>/g, ' ');
  }
  return s.replace(/(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/g, ' ');
}

/** The text in an ADF document: every text node, and a mention's or emoji's text, in document order. */
function adfText(content: unknown): string {
  const out: string[] = [];
  const stack: unknown[] = [content];
  // A walk with its own stack, so a deeply nested document can't exhaust the call stack.
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (typeof node !== 'object' || node === null) continue;
    const n = node as { text?: unknown; attrs?: { text?: unknown }; content?: unknown };
    if (typeof n.text === 'string') out.push(n.text);
    else if (typeof n.attrs?.text === 'string') out.push(n.attrs.text);
    if (Array.isArray(n.content)) stack.push(n.content);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// The index

const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 2;
const BODY_MATCH = 0.7;
const W_TERMS = 0.7;
const W_TRIGRAM = 0.3;
const LABEL_BOOST = 0.04;
const MAX_LABEL_BOOST = 0.08;
const PARENT_BOOST = 0.05;
const LINK_BOOST = 0.1;
/** The most the boosts can add: a pair that shares no term or trigram can score no more than this. */
export const MAX_BOOST = MAX_LABEL_BOOST + PARENT_BOOST + LINK_BOOST;
/** How many feature lookups `pairs()` may make before it stops using the commonest features to find pairs. */
const PAIR_BUDGET = 60_000_000;
const WHY_TERMS = 8;
/**
 * How far below the threshold a pair's score from the postings may sit and
 * still be scored again in full, when common features were skipped: about
 * what the skipped terms and trigrams could add.
 */
const MAX_MISSED = 0.15;

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
/** Code-unit order: the same on every machine and locale. */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Doc {
  ref: SimilarRef;
  /** Term frequency in the title and body, and the word each term was first seen as. */
  title: Map<string, number>;
  body: Map<string, number>;
  surface: Map<string, string>;
  titleLength: number;
  bodyLength: number;
  hasBody: boolean;
  bodyCut: boolean;
  trigrams: Set<string>;
  labels: string[];
  parent: string | null;
  links: Link[];
  /** BM25 weights over title and body together, and over the title alone, with their norms. */
  full: Map<string, number>;
  fullNorm: number;
  titleOnly: Map<string, number>;
  titleNorm: number;
}

/** A query's terms, weighted, and its trigrams. */
interface Query {
  terms: Map<string, string>;
  trigrams: Set<string>;
}

/**
 * An index over a set of OWI items, built once and asked many times: rank the
 * set against some text (`query`), against one of its items (`item`), or list
 * its likely duplicate pairs (`pairs`). Items with the same id are read once,
 * the first time they appear.
 */
export class SimilarityIndex {
  readonly fields: readonly SimilarField[];
  private readonly docs: Doc[] = [];
  private readonly byId = new Map<string, number>();
  private readonly df = new Map<string, number>();
  private readonly labelDf = new Map<string, number>();
  private readonly on: Record<SimilarField, boolean>;
  /** The average title and body length in terms, for BM25's length normalisation. Bodies average over the items that have one. */
  private readonly avgTitle: number;
  private readonly avgBody: number;
  /** Ids read more than once: each was scored as it first appeared. */
  readonly duplicateIds: string[] = [];

  constructor(items: readonly SimilarItem[], options: { fields?: readonly SimilarField[] } = {}) {
    this.fields = options.fields && options.fields.length ? SIMILAR_FIELDS.filter((f) => options.fields!.includes(f)) : SIMILAR_FIELDS;
    this.on = Object.fromEntries(SIMILAR_FIELDS.map((f) => [f, this.fields.includes(f)])) as Record<SimilarField, boolean>;
    const seen = new Set<string>();
    const unique: SimilarItem[] = [];
    for (const item of items) {
      if (seen.has(item.id)) {
        if (!this.duplicateIds.includes(item.id)) this.duplicateIds.push(item.id);
        continue;
      }
      seen.add(item.id);
      unique.push(item);
    }
    unique.sort((a, b) => byCode(a.id, b.id));
    let titleTotal = 0;
    let bodyTotal = 0;
    for (const item of unique) {
      const doc = this.read(item);
      this.byId.set(item.id, this.docs.length);
      this.docs.push(doc);
      titleTotal += doc.titleLength;
      bodyTotal += doc.bodyLength;
      for (const term of new Set([...doc.title.keys(), ...doc.body.keys()])) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      for (const label of doc.labels) this.labelDf.set(label, (this.labelDf.get(label) ?? 0) + 1);
    }
    const withBody = this.docs.filter((d) => d.hasBody).length;
    this.avgTitle = titleTotal / (this.docs.length || 1) || 1;
    this.avgBody = withBody ? bodyTotal / withBody : 1;
    for (const doc of this.docs) this.weigh(doc);
  }

  /** How many distinct items the index holds. */
  get size(): number {
    return this.docs.length;
  }

  /** The ids of items with no body text, which are scored on their titles alone. Empty when bodies aren't compared. */
  titleOnlyIds(): string[] {
    return this.on.body ? this.docs.filter((d) => !d.hasBody).map((d) => d.ref.id) : [];
  }

  /** The ids of items whose body was cut at {@link MAX_BODY_TERMS} terms. */
  cutBodyIds(): string[] {
    return this.docs.filter((d) => d.bodyCut).map((d) => d.ref.id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The item an id names, as results name it, or undefined. */
  ref(id: string): SimilarRef | undefined {
    const at = this.byId.get(id);
    return at === undefined ? undefined : this.docs[at]!.ref;
  }

  /** The ids in the index, in id order. */
  ids(): string[] {
    return this.docs.map((d) => d.ref.id);
  }

  /** Every item ranked against some text: highest score first, ties by id. */
  query(text: string, options: SimilarOptions = {}): MatchesResult {
    const q: Query = { terms: new Map(), trigrams: this.on.title ? trigrams(text) : new Set() };
    for (const { term, word } of terms(text)) if (!q.terms.has(term)) q.terms.set(term, word);
    return this.rank(this.docs, (doc, explain) => this.scoreQuery(q, doc, explain), options);
  }

  /** Every other item ranked against the one with this id: highest score first, ties by id. Undefined when the id isn't in the index. */
  item(id: string, options: SimilarOptions = {}): MatchesResult | undefined {
    const at = this.byId.get(id);
    if (at === undefined) return undefined;
    const subject = this.docs[at]!;
    return this.rank(
      this.docs.filter((d) => d !== subject),
      (doc, explain) => this.scorePair(subject, doc, explain),
      options,
    );
  }

  /** The score of two items in the index, from either side: the same figures whichever is named first. */
  compare(a: string, b: string): { score: number; why: SimilarWhy } | undefined {
    const i = this.byId.get(a);
    const j = this.byId.get(b);
    if (i === undefined || j === undefined || i === j) return undefined;
    const scored = this.scorePair(this.docs[i]!, this.docs[j]!, true);
    return { score: scored.score, why: scored.why! };
  }

  /**
   * The set's likely duplicate pairs, highest score first, ties by the pair's
   * ids. Pairs are found through the terms, trigrams, labels, parents and
   * links they share, so the work grows with what items have in common rather
   * than with the square of the set; a pair sharing none of those scores 0
   * and is never looked at. On a very large set the
   * commonest terms and trigrams stop being used to find pairs once a fixed
   * budget is spent; `search` says when that happened.
   */
  pairs(options: SimilarOptions = {}, hooks: PairHooks = {}): PairsResult {
    const threshold = clampThreshold(options.threshold);
    const limit = clampLimit(options.limit);
    const n = this.docs.length;
    // Postings: for each feature, the items that have it in id order, and for a term the item's two weights beside each.
    interface Posting {
      docs: number[];
      full?: number[];
      title?: number[];
      label?: number;
    }
    const postings = new Map<string, Posting>();
    const add = (feature: string, i: number, weights?: { full: number; title: number }, label?: number) => {
      let p = postings.get(feature);
      if (!p) postings.set(feature, (p = { docs: [], ...(weights ? { full: [], title: [] } : {}), ...(label === undefined ? {} : { label }) }));
      p.docs.push(i);
      if (weights) {
        p.full!.push(weights.full);
        p.title!.push(weights.title);
      }
    };
    this.docs.forEach((doc, i) => {
      for (const [term, w] of doc.full) add(`t\u0000${term}`, i, { full: w, title: doc.titleOnly.get(term) ?? 0 });
      for (const g of doc.trigrams) add(`g\u0000${g}`, i);
      for (const label of doc.labels) add(`l\u0000${label}`, i, undefined, this.labelWeight(label));
      if (doc.parent !== null) add(`p\u0000${doc.parent}`, i);
    });
    // The rarest features first, until the budget of lookups is spent: each costs the square of its length.
    const ordered = [...postings.entries()].filter(([, p]) => p.docs.length > 1).sort((x, y) => x[1].docs.length - y[1].docs.length || byCode(x[0], y[0]));
    let spent = 0;
    let usable = 0;
    for (const [, p] of ordered) {
      const cost = p.docs.length * p.docs.length;
      if (spent + cost > PAIR_BUDGET) break;
      spent += cost;
      usable++;
    }
    const skipped = ordered.length - usable;
    const maxUsed = usable ? ordered[usable - 1]![1].docs.length : 0;

    // Each item's features, with its place in each list, so a pass looks only at later items.
    const features: Array<Array<{ p: Posting; at: number; kind: string }>> = this.docs.map(() => []);
    for (const [feature, p] of ordered.slice(0, usable)) p.docs.forEach((i, at) => features[i]!.push({ p, at, kind: feature[0]! }));
    const linked: number[][] = this.docs.map(() => []);
    if (this.on.links) {
      this.docs.forEach((doc, i) => {
        for (const l of doc.links) {
          const j = this.byId.get(l.target);
          if (j !== undefined && j !== i) linked[Math.min(i, j)]!.push(Math.max(i, j));
        }
      });
    }

    // What each later item shares with item i, summed straight from the postings: the term
    // dot products, the trigrams in common, the label boost, the parent and a link. A pair's
    // score then costs nothing more to work out. With features skipped these are lower
    // bounds, so a pair near the threshold is scored again in full.
    const dotFull = new Float64Array(n);
    const dotTitle = new Float64Array(n);
    const grams = new Int32Array(n);
    const label = new Float64Array(n);
    const flags = new Uint8Array(n);
    const stamp = new Int32Array(n).fill(-1);
    const exactNeeded = skipped > 0;
    const best: Array<{ score: number; i: number; j: number; full: boolean }> = [];
    let count = 0;
    let compared = 0;
    const offer = (score: number, i: number, j: number, full: boolean) => {
      if (best.length === limit && !before(score, i, j, best[best.length - 1]!)) return;
      let at = best.length;
      while (at > 0 && before(score, i, j, best[at - 1]!)) at--;
      best.splice(at, 0, { score, i, j, full });
      if (best.length > limit) best.pop();
    };
    for (let i = 0; i < n; i++) {
      const touched: number[] = [];
      const touch = (j: number) => {
        if (stamp[j] === i) return;
        stamp[j] = i;
        dotFull[j] = 0;
        dotTitle[j] = 0;
        grams[j] = 0;
        label[j] = 0;
        flags[j] = 0;
        touched.push(j);
      };
      for (const { p, at, kind } of features[i]!) {
        const { docs } = p;
        if (kind === 't') {
          const full = p.full!;
          const title = p.title!;
          const wf = full[at]!;
          const wt = title[at]!;
          for (let k = at + 1; k < docs.length; k++) {
            const j = docs[k]!;
            touch(j);
            dotFull[j] = dotFull[j]! + wf * full[k]!;
            dotTitle[j] = dotTitle[j]! + wt * title[k]!;
          }
        } else {
          for (let k = at + 1; k < docs.length; k++) {
            const j = docs[k]!;
            touch(j);
            if (kind === 'g') grams[j] = grams[j]! + 1;
            else if (kind === 'l') label[j] = label[j]! + p.label!;
            else flags[j] = flags[j]! | 1;
          }
        }
      }
      for (const j of linked[i]!) {
        touch(j);
        flags[j] = flags[j]! | 2;
      }
      const a = this.docs[i]!;
      for (const j of touched) {
        compared++;
        const b = this.docs[j]!;
        const titleOnly = !(this.on.body && a.hasBody && b.hasBody);
        const norm = titleOnly ? a.titleNorm * b.titleNorm : a.fullNorm * b.fullNorm;
        const lexical = norm > 0 ? (titleOnly ? dotTitle[j]! : dotFull[j]!) / norm : 0;
        const sizes = a.trigrams.size + b.trigrams.size;
        const trigram = sizes ? (2 * grams[j]!) / sizes : 0;
        let score = total(this.weighParts(lexical, trigram, Math.min(MAX_LABEL_BOOST, label[j]!), flags[j]! & 1 ? PARENT_BOOST : 0, flags[j]! & 2 ? LINK_BOOST : 0));
        let full = false;
        if (exactNeeded && score < threshold && score >= threshold - MAX_MISSED) {
          score = this.scorePair(a, b).score;
          full = true;
        }
        if (score < threshold) continue;
        count++;
        offer(score, i, j, full);
      }
    }
    // The pairs returned are scored again in full, with their reasons, exactly as compare() would.
    const pairs = best
      .map(({ i, j, score: summed, full }) => {
        const scored = this.scorePair(this.docs[i]!, this.docs[j]!, true);
        hooks.rescored?.({ a: this.docs[i]!.ref.id, b: this.docs[j]!.ref.id, summed, full: scored.score, exact: full || !exactNeeded });
        return { score: scored.score, a: this.docs[i]!.ref, b: this.docs[j]!.ref, why: scored.why! };
      })
      .filter((p) => p.score >= threshold)
      .sort((x, y) => y.score - x.score || byCode(x.a.id, y.a.id) || byCode(x.b.id, y.b.id));
    return { count, pairs, search: { compared, skippedFeatures: skipped, maxItemsPerFeature: skipped ? maxUsed : null } };
  }

  /** A shared label's boost: rarer labels count for more, and one every item carries for nothing. */
  private labelWeight(label: string): number {
    return LABEL_BOOST * (1 - (this.labelDf.get(label) ?? 0) / (this.docs.length || 1));
  }

  // -------------------------------------------------------------------------

  private read(item: SimilarItem): Doc {
    const title = new Map<string, number>();
    const body = new Map<string, number>();
    const surface = new Map<string, string>();
    const note = (term: string, word: string) => {
      const was = surface.get(term);
      if (was === undefined || word.length < was.length || (word.length === was.length && word < was)) surface.set(term, word);
    };
    let titleLength = 0;
    if (this.on.title) {
      for (const { term, word } of terms(item.title)) {
        title.set(term, (title.get(term) ?? 0) + 1);
        note(term, word);
        titleLength++;
      }
    }
    let bodyLength = 0;
    let bodyCut = false;
    if (this.on.body) {
      for (const { term, word } of terms(bodyText(item.body))) {
        if (bodyLength === MAX_BODY_TERMS) {
          bodyCut = true;
          break;
        }
        body.set(term, (body.get(term) ?? 0) + 1);
        note(term, word);
        bodyLength++;
      }
    }
    return {
      ref: { id: item.id, title: item.title, source: item.source ?? null, url: item.url ?? null },
      title,
      body,
      surface,
      titleLength,
      bodyLength,
      hasBody: bodyLength > 0,
      bodyCut,
      trigrams: this.on.title ? trigrams(item.title) : new Set(),
      labels: this.on.labels ? [...new Set(item.labels ?? [])].sort(byCode) : [],
      parent: this.on.parent ? (item.parent ?? null) : null,
      links: this.on.links ? (item.links ?? []) : [],
      full: new Map(),
      fullNorm: 0,
      titleOnly: new Map(),
      titleNorm: 0,
    };
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private weigh(doc: Doc): void {
    const satTitle = (tf: number) => saturate(tf, doc.titleLength, this.avgTitle);
    const satBody = (tf: number) => saturate(tf, doc.bodyLength, this.avgBody);
    let fullSum = 0;
    let titleSum = 0;
    for (const [term, tf] of doc.title) {
      const w = this.idf(term) * satTitle(tf);
      doc.titleOnly.set(term, w);
      titleSum += w * w;
    }
    for (const term of new Set([...doc.title.keys(), ...doc.body.keys()])) {
      const t = doc.title.get(term);
      const b = doc.body.get(term);
      const w = this.idf(term) * (TITLE_BOOST * (t ? satTitle(t) : 0) + (b ? satBody(b) : 0));
      doc.full.set(term, w);
      fullSum += w * w;
    }
    doc.fullNorm = Math.sqrt(fullSum);
    doc.titleNorm = Math.sqrt(titleSum);
  }

  /** How alike two items are, and with `explain` why. Always computed from the lower id, so it is the same from either side. */
  private scorePair(x: Doc, y: Doc, explain = false): { score: number; why?: SimilarWhy } {
    const [a, b] = byCode(x.ref.id, y.ref.id) <= 0 ? [x, y] : [y, x];
    const titleOnly = !(this.on.body && a.hasBody && b.hasBody);
    const va = titleOnly ? a.titleOnly : a.full;
    const vb = titleOnly ? b.titleOnly : b.full;
    const norm = titleOnly ? a.titleNorm * b.titleNorm : a.fullNorm * b.fullNorm;
    const shared: Array<{ term: string; weight: number; title: boolean }> = [];
    let dot = 0;
    for (const [term, wa] of va) {
      const wb = vb.get(term);
      if (wb === undefined) continue;
      const product = wa * wb;
      dot += product;
      if (explain) shared.push({ term, weight: product, title: a.title.has(term) && b.title.has(term) });
    }
    const lexical = norm > 0 ? dot / norm : 0;
    const trigram = this.on.title ? dice(a.trigrams, b.trigrams) : 0;
    const labels = a.labels.filter((l) => b.labels.includes(l));
    const labelBoost = Math.min(MAX_LABEL_BOOST, labels.reduce((sum, l) => sum + this.labelWeight(l), 0));
    const parent = a.parent !== null && a.parent === b.parent ? a.parent : null;
    const link = linkBetween(x, y);
    const parts = this.weighParts(lexical, trigram, labelBoost, parent ? PARENT_BOOST : 0, link ? LINK_BOOST : 0);
    const score = total(parts);
    if (!explain) return { score };
    const surface = (term: string) => {
      const p = a.surface.get(term)!;
      const q = b.surface.get(term)!;
      return p.length < q.length || (p.length === q.length && p <= q) ? p : q;
    };
    const ranked = shared.sort((p, q) => q.weight - p.weight || byCode(p.term, q.term));
    return {
      score,
      why: this.explain({
        titleTerms: ranked.filter((s) => s.title).slice(0, WHY_TERMS).map((s) => surface(s.term)),
        bodyTerms: ranked.filter((s) => !s.title).slice(0, WHY_TERMS).map((s) => surface(s.term)),
        trigram,
        labels,
        parent,
        link,
        titleOnly,
        parts,
      }),
    };
  }

  /** How well an item covers a query. */
  private scoreQuery(q: Query, doc: Doc, explain = false): { score: number; why?: SimilarWhy } {
    let covered = 0;
    let possible = 0;
    const hits: Array<{ term: string; weight: number; title: boolean }> = [];
    for (const [term, word] of q.terms) {
      const idf = this.idf(term);
      possible += idf;
      const inTitle = doc.title.has(term) ? Math.min(1, saturate(doc.title.get(term)!, doc.titleLength, this.avgTitle)) : 0;
      const inBody = doc.body.has(term) ? BODY_MATCH * Math.min(1, saturate(doc.body.get(term)!, doc.bodyLength, this.avgBody)) : 0;
      const m = Math.max(inTitle, inBody);
      if (m === 0) continue;
      covered += idf * m;
      if (explain) hits.push({ term: word, weight: idf * m, title: inTitle >= inBody });
    }
    const lexical = possible > 0 ? covered / possible : 0;
    const trigram = this.on.title ? dice(q.trigrams, doc.trigrams) : 0;
    const parts = this.weighParts(lexical, trigram, 0, 0, 0);
    const score = total(parts);
    if (!explain) return { score };
    const ranked = hits.sort((p, r) => r.weight - p.weight || byCode(p.term, r.term));
    return {
      score,
      why: this.explain({
        titleTerms: ranked.filter((h) => h.title).slice(0, WHY_TERMS).map((h) => h.term),
        bodyTerms: ranked.filter((h) => !h.title).slice(0, WHY_TERMS).map((h) => h.term),
        trigram,
        labels: [],
        parent: null,
        link: null,
        titleOnly: this.on.body && !doc.hasBody,
        parts,
      }),
    };
  }

  private weighParts(lexical: number, trigram: number, labels: number, parent: number, link: number): SimilarParts {
    const wTerms = this.on.title ? W_TERMS : 1;
    const wTrigram = this.on.title ? W_TRIGRAM : 0;
    return { terms: wTerms * lexical, trigram: wTrigram * trigram, labels, parent, link };
  }

  private explain(raw: Omit<SimilarWhy, 'summary'>): SimilarWhy {
    const parts: SimilarParts = { terms: round4(raw.parts.terms), trigram: round4(raw.parts.trigram), labels: round4(raw.parts.labels), parent: round4(raw.parts.parent), link: round4(raw.parts.link) };
    const why = { ...raw, trigram: round4(raw.trigram), parts };
    return { summary: summarise(why), ...why };
  }

  /** The items scoring at least the threshold, best first and ties by id, the first `limit` of them explained. */
  private rank(docs: Doc[], score: (doc: Doc, explain?: boolean) => { score: number; why?: SimilarWhy }, options: SimilarOptions): MatchesResult {
    const threshold = clampThreshold(options.threshold);
    const limit = clampLimit(options.limit);
    const kept = docs
      .map((doc) => ({ doc, score: score(doc).score }))
      .filter((s) => s.score >= threshold)
      .sort((x, y) => y.score - x.score || byCode(x.doc.ref.id, y.doc.ref.id));
    return {
      count: kept.length,
      matches: kept.slice(0, limit).map(({ doc }) => {
        const explained = score(doc, true);
        return { ...doc.ref, score: explained.score, why: explained.why! };
      }),
    };
  }
}

/** BM25's term frequency, saturated by K1 and normalised by length against the average. */
function saturate(tf: number, length: number, avg: number): number {
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / avg));
}

/** Dice's coefficient of two sets: twice what they share over their sizes together. */
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const g of small) if (large.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** Whether a pair (score, i, j) ranks before another: higher score, then lower ids. */
function before(score: number, i: number, j: number, other: { score: number; i: number; j: number }): boolean {
  return score > other.score || (score === other.score && (i < other.i || (i === other.i && j < other.j)));
}

/** A link from x to y as x records it, else y's link to x turned round. */
function linkBetween(x: Doc, y: Doc): SimilarWhy['link'] {
  const out = x.links.find((l) => l.target === y.ref.id);
  if (out) return { type: out.type, direction: out.direction, name: out.name };
  const back = y.links.find((l) => l.target === x.ref.id);
  if (back) return { type: back.type, direction: back.direction === 'outward' ? 'inward' : 'outward', name: back.name };
  return null;
}

/** The score from its parts: their sum, capped at 1, rounded to four places. */
function total(parts: SimilarParts): number {
  return round4(Math.min(1, parts.terms + parts.trigram + parts.labels + parts.parent + parts.link));
}

const percent = (x: number) => `${Math.round(x * 100)}%`;

function summarise(why: Omit<SimilarWhy, 'summary'>): string {
  const said: string[] = [];
  if (why.titleTerms.length) said.push(`title terms ${why.titleTerms.join(', ')}`);
  if (why.bodyTerms.length) said.push(`body terms ${why.bodyTerms.join(', ')}`);
  if (why.trigram > 0) said.push(`titles ${percent(why.trigram)} alike by trigram`);
  if (why.labels.length) said.push(`shared label${why.labels.length > 1 ? 's' : ''} ${why.labels.join(', ')}`);
  if (why.parent) said.push(`same parent ${why.parent}`);
  if (why.link) said.push(`linked (${why.link.name})`);
  if (!said.length) said.push('nothing in common');
  if (why.titleOnly) said.push('compared on titles alone');
  return `${said.join('; ')}.`;
}

function clampThreshold(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? SIMILAR_DEFAULT_THRESHOLD : Math.min(1, Math.max(0, value));
}

function clampLimit(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? SIMILAR_DEFAULT_LIMIT : Math.max(1, Math.floor(value));
}

/** What to rank: the set against some text, against one of its items, or every pair in it. */
export type SimilarRequest = { query: string } | { item: string } | { pairs: true };

export interface SimilarResult {
  mode: 'query' | 'item' | 'pairs';
  /** {@link SIMILAR_METHOD}: what the score measures, and what it misses. */
  method: string;
  /** How many items or pairs scored at or above the threshold; `matches` or `pairs` holds the first `limit`. */
  count: number;
  /** For `query` and `item`, best first; empty for `pairs`. */
  matches: SimilarMatch[];
  /** For `pairs`, best first; empty otherwise. */
  pairs: SimilarPair[];
  /** For `pairs`, how pairs were found; null otherwise. */
  search: PairSearch | null;
}

/**
 * Ranks OWI items for likely duplicates in one call: builds a
 * {@link SimilarityIndex} and asks it once. To ask several questions of one
 * set, build the index and keep it. An `item` the set doesn't hold is
 * INVALID_INPUT, naming any item whose native key it is.
 */
export function findSimilar(items: readonly SimilarItem[], request: SimilarRequest, options: SimilarOptions = {}): SimilarResult {
  const index = new SimilarityIndex(items, options.fields ? { fields: options.fields } : {});
  return askIndex(index, request, options);
}

/** {@link findSimilar} on an index already built. */
export function askIndex(index: SimilarityIndex, request: SimilarRequest, options: SimilarOptions = {}): SimilarResult {
  const base = { method: SIMILAR_METHOD, matches: [] as SimilarMatch[], pairs: [] as SimilarPair[], search: null };
  if ('pairs' in request) {
    const found = index.pairs(options);
    return { ...base, mode: 'pairs', count: found.count, pairs: found.pairs, search: found.search };
  }
  if ('query' in request) {
    if (!terms(request.query).length && !trigrams(request.query).size) {
      throw new ToilError('INVALID_INPUT', `The query "${request.query}" has no words to compare: only common words, punctuation or single characters.`, { fix: 'Pass a query with the words the item would use, such as "card payments time out at checkout".' });
    }
    const found = index.query(request.query, options);
    return { ...base, mode: 'query', count: found.count, matches: found.matches };
  }
  const found = index.item(request.item, options);
  if (!found) {
    const near = index.ids().filter((id) => id.endsWith(`:${request.item}`) || id.split(':').pop() === request.item.split(':').pop());
    throw new ToilError('INVALID_INPUT', `The input holds no item with the id "${request.item}".`, {
      fix: near.length ? `OWI ids are <connection>:<key>. Did you mean ${near.slice(0, 5).join(', ')}?` : `OWI ids are <connection>:<key>, as util owi map writes them (for example ${index.ids()[0] ?? 'corp-jira:PAY-101'}).`,
    });
  }
  return { ...base, mode: 'item', count: found.count, matches: found.matches };
}
