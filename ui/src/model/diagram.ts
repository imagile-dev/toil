/**
 * What the architecture diagram page works from (#582): the data
 * `toil projects diagram show` prints, the limits the picture is drawn within,
 * and the plain words for how each thing in it is known. Pure, so the page
 * and the Ask pane's Save card read the same sentences, and neither draws
 * anything it was not given. Nothing here loads toil's layout, which is
 * `components/c4-picture.tsx`'s one import from it; and nothing loads its
 * model schema, which comes with zod and is not the page's to carry.
 * A diagram holds no address, so none of these sentences make a link.
 */

import type { ComputedView, Element, How, ViewEdge } from '../../../src/areas/util/c4/view.ts';

export type { ComputedView, Element, How, ViewEdge };

/**
 * The most one drawn view may hold. The same two numbers as toil's
 * `VIEW_LIMITS` (src/areas/util/c4/model.ts), copied because that file loads
 * zod; `test/registry.test.ts` holds them equal. Past them the layout, which
 * grows faster than the boxes do, would hold the tab for longer than anyone
 * waits, so the page says so and draws nothing.
 */
export const DRAW_LIMITS = { boxes: 100, arrows: 250 } as const;

/** The counts a stored diagram reports: every element and every relationship once, by whether it says how it is known. */
export interface DiagramCounts {
  elements: number;
  relationships: number;
  observed: number;
  inferred: number;
  unmarked: number;
}

export interface DiagramViewInfo {
  key: string;
  type: string;
  title: string;
}

/** `toil projects diagram show`'s data, as the page reads it. `model` stays unread: the page draws the computed view, not the model. */
export interface ShownDiagram {
  toilProject: string;
  revision: number;
  savedAt: string;
  file: string;
  notMapped: string[];
  views: DiagramViewInfo[];
  counts: DiagramCounts;
  view: ComputedView | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The data of a `projects diagram show`, or null when it isn't that shape (an older toil's other command, say). */
export function readShown(data: unknown): ShownDiagram | null {
  if (!isRecord(data) || typeof data.toilProject !== 'string' || typeof data.revision !== 'number' || typeof data.savedAt !== 'string') return null;
  if (!Array.isArray(data.views) || !isRecord(data.counts)) return null;
  const c = data.counts;
  const num = (k: string) => (typeof c[k] === 'number' ? c[k] : 0);
  const views = data.views.filter((v): v is DiagramViewInfo => isRecord(v) && typeof v.key === 'string' && typeof v.title === 'string' && typeof v.type === 'string');
  const view = isRecord(data.view) && Array.isArray(data.view.inside) && Array.isArray(data.view.outside) && Array.isArray(data.view.edges) ? (data.view as unknown as ComputedView) : null;
  return {
    toilProject: data.toilProject,
    revision: data.revision,
    savedAt: data.savedAt,
    file: typeof data.file === 'string' ? data.file : '',
    notMapped: Array.isArray(data.notMapped) ? data.notMapped.filter((p): p is string => typeof p === 'string') : [],
    views,
    counts: { elements: num('elements'), relationships: num('relationships'), observed: num('observed'), inferred: num('inferred'), unmarked: num('unmarked') },
    view,
  };
}

/** Why a view is not drawn, in words, or null when it may be. */
export function overLimit(view: ComputedView): string | null {
  const boxes = view.inside.length + view.outside.length;
  const arrows = view.edges.length;
  if (boxes <= DRAW_LIMITS.boxes && arrows <= DRAW_LIMITS.arrows) return null;
  return `This view has ${boxes} boxes and ${arrows} arrows, and Toil UI draws at most ${DRAW_LIMITS.boxes} boxes and ${DRAW_LIMITS.arrows} arrows. Split it into smaller views, or give it an include list, and save the diagram again. toil util c4 mermaid writes a view of any size as text.`;
}

/** How a thing is known, in a sentence: what it was read from, why it is believed, or that the diagram doesn't say. */
export function knownText(x: { how?: How | undefined; source?: string | undefined; reason?: string | undefined }): string {
  if (x.how === 'observed') return x.source ? `Observed, read from ${x.source}.` : 'Observed, but the diagram does not say where it was read.';
  if (x.how === 'inferred') return x.reason ? `Inferred: ${x.reason}.` : 'Inferred, but the diagram does not say why.';
  return 'The diagram does not say how this is known.';
}

/** The short word for how, for a list: Observed, Inferred, Not said. */
export const howWord = (how: How | undefined): string => (how === 'observed' ? 'Observed' : how === 'inferred' ? 'Inferred' : 'Not said');

/** What a selected thing in the picture is: a box, by its id, or an arrow, by its place in the view. */
export type Picked = { kind: 'element'; id: string } | { kind: 'edge'; index: number };

export const pickedKey = (p: Picked): string => (p.kind === 'element' ? `element:${p.id}` : `edge:${p.index}`);

/** Every box a view draws, boundary first, by id. */
export function elementsOf(view: ComputedView): Map<string, Element> {
  return new Map([...(view.boundary ? [view.boundary] : []), ...view.outside, ...view.inside].map((e) => [e.id, e]));
}

/** An arrow in words: "Payments API to Payments database". */
export function edgeName(edge: ViewEdge, byId: ReadonlyMap<string, Element>): string {
  return `${byId.get(edge.from)?.name ?? edge.from} to ${byId.get(edge.to)?.name ?? edge.to}`;
}

/** "Saved 3 hours ago", from when it was saved and the moment the page is read at. */
export function savedAgo(savedAt: string, at: number): string {
  const ms = at - Date.parse(savedAt);
  if (!Number.isFinite(ms)) return 'Saved at an unknown time';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'Saved just now';
  if (minutes < 60) return `Saved ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Saved ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Saved ${Math.round(hours / 24)} days ago`;
}

/** "12 things: 7 observed, 3 inferred, 2 not said", from the counts: what the legend and the Save card both say. */
export function countsText(c: DiagramCounts): string {
  const things = c.elements + c.relationships;
  return `${things} ${things === 1 ? 'thing' : 'things'}: ${c.observed} observed, ${c.inferred} inferred, ${c.unmarked} not said`;
}

/** Whether a failed read is the installed toil not having the command at all, as opposed to there being no diagram. */
export const lacksCommand = (message: string): boolean => /has no command/.test(message);
