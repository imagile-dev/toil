/**
 * The tooltip and the keyboard for a chart: every mark, legend swatch and chip
 * shows what it stands for on hover AND on keyboard focus, and the same text
 * is its accessible name.
 *
 * `useMarkHost()` returns:
 *  - `hostProps`   spread on the element that holds the marks (a <div> or <figure>
 *    with `position: relative`): it gives arrow-key stepping (Right/Down next,
 *    Left/Up previous, Home and End) through the marks inside it, in page order.
 *  - `mark(id, text, { first?, onDrill?, onFilter? })`  props for a mark's <g>:
 *    `tabIndex` (roving: one mark in the chart is a tab stop), role, `aria-label`,
 *    the tooltip handlers and the click rules. A click drills, Shift-click filters,
 *    Enter or Space drills (Shift+Enter filters). On touch, the first tap shows
 *    the tooltip and the second drills.
 *  - `tipHandlers(id, text)`  only the tooltip handlers, for a legend button or chip.
 *  - `tip`  the tooltip's element, to render inside the host.
 *
 * A mark with no `onDrill` is an image with a name and not a button.
 * The tooltip is a speech bubble for the figures, signed and initialled by the chart.
 */

import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type SVGProps } from 'react';

export interface MarkOptions {
  /** True on the chart's first mark: it is the tab stop until another is focused. */
  first?: boolean;
  onDrill?: (() => void) | undefined;
  onFilter?: (() => void) | undefined;
}

/** What a mark's <g> is given. */
export type MarkProps = Omit<SVGProps<SVGGElement>, 'x' | 'y' | 'width' | 'height' | 'ref'> & { 'data-mark': string };

/** What a legend button or chip is given: the tooltip, nothing more. */
export interface TipHandlers {
  onFocus: (e: FocusEvent<Element>) => void;
  onBlur: () => void;
  onPointerEnter: (e: PointerEvent<Element>) => void;
  onPointerLeave: (e: PointerEvent<Element>) => void;
}

export interface MarkHost {
  hostRef: RefObject<HTMLDivElement | null>;
  hostProps: { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
  mark: (id: string, text: string, options?: MarkOptions) => MarkProps;
  tipHandlers: (id: string, text: string) => TipHandlers;
  tip: ReactNode;
}

interface Tip {
  id: string;
  text: string;
  x: number;
  y: number;
}

export function useMarkHost(): MarkHost {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const pointer = useRef<string>('mouse');

  const show = (el: Element, id: string, text: string) => {
    const host = hostRef.current?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setTip({ id, text, x: box.left + box.width / 2 - (host?.left ?? 0), y: box.top - (host?.top ?? 0) });
  };
  const hide = (id: string) => setTip((t) => (t && t.id === id ? null : t));

  const tipHandlers = (id: string, text: string): TipHandlers => ({
    onFocus: (e: FocusEvent<Element>) => show(e.currentTarget, id, text),
    onBlur: () => hide(id),
    onPointerEnter: (e: PointerEvent<Element>) => {
      if (e.pointerType !== 'touch') show(e.currentTarget, id, text);
    },
    onPointerLeave: (e: PointerEvent<Element>) => {
      if (e.pointerType !== 'touch') hide(id);
    },
  });

  const mark = (id: string, text: string, options: MarkOptions = {}): MarkProps => {
    const act = (shift: boolean) => (shift && options.onFilter ? options.onFilter() : options.onDrill?.());
    return {
      ...tipHandlers(id, text),
      'data-mark': id,
      role: options.onDrill ? 'button' : 'img',
      className: 'ck-mark',
      'aria-label': text,
      tabIndex: active === id || (active === null && options.first) ? 0 : -1,
      onFocus: (e: FocusEvent<Element>) => {
        setActive(id);
        show(e.currentTarget, id, text);
      },
      onPointerDown: (e: PointerEvent<Element>) => {
        pointer.current = e.pointerType;
      },
      onClick: (e: MouseEvent<Element>) => {
        // Touch: the first tap names the mark, the second drills.
        if (pointer.current === 'touch' && tip?.id !== id) return show(e.currentTarget, id, text);
        act(e.shiftKey);
      },
      onKeyDown: (e: KeyboardEvent<Element>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          act(e.shiftKey);
        }
      },
    };
  };

  const hostProps = {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
      const marks = [...(hostRef.current?.querySelectorAll<HTMLElement | SVGElement>('[data-mark]') ?? [])];
      const here = marks.indexOf((e.target as Element).closest('[data-mark]') as HTMLElement);
      if (here < 0 || marks.length === 0) return;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? marks.length - 1 : Math.min(marks.length - 1, Math.max(0, here + keys[e.key]!));
      e.preventDefault();
      marks[next]!.focus();
    },
  };

  const node = tip && (
    <div className="ck-tip" aria-hidden="true" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
  return { hostRef, hostProps, mark, tipHandlers, tip: node };
}
