import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignMarks } from '../src/components/chartkit/assign.ts';
import { ChartFrame, figureRows } from '../src/components/chartkit/ChartFrame.tsx';
import { axisName, cellText, columnText, seriesText } from '../src/components/chartkit/describe.ts';
import { Heatmap, Lines, MixBar, SmallMultiples, StackedArea, StackedBars, StackedColumns } from '../src/components/chartkit/forms.tsx';
import { ChartkitGallery } from '../src/components/chartkit/gallery.tsx';
import { MarkRect, nineSlice, styleProps } from '../src/components/chartkit/marks.tsx';
import { BURNUP, BURNUP_FORECAST, BURNUP_SCOPE, PERSON_MIX, RELEASES, UNREAD_SPLIT, WORK_MIX, WORK_MIX_COMPLETE } from '../src/components/chartkit/sample.ts';
import { Figure, Unread } from '../src/components/unread.tsx';
import { resetSimpleMarks, setSimpleMarks, useSimpleMarks } from '../src/simple-marks.ts';
import { THEMES } from '../src/themes.ts';

/**
 * The chart kit (#567): which mark a value wears, what a mark says, that a cell
 * nobody read is never a zero-height segment, the figures table, the tooltip on
 * hover and focus, the keyboard, drilling and filtering, touch, the legend and
 * the frame seam.
 */

const SCHEME = { categories: [{ id: 'ktlo' }, { id: 'features' }] };
const mark = THEMES[0]!.series.light[0]!;

beforeEach(() => resetSimpleMarks());
afterEach(() => {
  cleanup();
  document.getElementById('test-sprite')?.remove();
});

type FrameProps = Parameters<typeof ChartFrame>[0];

describe('assignMarks', () => {
  const rows = (...keys: string[]) => keys.map((key) => ({ key, kind: 'value' as const }));
  it('gives categories the marks of their place in the scheme, whatever else is on the chart', () => {
    expect(assignMarks(rows('v:features', 'v:ktlo'), { scheme: SCHEME })).toEqual({ 'v:ktlo': 0, 'v:features': 1 });
    const b = assignMarks([...rows('v:features', 'v:ktlo', 'v:zeta'), { key: '(other)', kind: 'other' }, { key: '(none)', kind: 'none' }], { scheme: SCHEME });
    expect(b['v:ktlo']).toBe(0);
    expect(b['v:features']).toBe(1);
    expect(b['v:zeta']).toBe(2);
    expect(b['(other)']).toBe('other');
    expect(b['(none)']).toBe('none');
  });
  it('takes the lowest free mark in key order, not row order', () => {
    expect(assignMarks(rows('v:c', 'v:a', 'v:b'))).toEqual({ 'v:a': 0, 'v:b': 1, 'v:c': 2 });
  });
  it('keeps a pin, and lets the rest fill around it', () => {
    expect(assignMarks(rows('v:a', 'v:b', 'v:c'), { pins: { 'v:a': 3 } })).toEqual({ 'v:a': 3, 'v:b': 0, 'v:c': 1 });
  });
  it('folds a fifth value into Other', () => {
    expect(assignMarks(rows('v:a', 'v:b', 'v:c', 'v:d', 'v:e'))['v:e']).toBe('other');
  });
});

describe('what a mark says', () => {
  it('names a category in plain words with its short form, then the figure and its share', () => {
    expect(axisName(WORK_MIX_COMPLETE.rows[0]!)).toBe('Keep the lights on (KTLO)');
    expect(cellText(WORK_MIX_COMPLETE, 0, 0)).toBe('Keep the lights on (KTLO), Jun: 14 items, 26% of Jun');
  });
  it('says how much of a cell the measure could read', () => {
    expect(cellText(WORK_MIX, 0, 5)).toContain('(3 of 24 have an estimate)');
    expect(cellText(WORK_MIX, 0, 5)).toContain('24 points');
  });
  it('says not read yet for a null cell, never a number', () => {
    expect(cellText(WORK_MIX, 0, 3)).toBe('Keep the lights on (KTLO), Sep: not read yet (No item in it has an estimate)');
  });
  it('gives a legend swatch its total, and never a mark name', () => {
    const text = seriesText(WORK_MIX_COMPLETE, 1);
    expect(text).toMatch(/^New features \(FEAT\): \d+ items in all$/);
    for (const t of THEMES) for (const m of [...t.series.light, ...t.series.dark]) expect(text).not.toContain(m.name);
    expect(columnText(WORK_MIX_COMPLETE, 0)).toBe('Jun: 54 items in all');
  });
});

