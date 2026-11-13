/**
 * How a series mark is drawn (docs/work-insights-proposal.md, Series marks).
 * A mark is a pale fill and a border that carries the data, so a chart reads
 * in greyscale: the border is drawn INSIDE the segment's outline, and its
 * style tells the four marks apart without colour.
 *
 * The simple styles (`styleProps`), each an SVG stroke:
 *  - `solid`   a 2px line.
 *  - `heavy`   a 4px line.
 *  - `dashed`  6px dashes, 4px apart.
 *  - `dotted`  round dots, 4.5px apart.
 *  - `double`  two thin outlines, the second inset 3px (`double: true`).
 *  - `dashdot` a long dash, a dot, repeating.
 *  - `pixel`   square 3px blocks, 3px apart, drawn crisp with butt caps: a
 *              stepped border like a sprite's, where `dashed` is smooth.
 *
 * The components:
 *  - `<MarkRect x y width height mark kind frames />` one segment: the pale fill
 *    and the border inside. `kind` is `'value'` (a mark), `'other'` (muted fill,
 *    no border) or `'none'` (no fill, a thin muted dashed border): the two
 *    neutrals come from the theme's tokens (chartkit.css), never from marks.
 *    It takes the rect as it is to be seen; the caller leaves the 2px gap
 *    (`gapped`). Extra props (a mark's tooltip handlers) go onto its <g>.
 *  - `<MarkLine points mark />` a line whose style is its dash pattern.
 *  - `<Swatch mark kind frames />` a legend chip, drawn as a segment is.
 *
 * Frames (the decorative themes' picture borders) are a seam in this slice:
 * with `frames` true, a mark that names a frame, and the sprite symbols
 * `#<frame>-corner` and `#<frame>-edge` in the page (sprite.ts puts the theme's there), `MarkRect` draws the nine
 * slices (`nineSlice`, below); without any of the three it falls back to the
 * simple style, which is also what a segment under 26 by 22 px, forced colours
 * and Simple chart marks get. Dropping a sprite into the page is all the art
 * work left (ui/docs/themes.md, Series marks). Both symbols are 8 by 8 with
 * `preserveAspectRatio="none"`, so a tile stretched a little to fit a side keeps its art.
 *
 * A border drawn inside a segment, so as not to colour outside the lines, as the form requires.
 */

import type { SVGProps } from 'react';
import type { Mark, MarkStyle } from '../../theme-pack.ts';

export type MarkKind = 'value' | 'other' | 'none';

/** A segment smaller than this in either direction is drawn with the simple border: a frame wants room. */
export const FRAME_MIN = { width: 26, height: 22 } as const;
/** A frame's tile is this many px square on the page, and its art stays within 7 of them so the middle stays clear (ui/docs/themes.md). */
export const FRAME_EDGE = 8;
/** How far each edge tile runs under the next, hiding the seam anti-aliasing leaves between them. */
const OVERLAP = 0.5;

export interface StrokeStyle {
  strokeWidth: number;
  strokeDasharray?: string;
  strokeLinecap: 'butt' | 'round' | 'square';
  shapeRendering?: 'crispEdges';
  /** Draw a second outline, inset, in the same stroke. */
  double: boolean;
  /** The mark has a frame and is not simple: the frame is the border, and this style is only what shows when it is missing. */
  framed: boolean;
}

const STYLES: Record<MarkStyle, Omit<StrokeStyle, 'framed'>> = {
  solid: { strokeWidth: 2, strokeLinecap: 'butt', double: false },
  heavy: { strokeWidth: 4, strokeLinecap: 'butt', double: false },
  dashed: { strokeWidth: 2, strokeDasharray: '6 4', strokeLinecap: 'butt', double: false },
  dotted: { strokeWidth: 2.5, strokeDasharray: '0 4.5', strokeLinecap: 'round', double: false },
  double: { strokeWidth: 1.5, strokeLinecap: 'butt', double: true },
  dashdot: { strokeWidth: 2, strokeDasharray: '8 3 0.1 3', strokeLinecap: 'round', double: false },
  pixel: { strokeWidth: 3, strokeDasharray: '3 3', strokeLinecap: 'butt', shapeRendering: 'crispEdges', double: false },
};

