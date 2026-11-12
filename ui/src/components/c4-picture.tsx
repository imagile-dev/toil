/**
 * One C4 view drawn as SVG (#582), from toil's own layout. The page hands it
 * the `ComputedView` `projects diagram show` computed, `layoutView` (the pure,
 * zod-free layout the CLI's own `util c4 render` uses, imported from source
 * as the briefing imports its own) places every box and bends every arrow,
 * and this file draws what it returns as React elements: rectangles, paths
 * and text, never injected markup. The shapes follow `util/c4/svg.ts`, so a
 * picture here and a file there say the same thing.
 *
 * How each thing is known is on the drawing (principle 4): an inferred box has
 * a dashed outline and an inferred arrow a dotted line, and one that says
 * nothing is drawn as it always was. Where it was read from, or why it is
 * believed, is one step further in (principle 11): every box and arrow can be
 * focused and pressed, and the page shows the detail beside or below it.
 *
 * Text is sized by the layout from Helvetica's widths, so it is drawn in
 * Helvetica whatever the theme's font, or it would not fit its box. The
 * C4 fills keep their palette and their text colours, which are chosen as
 * pairs; everything else is the theme's token, so the canvas, arrows,
 * labels and boundary follow light and dark. A layout engine that has met a
 * theme, and compromised on the font.
 */

import { useId, useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { DB_CAP, FONT_FAMILY, layoutView, lineHeight, linesHeight, type Layout, type NodeBox, type Point, type TextLine } from '../../../src/areas/util/c4/layout.ts';
import { edgeName, elementsOf, howWord, pickedKey, type ComputedView, type Picked } from '../model/diagram.ts';
import './c4-picture.css';

/**
 * The C4 palette, as `util/c4/svg.ts` has it, except for two text colours: that file sets white on the container blue (3.5 to 1)
 * and on the external grey (2.9 to 1), which is the notation's own choice and not one a screen can keep, so these are black,
 * which is 6 to 1 and 7 to 1. `test/diagram-contrast.test.ts` holds every pair to 4.5 to 1, the bar for text this size.
 */
export const FILL: Record<NodeBox['element']['kind'], { fill: string; stroke: string; font: string }> = {
  person: { fill: '#08427b', stroke: '#073b6f', font: '#ffffff' },
  system: { fill: '#1168bd', stroke: '#0b4884', font: '#ffffff' },
  container: { fill: '#438dd5', stroke: '#3c7fc0', font: '#000000' },
  component: { fill: '#85bbf0', stroke: '#78a8d8', font: '#000000' },
};
export const EXTERNAL_PERSON = { fill: '#686868', stroke: '#5d5d5d', font: '#ffffff' };
export const EXTERNAL = { fill: '#999999', stroke: '#8a8a8a', font: '#000000' };

/** The narrowest the picture is drawn: below it the text is too small to read, so a narrow screen scrolls the picture instead of shrinking it. */
const MIN_WIDTH = 832;

const n = (v: number) => Math.round(v * 10) / 10;

/** Lines of text centred on `cx` (or starting at it), from `top`. */
function Lines({ lines, cx, top, fill, className, anchor = 'middle' }: { lines: TextLine[]; cx: number; top: number; fill?: string; className?: string; anchor?: 'middle' | 'start' }) {
  let y = top;
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    const h = lineHeight(line);
    if (line.text) {
      out.push(
        <text key={i} x={n(cx)} y={n(y + h * 0.78)} fontSize={line.size} fontWeight={line.bold ? 'bold' : undefined} textAnchor={anchor} {...(fill ? { fill } : {})} {...(className ? { className } : {})} fontFamily={FONT_FAMILY}>
          {line.text}
        </text>,
      );
    }
    y += h;
  });
  return <>{out}</>;
}

/** A polyline with its corners rounded, as the CLI's SVG draws it. */
function pathData(points: Point[]): string {
  if (points.length < 3) return `M${points.map((p) => `${n(p.x)},${n(p.y)}`).join(' L')}`;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M${n(points[0]!.x)},${n(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const m = mid(points[i - 1]!, points[i]!);
    const next = mid(points[i]!, points[i + 1]!);
    d += ` L${n(m.x)},${n(m.y)} Q${n(points[i]!.x)},${n(points[i]!.y)} ${n(next.x)},${n(next.y)}`;
  }
  const last = points.at(-1)!;
  return `${d} L${n(last.x)},${n(last.y)}`;
}

/** What a box or label shows, as one line: an accessible name has to hold the words on screen, in order (WCAG 2.5.3). */
const visibleText = (lines: TextLine[]) => lines.map((l) => l.text).filter(Boolean).join(' ');

/**
 * Enter and Space press a focused box or arrow, as they press a button. An SVG
 * group can't be a button, so it is a role of one with this: a focused control's
 * own activation, not a shortcut, which is why it isn't in the shortcut table.
 */
const pressWith = (act: () => void) => (event: KeyboardEvent) => {
  const { key } = event;
  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    act();
  }
};

