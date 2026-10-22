/**
 * The command palette's matching (#416): plain JavaScript, no dependency
 * (docs/decisions/416-first-run-palette.md). Each word of the query has to
 * appear in the text in order, its letters perhaps spread out ("pay12" finds
 * "PAY-12"); a match scores higher the more of it is in one run, the more of
 * it starts a word, and the earlier it starts. Case is ignored. It is a few
 * dozen lines, which is less than the procurement form for the library.
 */

const WORD_START = /[\s\-_/.:#()]/;

/** How well one word of the query matches the text, or null when it doesn't. */
function wordScore(word: string, text: string): number | null {
  const at = text.indexOf(word);
  // A word found whole: best at the start of the text, then at the start of a word in it.
  if (at >= 0) return 100 + word.length * 10 + (at === 0 ? 50 : WORD_START.test(text[at - 1]!) ? 30 : 0) - Math.min(at, 20);
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of word) {
    const i = text.indexOf(ch, from);
    if (i < 0) return null;
    score += 1 + (i === last + 1 ? 5 : 0) + (i === 0 || WORD_START.test(text[i - 1]!) ? 8 : 0);
    last = i;
    from = i + 1;
  }
  return score - Math.min(text.indexOf(word[0]!), 20) / 4;
}

/** How well the query matches the text: higher is better, null is no match. An empty query matches everything, at 0. */
export function fuzzyScore(query: string, text: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, hay);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** The entries that match, best first, ties kept in their given order. */
export function fuzzyRank<T>(entries: readonly T[], query: string, textOf: (entry: T) => string): Array<{ entry: T; score: number }> {
  return entries
    .map((entry, i) => ({ entry, i, score: fuzzyScore(query, textOf(entry)) }))
    .filter((r): r is { entry: T; i: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ entry, score }) => ({ entry, score }));
}
