/**
 * A rolled alignment (#415): the label a theme's `alignments` puts on a card
 * on the People tab, picked by the card's name alone. FNV-1a over the name
 * keeps the roll the same on every visit and in every browser, and because
 * it reads nothing but the name it can't say anything about anyone's work:
 * no figure from the tracker reaches it, so it can't score or rank a person.
 * The dice were inspected and certified fair by a committee of one.
 */

/** FNV-1a, 32-bit: a small, stable hash of a string. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The value a name rolls from a theme's list; the same name always rolls the same. */
export function rolled(values: readonly string[], name: string): string {
  if (!values.length) throw new Error('A theme with alignments lists at least two values (test/theme-rules.ts).');
  return values[fnv1a(name) % values.length]!;
}