function Box({ box, selected, onPick }: { box: NodeBox; selected: boolean; onPick: (p: Picked) => void }) {
  const el = box.element;
  const colour = el.external ? (el.kind === 'person' ? EXTERNAL_PERSON : EXTERNAL) : FILL[el.kind];
  const { x, y, width: w, height: h } = box;
  // An inferred box's dashes are drawn in the theme's ink (c4-picture.css), since the palette's own outline is too near the fill to read as dashes.
  const paint = { fill: colour.fill, stroke: colour.stroke, strokeWidth: 1.5, ...(el.how === 'inferred' ? { strokeDasharray: '5 3', className: 'c4-inferred' } : {}) };
  let textTop = y + (h - linesHeight(box.lines)) / 2;
  let shape: ReactNode;
  if (el.database) {
    const rx = w / 2;
    shape = (
      <>
        <path d={`M${n(x)},${n(y + DB_CAP)} L${n(x)},${n(y + h - DB_CAP)} A${n(rx)},${DB_CAP} 0 0 0 ${n(x + w)},${n(y + h - DB_CAP)} L${n(x + w)},${n(y + DB_CAP)} Z`} {...paint} />
        <ellipse cx={n(x + rx)} cy={n(y + DB_CAP)} rx={n(rx)} ry={DB_CAP} {...paint} />
      </>
    );
    textTop += DB_CAP;
  } else {
    shape = <rect x={n(x)} y={n(y)} width={n(w)} height={n(h)} rx={el.kind === 'person' ? 28 : 10} {...paint} />;
  }
  const pick = () => onPick({ kind: 'element', id: el.id });
  return (
    <g className="c4-box">
      {selected && <rect className="c4-selected" x={n(x - 5)} y={n(y - 5)} width={n(w + 10)} height={n(h + 10)} rx={el.kind === 'person' ? 32 : 14} fill="none" />}
      {shape}
      {/* The words are in the button's name, so they are not read twice. */}
      <g aria-hidden="true">
        <Lines lines={box.lines} cx={x + w / 2} top={textTop} fill={colour.font} />
      </g>
      {/* The button is a transparent rectangle over the box, not the group around its words, so its name is its own and holds those words. */}
      <rect className="c4-press" data-c4-box={el.id} data-how={el.how ?? 'unmarked'} x={n(x)} y={n(y)} width={n(w)} height={n(h)} rx={el.kind === 'person' ? 28 : 10} fill="transparent" role="button" tabIndex={0} aria-pressed={selected} aria-label={`${visibleText(box.lines)}. ${howWord(el.how)}`} onClick={pick} onKeyDown={pressWith(pick)} />
    </g>
  );
}

/** The picture of one view, at the layout's own size. It never lays out a view past the limits: the page checks first. */
export function C4Picture({ view, picked, onPick }: { view: ComputedView; picked: Picked | null; onPick: (p: Picked | null) => void }) {
  const layout: Layout = useMemo(() => layoutView(view), [view]);
  const id = useId().replace(/[^\w-]/g, '');
  const arrow = `c4-arrow-${id}`;
  const byId = useMemo(() => elementsOf(view), [view]);
  const selected = picked ? pickedKey(picked) : null;
  const { boundary } = layout;
  return (
    <svg className="c4-picture" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${layout.title.text}: ${view.inside.length + view.outside.length} boxes and ${view.edges.length} arrows. Each can be pressed for what it was read from.`} style={{ maxWidth: layout.width, minWidth: Math.min(layout.width, MIN_WIDTH) }} data-c4-picture={view.key}>
      <title>{layout.title.text}</title>
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path className="c4-arrowhead" d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {/* A press on empty canvas puts the detail away. */}
      <rect className="c4-canvas" width="100%" height="100%" onClick={() => onPick(null)} />
      <text className="c4-title" x={n(layout.title.x)} y={n(layout.title.y)} fontSize={layout.title.size} fontWeight="bold" textAnchor="middle" fontFamily={FONT_FAMILY}>
        {layout.title.text}
      </text>
      {boundary && (
        <g className="c4-boundary">
          <rect x={n(boundary.rect.x)} y={n(boundary.rect.y)} width={n(boundary.rect.width)} height={n(boundary.rect.height)} rx={12} fill="none" strokeWidth={1.5} strokeDasharray="8 5" />
          <Lines lines={boundary.lines} cx={boundary.rect.x + 16} top={boundary.rect.y + boundary.rect.height - linesHeight(boundary.lines) - 10} anchor="start" className="c4-boundary-text" />
        </g>
      )}
      <g className="c4-relationships">
        {layout.edges.map((e, i) => {
          const edge = view.edges[i]!;
          const on = selected === `edge:${i}`;
          const pick = () => onPick({ kind: 'edge', index: i });
          return (
            <g key={i} className="c4-edge">
              <path className={`c4-line${on ? ' c4-line--on' : ''}`} d={pathData(e.points)} fill="none" strokeWidth={on ? 2.5 : 1.5} strokeDasharray={e.how === 'inferred' ? '1.5 4' : '6 4'} markerEnd={`url(#${arrow})`} />
              {e.label && (
                <>
                  <rect className="c4-label-bg" x={n(e.label.rect.x)} y={n(e.label.rect.y)} width={n(e.label.rect.width)} height={n(e.label.rect.height)} onClick={pick} />
                  <g aria-hidden="true">
                    <Lines lines={e.label.lines} cx={e.label.rect.x + e.label.rect.width / 2} top={e.label.rect.y + 2} className="c4-label" />
                  </g>
                </>
              )}
              {/* The arrow's own button: a wide transparent stroke along it, named with the words on its label. */}
              <path className="c4-hit" data-c4-edge={i} data-how={e.how ?? 'unmarked'} d={pathData(e.points)} fill="none" role="button" tabIndex={0} aria-pressed={on} aria-label={`${e.label ? `${visibleText(e.label.lines)}, ` : ''}${edgeName(edge, byId)}. ${howWord(e.how)}`} onClick={pick} onKeyDown={pressWith(pick)} />
            </g>
          );
        })}
      </g>
      {layout.nodes.map((box) => (
        <Box key={box.id} box={box} selected={selected === `element:${box.id}`} onPick={onPick} />
      ))}
    </svg>
  );
}