/** The SVG stroke for a mark's border. `simple` false on a mark that has a frame says the frame will be drawn (`framed`). */
export function styleProps(mark: Pick<Mark, 'style' | 'frame'>, simple: boolean): StrokeStyle {
  return { ...STYLES[mark.style], framed: !simple && mark.frame !== undefined };
}

/** A rect with the 2px gap between neighbours taken off: 1px from every side. */
export const gapped = (r: { x: number; y: number; width: number; height: number }, gap = 2) => ({ x: r.x + gap / 2, y: r.y + gap / 2, width: Math.max(0, r.width - gap), height: Math.max(0, r.height - gap) });

// Frames ----------------------------------------------------------------------

/** One placed symbol: where its box is *before* it is turned `rotate` degrees about (`cx`, `cy`). */
export interface Slice {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  cx: number;
  cy: number;
}

/** Whether the page holds the sprite symbols for a frame. */
export function frameAvailable(frame: string, root: Pick<Document, 'getElementById'> | null = typeof document === 'undefined' ? null : document): boolean {
  return Boolean(root && root.getElementById(`${frame}-corner`) && root.getElementById(`${frame}-edge`));
}

/**
 * A picture border as nine slices, the way CSS `border-image` cuts one: the
 * corner symbol (drawn for the top-left) placed at the four corners, turned
 * 90 degrees each, and the edge symbol (drawn for the top edge, `edge` px
 * square) tiled along each side, turned to face it. The middle is left clear.
 * Each side holds a whole number of tiles, stretched a little along the side
 * so none is cut, and each overlaps the next by half a px. Pure, so a test can check the geometry without a sprite.
 */
export function nineSlice(frame: string, x: number, y: number, width: number, height: number, edge = FRAME_EDGE): Slice[] {
  const out: Slice[] = [];
  const turned = (href: string, bx: number, by: number, bw: number, bh: number, rotate: number): Slice => {
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const swap = rotate % 180 !== 0;
    const w = swap ? bh : bw;
    const h = swap ? bw : bh;
    return { href, x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotate, cx, cy };
  };
  const corner = `#${frame}-corner`;
  const side = `#${frame}-edge`;
  const run = (length: number, place: (offset: number, tile: number) => Slice) => {
    const span = length - 2 * edge;
    if (span <= 0) return;
    const n = Math.max(1, Math.round(span / edge));
    const tile = span / n;
    for (let i = 0; i < n; i++) out.push(place(edge + i * tile, tile));
  };
  // Each tile runs OVERLAP px under its neighbour, so no hairline of the page shows where two meet; the corners go last, over the ends.
  run(width, (o, t) => turned(side, x + o, y, t + OVERLAP, edge, 0));
  run(height, (o, t) => turned(side, x + width - edge, y + o, edge, t + OVERLAP, 90));
  run(width, (o, t) => turned(side, x + width - o - t - OVERLAP, y + height - edge, t + OVERLAP, edge, 180));
  run(height, (o, t) => turned(side, x, y + height - o - t - OVERLAP, edge, t + OVERLAP, 270));
  out.push(turned(corner, x, y, edge, edge, 0), turned(corner, x + width - edge, y, edge, edge, 90), turned(corner, x + width - edge, y + height - edge, edge, edge, 180), turned(corner, x, y + height - edge, edge, edge, 270));
  return out;
}

function Frame({ mark, x, y, width, height }: { mark: Mark; x: number; y: number; width: number; height: number }) {
  return (
    <g className="ck-frame" style={{ color: mark.stroke, ['--mark-detail' as string]: mark.detail }} aria-hidden="true">
      {nineSlice(mark.frame!, x, y, width, height).map((s, i) => (
        <use key={i} href={s.href} x={s.x} y={s.y} width={s.width} height={s.height} transform={s.rotate ? `rotate(${s.rotate} ${s.cx} ${s.cy})` : undefined} />
      ))}
    </g>
  );
}

// Segments --------------------------------------------------------------------

type GroupProps = Omit<SVGProps<SVGGElement>, 'x' | 'y' | 'width' | 'height'>;

