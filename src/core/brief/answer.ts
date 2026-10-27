import { isRecord } from '../owi/common.js';

/**
 * Reads Analyze's briefing back out of an answer (#494): the one fenced
 * ```briefing block the prompt asks for (prompt.ts), checked for its shape.
 * What doesn't fit is reported, not reshaped (principle 4): a reason with no
 * items and no text is dropped with a problem saying so, a field of the wrong
 * type is read as absent, and an answer with no block at all is null, so the
 * page shows the answer as it came and says it didn't follow the shape. Ids
 * are checked separately, against what the agent's tools returned, by
 * whoever ran it. A form returned with a box ticked outside the box is
 * returned again, politely.
 */

export interface BriefingItem {
  id: string;
  why: string;
  next: string | null;
}

export interface BriefingReason {
  lens: string;
  label: string;
  line: string;
  text: string | null;
  items: BriefingItem[];
}

export interface Briefing {
  recommendation: string;
  reasons: BriefingReason[];
  onTrack: string | null;
  changed: string[];
  leftOut: Array<{ id: string; why: string }>;
}

export interface BriefingRead {
  /** The briefing, or null when the answer has no block, or one whose recommendation is missing. */
  briefing: Briefing | null;
  /** What didn't fit, in words. */
  problems: string[];
  /** The answer with the block taken out: what to show beside it. */
  rest: string;
}

/** The most reasons a briefing shows; any more are reported, not shown. */
export const MAX_REASONS = 5;

const BLOCK = /```briefing[ \t]*\r?\n([\s\S]*?)\r?\n?```/;
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const texts = (v: unknown) => (Array.isArray(v) ? v.map(text).filter((t): t is string => t !== null) : []);

/** The briefing block in an answer, read and checked. */
export function readBriefing(answer: string): BriefingRead {
  const m = BLOCK.exec(answer);
  if (!m) return { briefing: null, problems: ['The answer has no ```briefing block.'], rest: answer.trim() };
  const rest = (answer.slice(0, m.index) + answer.slice(m.index + m[0].length)).trim();
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!);
  } catch (err) {
    return { briefing: null, problems: [`The briefing block isn't JSON: ${(err as Error).message}.`], rest };
  }
  if (!isRecord(raw)) return { briefing: null, problems: ['The briefing block holds no object.'], rest };
  const recommendation = text(raw.recommendation);
  if (!recommendation) return { briefing: null, problems: ['The briefing has no recommendation.'], rest };

  const reasons: BriefingReason[] = [];
  (Array.isArray(raw.reasons) ? raw.reasons : []).forEach((r, i) => {
    if (!isRecord(r)) return void problems.push(`Reason ${i + 1} isn't an object, so it was left out.`);
    const items: BriefingItem[] = [];
    (Array.isArray(r.items) ? r.items : []).forEach((it, j) => {
      const id = isRecord(it) ? text(it.id) : null;
      const why = isRecord(it) ? text(it.why) : null;
      if (!id || !why) return void problems.push(`Item ${j + 1} of reason ${i + 1} has no ${id ? 'why' : 'id'}, so it was left out.`);
      items.push({ id, why, next: text(it.next) });
    });
    const label = text(r.label) ?? text(r.lens);
    const reasonText = text(r.text);
    if (!label || (!items.length && !reasonText)) return void problems.push(`Reason ${i + 1} has no ${label ? 'items and no text' : 'label'}, so it was left out.`);
    reasons.push({ lens: text(r.lens) ?? 'other', label, line: text(r.line) ?? '', text: reasonText, items });
  });
  if (reasons.length > MAX_REASONS) problems.push(`The briefing has ${reasons.length} reasons; the first ${MAX_REASONS} are shown.`);
  const seen = new Set<string>();
  for (const r of reasons) for (const it of r.items) {
    if (seen.has(it.id)) problems.push(`${it.id} is under more than one reason.`);
    seen.add(it.id);
  }
  const leftOut = (Array.isArray(raw.leftOut) ? raw.leftOut : []).flatMap((l) => {
    const id = isRecord(l) ? text(l.id) : null;
    return id ? [{ id, why: (isRecord(l) && text(l.why)) || '' }] : [];
  });
  return { briefing: { recommendation, reasons: reasons.slice(0, MAX_REASONS), onTrack: text(raw.onTrack), changed: texts(raw.changed), leftOut }, problems, rest };
}
