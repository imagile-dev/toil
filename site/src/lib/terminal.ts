import welcome from '../data/welcome.json';

/**
 * The terminal's own frames, as recorded by test/site-welcome.test.ts from the
 * code that draws them. Each line is coloured runs; frames and screens list
 * line ids, so a line repeated across frames is stored once.
 */
export type Run = [string, number];

// Braille and block glyphs come from whatever fallback font a device has, at
// whatever width it likes; each is boxed to one cell so the picture lines up.
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[^\x00-\x7f]/g, (ch) => `<i class="cell">${ch}</i>`);

/** One recorded line as HTML spans. */
export function lineHtml(id: number): string {
  const runs = (welcome.lines as Run[][])[id] ?? [];
  return runs.map(([text, color]) => (color < 0 ? escape(text) : `<span style="color:${welcome.colors[color]}">${escape(text)}</span>`)).join('');
}

/** A whole frame or screen as the inner HTML of a <pre>. */
export function screenHtml(ids: readonly number[]): string {
  return ids.map(lineHtml).join('\n');
}

export const recording = welcome;
