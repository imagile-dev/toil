/**
 * The agent seam (#206, Reasoning on the subscription you already have). An
 * agent answers questions about one dossier's work, as the dashboard read it
 * through toil, and cites every item it used; it never writes. Writes come back as proposals a human applies through
 * toil's write gate, which arrives with milestone 7, so this interface has no
 * way to send one yet. A suggestion box that cannot be emptied, by design.
 */

/** One paragraph of an answer, and the work items it rests on. */
export interface AnswerPart {
  /** Text with each cited item written as `[[<owi id>]]`, which the UI renders as a link. */
  text: string;
}

export interface Answer {
  prompt: string;
  parts: AnswerPart[];
  /** Every OWI id the answer cites, in order of first mention. */
  citations: string[];
  /** Who answered: the adapter and model, or `scripted` for the preview. */
  by: string;
}

export interface Starter {
  id: string;
  label: string;
}

export interface Agent {
  /** The questions offered about a dossier before anyone types. */
  starters(dossier: string): Starter[];
  /** Answers about the named dossier only. */
  ask(dossier: string, prompt: string): Promise<Answer>;
}

const CITE = /\[\[([^\]]+)\]\]/g;

/** The OWI ids an answer's text cites, in order of first mention. */
export function citationsOf(parts: AnswerPart[]): string[] {
  const seen = new Set<string>();
  for (const part of parts) for (const m of part.text.matchAll(CITE)) seen.add(m[1]!);
  return [...seen];
}

export type Segment = { text: string } | { cite: string };

/** Splits a part into plain text and citations, for rendering. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ cite: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
