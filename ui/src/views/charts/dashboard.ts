/**
 * What a dashboard is (#567): a small declarative module, so adding one is a
 * file and a line in `index.ts`, never an edit to the Summary's charts themselves.
 *
 *   export const mix: Dashboard = { id: 'mix', title: 'Work mix', headline, View };
 *
 * - `id`        its address segment: `#/project/<name>/charts/<id>`.
 * - `title`     what the card and the page's heading say, in plain words.
 * - `headline`  the ONE figure its card in Where the work goes leads with, as a
 *               sentence, worked out from the data with the default period. When it can't
 *               be known, `text` is null and `note` says why in a few words, which the card shows
 *               beside a dash ("not read yet") and never as 0 (principle 12).
 * - `View`      the page. It reads the project through `useWorkInsights()` and the
 *               filters through `useAddress()`, draws its charts in `ChartFrame`s, and
 *               sends every click to `useDrill()`, so its numbers are doors. It
 *               shows the filter bar itself (`<FilterBar />`), with `period={false}` where a
 *               period means nothing to it.
 *
 * A dashboard has one focus: the headline, then one chart; splits and units sit
 * in menus (principle 11). A dashboard registry is the closest thing
 * the codebase has to an org chart, and it is easier to keep current.
 */

import type { ComponentType } from 'react';
import type { WorkInsights } from '../../model/work-insights.ts';

export interface Headline {
  /** The sentence, or null when it can't be known. */
  text: string | null;
  /** What it covers ("last 90 days, 120 items finished"), or, when `text` is null, why it isn't known. */
  note: string;
}

export interface Dashboard {
  id: string;
  title: string;
  headline: (ins: WorkInsights) => Headline;
  View: ComponentType;
}