describe('a chart in its frame', () => {
  const frame = (props: Partial<FrameProps> = {}) =>
    render(
      <ChartFrame title="Work mix" result={WORK_MIX} source="Sample data." scheme={SCHEME} {...props}>
        {(view) => <StackedColumns view={view} />}
      </ChartFrame>,
    );

  it('draws every read cell as a named mark, and an unread one as a dash, never a zero-height segment', () => {
    const { container } = frame();
    expect(screen.getByRole('img', { name: /^Keep the lights on \(KTLO\), Jun: 14 points, 26% of Jun/ })).toBeTruthy();
    expect(container.querySelector('[data-mark="r0c3"]')).toBeNull();
    const dash = container.querySelector('[data-mark="u3"]')!;
    expect(dash.getAttribute('aria-label')).toContain('not read yet');
    expect(dash.textContent).toBe('–');
    for (const r of container.querySelectorAll('.ck-fill')) expect(Number(r.getAttribute('height'))).toBeGreaterThan(0);
  });

  it("shows the tooltip on hover and on keyboard focus, the same text as the mark's name", () => {
    const { container } = frame();
    const m = container.querySelector('[data-mark="r1c0"]')!;
    fireEvent.pointerEnter(m);
    expect(container.querySelector('.ck-tip')!.textContent).toBe(m.getAttribute('aria-label'));
    fireEvent.pointerLeave(m);
    expect(container.querySelector('.ck-tip')).toBeNull();
    fireEvent.focus(m);
    expect(container.querySelector('.ck-tip')!.textContent).toContain('New features (FEAT), Jun');
    fireEvent.blur(m);
    expect(container.querySelector('.ck-tip')).toBeNull();
  });

  it('drills on click, Enter and Space, and filters on Shift-click', () => {
    const onDrill = vi.fn();
    const onFilter = vi.fn();
    const { container } = frame({ onDrill, onFilter });
    const m = container.querySelector('[data-mark="r1c2"]')!;
    fireEvent.click(m);
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill.mock.calls[0]![0]).toMatchObject({ rowIndex: 1, columnIndex: 2, row: { key: 'v:features' }, column: { label: 'Aug' } });
    fireEvent.keyDown(m, { key: 'Enter' });
    fireEvent.keyDown(m, { key: ' ' });
    expect(onDrill).toHaveBeenCalledTimes(3);
    fireEvent.click(m, { shiftKey: true });
    expect(onFilter).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledTimes(3);
  });

  it('steps through the marks with the arrow keys, with one tab stop for the chart', () => {
    const { container } = frame();
    const marks = [...container.querySelectorAll<SVGElement>('[data-mark]')];
    const stops = () => marks.filter((m) => m.getAttribute('tabindex') === '0');
    expect(stops()).toHaveLength(1);
    marks[0]!.focus();
    fireEvent.keyDown(marks[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(marks[1]);
    fireEvent.keyDown(marks[1]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(marks[0]);
    fireEvent.keyDown(marks[0]!, { key: 'End' });
    expect(document.activeElement).toBe(marks.at(-1));
    expect(stops()).toHaveLength(1);
    expect(marks.at(-1)!.getAttribute('tabindex')).toBe('0');
  });

  it('shows the tooltip on a first tap and drills on the second', () => {
    const onDrill = vi.fn();
    const { container } = frame({ onDrill });
    const m = container.querySelector('[data-mark="r0c0"]')!;
    fireEvent.pointerDown(m, { pointerType: 'touch' });
    fireEvent.click(m);
    expect(onDrill).not.toHaveBeenCalled();
    expect(container.querySelector('.ck-tip')).not.toBeNull();
    fireEvent.pointerDown(m, { pointerType: 'touch' });
    fireEvent.click(m);
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('isolates a series from the legend and shows all again', () => {
    const { container } = frame();
    const before = container.querySelectorAll('[data-mark^="r"]').length;
    fireEvent.click(screen.getByRole('button', { name: /^New features \(FEAT\): \d+ points in all$/ }));
    const only = [...container.querySelectorAll('[data-mark^="r"]')];
    expect(only.length).toBeLessThan(before);
    expect(only.every((m) => m.getAttribute('aria-label')!.startsWith('New features'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(container.querySelectorAll('[data-mark^="r"]').length).toBe(before);
  });

  it('hides a series from the legend menu', () => {
    const { container } = frame();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^New features/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide this' }));
    expect(container.querySelectorAll('[aria-label^="New features"][data-mark]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-label^="Keep the lights on"][data-mark]').length).toBeGreaterThan(0);
  });

  it('toggles between count and share', () => {
    const { container } = frame();
    expect(screen.getByRole('button', { name: 'Count' }).getAttribute('aria-pressed')).toBe('true');
    const h = (m: Element) => Number(m.querySelector('.ck-fill')!.getAttribute('height'));
    const count = h(container.querySelector('[data-mark="r0c0"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('button', { name: 'Share' }).getAttribute('aria-pressed')).toBe('true');
    expect(h(container.querySelector('[data-mark="r0c0"]')!)).not.toBe(count);
  });

  it('keeps the source and coverage notes on screen, and shows the figures as a table', () => {
    const { container } = frame();
    const source = container.querySelector('.ck-source')!;
    expect(source.textContent).toContain('Sample data.');
    expect(source.textContent).toContain('is a dash, not a zero');
    const table = container.querySelector('table')!;
    const dashes = within(table).getAllByLabelText('not read yet');
    expect(dashes[0]!.textContent).toBe('–');
    expect(dashes[0]!.getAttribute('title')).toBe('not read yet');
    expect(within(table).getAllByText('Total').length).toBeGreaterThan(0);
    expect(container.querySelector('summary')!.textContent).toBe('Show the figures');
  });

  it('says the dimension was not read, with the action that reads it, and draws no chart', () => {
    const { container } = frame({ result: UNREAD_SPLIT, unreadAction: <button type="button">Read releases</button> });
    expect(screen.getByText("Release wasn't read")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read releases' })).toBeTruthy();
    expect(container.querySelector('svg.ck-svg')).toBeNull();
  });
});

describe('figureRows', () => {
  it('puts a dash where a cell was not read, and totals last', () => {
    const { head, rows } = figureRows(WORK_MIX);
    expect(head[0]).toBe('Category');
    expect(head.at(-1)).toBe('Total');
    expect(rows.at(-1)![0]).toBe('Total');
    const cell = rows[0]![4] as { type: unknown; props: { titled: boolean } };
    expect(cell.type).toBe(Unread);
    expect(cell.props.titled).toBe(true);
    expect(typeof rows[0]![1]).toBe('string');
  });
});

describe('the other forms', () => {
  const inFrame = (children: FrameProps['children'], props: Partial<FrameProps> = {}) =>
    render(
      <ChartFrame title="t" result={WORK_MIX} source="s" scheme={SCHEME} {...props}>
        {children}
      </ChartFrame>,
    );
  it('draws bars, with a mark for each read cell', () => {
    const { container } = render(
      <ChartFrame title="t" result={RELEASES} source="s">
        {(v) => <StackedBars view={v} />}
      </ChartFrame>,
    );
    expect(container.querySelectorAll('[data-mark^="r"]').length).toBeGreaterThan(20);
  });
  it('draws an area and lines with a dot for each read point, and a dash for an unread one', () => {
    const area = inFrame((v) => <StackedArea view={v} />);
    expect(area.container.querySelector('[data-mark="u3"]')).not.toBeNull();
    expect(area.container.querySelector('[data-mark="r0c3"]')).toBeNull();
    area.unmount();
    const lines = render(
      <ChartFrame title="b" result={BURNUP} source="s" modes={false}>
        {(v) => <Lines view={v} scope={BURNUP_SCOPE} forecast={BURNUP_FORECAST} />}
      </ChartFrame>,
    );
    expect(lines.container.querySelectorAll('[data-mark^="r0c"]')).toHaveLength(10);
    expect(lines.container.querySelector('[data-mark="forecast"]')!.getAttribute('aria-label')).toBe('Forecast: 26 items to 36 items by Nov 10');
    expect(lines.container.querySelector('[data-mark="s0"]')!.getAttribute('aria-label')).toBe('Scope, Nov 1: 30 items');
  });
  it('draws an unread heatmap cell hatched and blank, never as the lowest colour', () => {
    const { container } = inFrame((v) => <Heatmap view={v} />, { legend: 'none' });
    const unread = container.querySelector('[data-mark="r0c3"]')!;
    expect(unread.querySelector('.ck-cell-unread')).not.toBeNull();
    expect(unread.querySelector('rect:not(.ck-cell-unread)')).toBeNull();
    expect(unread.getAttribute('aria-label')).toContain('not read yet');
    expect(container.querySelector('[data-mark="r0c0"] .ck-cell-unread')).toBeNull();
  });
  it('draws one small chart for each row, an unread cell a dash', () => {
    const { container } = inFrame((v) => <SmallMultiples view={v} />, { legend: 'none' });
    expect(container.querySelectorAll('.ck-multiple')).toHaveLength(4);
    expect(container.querySelector('.ck-multiple [data-mark="r0c3"]')!.getAttribute('aria-label')).toContain('not read yet');
  });
  it('draws a mix bar of named segments, and a dash when nothing was read', () => {
    const onDrill = vi.fn();
    const { container } = render(<MixBar result={PERSON_MIX} scheme={SCHEME} onDrill={onDrill} />);
    const segs = container.querySelectorAll('[data-mark^="m"]');
    expect(segs).toHaveLength(4);
    expect(segs[0]!.getAttribute('aria-label')).toBe('Keep the lights on (KTLO): 8 items, 36% of 22 items');
    fireEvent.click(segs[1]!);
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ rowIndex: 1 }));
    cleanup();
    const unread = { ...PERSON_MIX, rowTotals: PERSON_MIX.rowTotals.map((t) => ({ ...t, value: null })) };
    render(<MixBar result={unread} />);
    expect(screen.getByLabelText('Mix: not read yet').textContent).toBe('–');
  });
  it('renders the gallery', () => {
    const { container } = render(<ChartkitGallery />);
    expect(container.querySelectorAll('figure.ck-chart')).toHaveLength(8);
  });
});

describe('how a mark is drawn', () => {
  it('gives each style its own stroke', () => {
    const s = (style: Parameters<typeof styleProps>[0]['style']) => styleProps({ style }, true);
    expect(s('heavy').strokeWidth).toBeGreaterThan(s('solid').strokeWidth);
    expect(s('solid').strokeDasharray).toBeUndefined();
    expect(s('dashed').strokeDasharray).toBe('6 4');
    expect(s('dotted').strokeLinecap).toBe('round');
    expect(s('double').double).toBe(true);
    expect(s('dashdot').strokeDasharray!.split(' ')).toHaveLength(4);
    expect(s('pixel').shapeRendering).toBe('crispEdges');
    expect(s('pixel').strokeLinecap).toBe('butt');
    expect(styleProps({ style: 'solid', frame: 'hud' }, false).framed).toBe(true);
    expect(styleProps({ style: 'solid', frame: 'hud' }, true).framed).toBe(false);
  });

  it('draws the border inside the outline, and the two neutrals from tokens', () => {
    const { container } = render(
      <svg>
        <MarkRect x={10} y={10} width={40} height={30} mark={mark} />
        <MarkRect x={0} y={0} width={20} height={20} kind="other" />
        <MarkRect x={0} y={0} width={20} height={20} kind="none" />
      </svg>,
    );
    const edge = container.querySelector('.ck-edge')!;
    expect(Number(edge.getAttribute('x'))).toBeGreaterThan(10);
    expect(Number(edge.getAttribute('width'))).toBeLessThan(40);
    expect(container.querySelector('.ck-fill')!.getAttribute('fill')).toBe(mark.fill);
    expect(container.querySelector('.ck-other')).not.toBeNull();
    expect(container.querySelector('.ck-none')!.getAttribute('fill')).toBe('none');
  });

  it('cuts a frame into four corners and tiled edges that fit the side', () => {
    const slices = nineSlice('hud', 0, 0, 60, 40);
    const corners = slices.filter((s) => s.href === '#hud-corner');
    expect(corners.map((s) => s.rotate)).toEqual([0, 90, 180, 270]);
    const top = slices.filter((s) => s.href === '#hud-edge' && s.rotate === 0);
    expect(top.reduce((n, s) => n + s.width, 0)).toBeCloseTo(60 - 14);
    // A tile turned a quarter is boxed the other way round before it is rotated, so along the side it is `height` long.
    const left = slices.filter((s) => s.href === '#hud-edge' && s.rotate === 270);
    expect(left.reduce((n, s) => n + s.width, 0)).toBeCloseTo(40 - 14);
    for (const s of slices) {
      expect(s.x + s.width / 2).toBeCloseTo(s.cx);
      expect(s.y + s.height / 2).toBeCloseTo(s.cy);
    }
  });

  it('draws the frame when its sprite is in the page, and falls back to the simple border without it, in a small segment, or with frames off', () => {
    const framed = { ...mark, frame: 'testframe' };
    const draw = (frames: boolean, w = 60, h = 40) =>
      render(
        <svg>
          <MarkRect x={0} y={0} width={w} height={h} mark={framed} frames={frames} />
        </svg>,
      ).container;
    expect(draw(true).querySelector('.ck-frame')).toBeNull();
    cleanup();
    const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.id = 'test-sprite';
    sprite.innerHTML =
      '<symbol id="testframe-corner" viewBox="0 0 7 7"><path d="M0 0h7v1H1v6H0z" fill="currentColor"/></symbol><symbol id="testframe-edge" viewBox="0 0 7 7"><path d="M0 0h7v1H0z" fill="var(--mark-detail)"/></symbol>';
    document.body.appendChild(sprite);
    const c = draw(true);
    expect(c.querySelector('.ck-frame')).not.toBeNull();
    expect(c.querySelectorAll('.ck-frame use').length).toBeGreaterThanOrEqual(8);
    expect(c.querySelector('.ck-edge')).toBeNull();
    cleanup();
    expect(draw(false).querySelector('.ck-frame')).toBeNull();
    cleanup();
    const small = draw(true, 20, 20);
    expect(small.querySelector('.ck-frame')).toBeNull();
    expect(small.querySelector('.ck-edge')).not.toBeNull();
  });
});

describe('Simple chart marks', () => {
  it('is off until set, and kept in this browser', () => {
    const { result } = renderHook(() => useSimpleMarks());
    expect(result.current).toBe(false);
    act(() => setSimpleMarks(true));
    expect(result.current).toBe(true);
    expect(localStorage.getItem('toil-ui.simple-marks')).toBe('on');
    act(() => setSimpleMarks(false));
    expect(localStorage.getItem('toil-ui.simple-marks')).toBe('off');
  });
});

describe('the dash for a figure nobody read', () => {
  it('says not read yet, and never zero', () => {
    render(
      <p>
        <Figure value={null} />
        <Figure value={7} />
        <Figure value={0} />
      </p>,
    );
    expect(screen.getByLabelText('not read yet').textContent).toBe('–');
    cleanup();
    const { container } = render(<Unread label="Merged: not read yet" />);
    expect(container.textContent).toBe('–');
  });
});
