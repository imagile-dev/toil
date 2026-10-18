import { layoutView } from './layout.js';
import { toSvg } from './svg.js';
import { verifyLayout, type CheckRun } from './verify.js';
import type { ComputedView } from './view.js';

/**
 * One view, laid out, checked and written as SVG: the work `util c4 render`
 * hands to the bounded worker (kit/bounded.ts), because the layout's cost
 * grows faster than the view does. Everything here is plain data in and out,
 * so it crosses into the worker and back unchanged. The drawing department
 * works in a separate building, with a clock on the wall.
 */
export interface Drawing {
  svg: string;
  width: number;
  height: number;
  runs: CheckRun[];
}

export function drawView(view: ComputedView): Drawing {
  const layout = layoutView(view);
  return { svg: toSvg(layout), width: layout.width, height: layout.height, runs: verifyLayout(layout) };
}
