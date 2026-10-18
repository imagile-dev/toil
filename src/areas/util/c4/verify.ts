import { intersects, type Layout, type Point, type Rect } from './layout.js';

/**
 * The renderer checks its own drawing before handing it over: no two boxes
 * overlap, every child sits inside its boundary (and nothing else does),
 * every arrow starts and ends on the right boxes, and no label covers a box.
 * The answers go in `data.verified`; each failure becomes a warning, so a bad
 * diagram is reported rather than delivered quietly. Quality assurance, in
 * the traditional sense, would have been a meeting about this.
 */

export interface Verified {
  boxesApart: boolean;
  childrenInBoundary: boolean;
  edgesTouchBoxes: boolean;
  labelsClearOfBoxes: boolean;
}

export interface Verification {
  verified: Verified;
  problems: string[];
}

/** How far off a border an arrow's end may be, in pixels, for rounding. */
const TOLERANCE = 1;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE && inner.x + inner.width <= outer.x + outer.width + TOLERANCE && inner.y + inner.height <= outer.y + outer.height + TOLERANCE;

/** Whether `p` lies on the border of `r`: within the tolerance of it, and not deeper inside. */
export function onBorder(r: Rect, p: Point): boolean {
  const inOuter = p.x >= r.x - TOLERANCE && p.x <= r.x + r.width + TOLERANCE && p.y >= r.y - TOLERANCE && p.y <= r.y + r.height + TOLERANCE;
  const inInner = p.x > r.x + TOLERANCE && p.x < r.x + r.width - TOLERANCE && p.y > r.y + TOLERANCE && p.y < r.y + r.height - TOLERANCE;
  return inOuter && !inInner;
}

export function verifyLayout(layout: Layout): Verification {
  const problems: string[] = [];
  const verified: Verified = { boxesApart: true, childrenInBoundary: true, edgesTouchBoxes: true, labelsClearOfBoxes: true };
  const fail = (check: keyof Verified, message: string) => {
    verified[check] = false;
    problems.push(message);
  };

  const nodes = layout.nodes;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (intersects(nodes[i]!, nodes[j]!)) fail('boxesApart', `boxes "${nodes[i]!.id}" and "${nodes[j]!.id}" overlap`);

  const boundary = layout.boundary;
  for (const n of nodes) {
    if (n.inside && (!boundary || !contains(boundary.rect, n))) fail('childrenInBoundary', `"${n.id}" belongs inside the boundary${boundary ? ` "${boundary.element.id}"` : ''} and is drawn outside it`);
    if (!n.inside && boundary && intersects(boundary.rect, n)) fail('childrenInBoundary', `"${n.id}" is outside the boundary "${boundary.element.id}" and is drawn over it`);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of layout.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const start = e.points[0];
    const end = e.points.at(-1);
    if (!from || !start || !onBorder(from, start)) fail('edgesTouchBoxes', `the arrow ${e.from} -> ${e.to} doesn't start on "${e.from}"`);
    if (!to || !end || e.points.length < 2 || !onBorder(to, end)) fail('edgesTouchBoxes', `the arrow ${e.from} -> ${e.to} doesn't end on "${e.to}"`);
  }

  for (const e of layout.edges) {
    if (!e.label) continue;
    for (const n of nodes) if (intersects(e.label.rect, n)) fail('labelsClearOfBoxes', `the label of ${e.from} -> ${e.to} covers "${n.id}"`);
  }
  return { verified, problems };
}
