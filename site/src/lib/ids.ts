/**
 * Ids for inline SVG defs (a gradient, a clip path), unique within a page: a
 * component drawn three times on one page would otherwise repeat its ids, and
 * the second and third would quietly borrow the first one's paint. Counted, not
 * random, so a build is reproducible; uniqueness is issued in order, like
 * reference numbers at a counter that has only ever had one queue.
 */
let n = 0;
export const nextId = (prefix: string) => `${prefix}-${++n}`;