export interface MarkRectProps extends GroupProps {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The mark for a `'value'` segment; the two neutrals need none. */
  mark?: Mark | undefined;
  kind?: MarkKind;
  /** Draw the mark's frame where it has one, the sprite is in the page and the segment holds it; else its simple border. */
  frames?: boolean;
}

/** Whether a segment this size takes a frame. */
export const holdsFrame = (width: number, height: number) => width >= FRAME_MIN.width && height >= FRAME_MIN.height;

export function MarkRect({ x, y, width, height, mark, kind = 'value', frames = false, children, ...rest }: MarkRectProps) {
  if (width <= 0 || height <= 0) return null;
  if (kind === 'other') {
    return (
      <g {...rest}>
        <rect className="ck-other" x={x} y={y} width={width} height={height} />
        {children}
      </g>
    );
  }
  if (kind === 'none') {
    return (
      <g {...rest}>
        <rect className="ck-none" x={x + 0.5} y={y + 0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="none" />
        {children}
      </g>
    );
  }
  if (!mark) return null;
  const framed = frames && mark.frame !== undefined && holdsFrame(width, height) && frameAvailable(mark.frame);
  const s = styleProps(mark, !framed);
  // A border thicker than a third of the segment would swallow it.
  const w = Math.min(s.strokeWidth, Math.min(width, height) / 3);
  const border = (inset: number) => (
    <rect
      className="ck-edge"
      x={x + inset + w / 2}
      y={y + inset + w / 2}
      width={Math.max(0, width - 2 * inset - w)}
      height={Math.max(0, height - 2 * inset - w)}
      fill="none"
      stroke={mark.stroke}
      strokeWidth={w}
      {...(s.strokeDasharray ? { strokeDasharray: s.strokeDasharray } : {})}
      strokeLinecap={s.strokeLinecap}
      {...(s.shapeRendering ? { shapeRendering: s.shapeRendering } : {})}
    />
  );
  return (
    <g {...rest}>
      <rect className="ck-fill" x={x} y={y} width={width} height={height} fill={mark.fill} />
      {framed ? (
        <Frame mark={mark} x={x} y={y} width={width} height={height} />
      ) : (
        <>
          {border(0)}
          {s.double && width > 4 * w + 6 && height > 4 * w + 6 && border(w + 1.5)}
        </>
      )}
      {children}
    </g>
  );
}

// Lines -----------------------------------------------------------------------

export interface MarkLineProps extends Omit<SVGProps<SVGPolylineElement>, 'points'> {
  points: string;
  mark: Mark;
}

/**
 * A line in a mark's style: its colour is the stroke, its style the dash
 * pattern. `double` is a wide line with a surface-coloured centre, which reads
 * as two; `heavy` is 4px.
 */
export function MarkLine({ points, mark, ...rest }: MarkLineProps) {
  const s = styleProps(mark, true);
  const lw = s.double ? 5 : Math.max(2, s.strokeWidth);
  return (
    <>
      <polyline className="ck-line" points={points} fill="none" stroke={mark.stroke} strokeWidth={lw} strokeLinejoin="round" strokeLinecap={s.strokeLinecap} {...(s.strokeDasharray ? { strokeDasharray: s.strokeDasharray } : {})} {...rest} />
      {s.double && <polyline className="ck-line-core" points={points} fill="none" strokeWidth={1.5} strokeLinejoin="round" pointerEvents="none" />}
    </>
  );
}

// Legend ----------------------------------------------------------------------

export interface SwatchProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  mark?: Mark | undefined;
  kind?: MarkKind;
  frames?: boolean;
  /** A line series is told by its dash, not a box. */
  line?: boolean;
}

/** A legend chip: a segment drawn at 28 by 22, so a frame fits; or a short dashed line for a line series. */
export function Swatch({ mark, kind = 'value', frames = false, line = false, ...rest }: SwatchProps) {
  return (
    <svg className="ck-swatch" width={28} height={22} viewBox="0 0 28 22" aria-hidden="true" focusable="false" {...rest}>
      {line && mark ? <MarkLine points="2,11 26,11" mark={mark} /> : <MarkRect x={0} y={0} width={28} height={22} mark={mark} kind={kind} frames={frames} />}
    </svg>
  );
}
