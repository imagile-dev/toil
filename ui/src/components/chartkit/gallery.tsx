/**
 * The chart kit's gallery, at `#/chartkit`: every chart form on a fixed sample
 * result, the four marks of the current theme and both neutrals, a null cell,
 * the unread state and a mix bar. It is for review and for the layout check
 * (ui/scripts/layout-check.mjs), which holds it at 375, 768 and 1440px in every
 * theme, frames and Simple chart marks alike. No screen links to it.
 * An exhibit hall for the committee's diagrams, open to anyone who knows the address.
 */

import { useEffect, useState } from 'react';
import { Swatch } from './marks.tsx';
import { ChartFrame } from './ChartFrame.tsx';
import { Heatmap, Lines, MixBar, RampKey, SmallMultiples, StackedArea, StackedBars, StackedColumns } from './forms.tsx';
import { BURNUP, BURNUP_FORECAST, BURNUP_SCOPE, PERSON_MIX, RELEASES, UNREAD_SPLIT, WORK_MIX, WORK_MIX_COMPLETE } from './sample.ts';
import { useFrames, useSeriesMarks } from './series.ts';
import { setSimpleMarks, useSimpleMarksSetting } from '../../simple-marks.ts';
import type { CellRef } from './view.tsx';

const SCHEME = { categories: [{ id: 'ktlo' }, { id: 'features' }] };
const SOURCE = 'Sample data. Nothing here was read from a tool.';

/** `#/chartkit?simple` shows the gallery with Simple chart marks on, and puts the setting back as it was on the way out (the layout check's second pass). */
function useSimpleFromAddress() {
  const [now] = useSimpleMarksSetting();
  useEffect(() => {
    if (!/^#\/chartkit\?.*simple/.test(window.location.hash)) return;
    const before = now;
    setSimpleMarks(true);
    return () => setSimpleMarks(before);
    // Once, on arrival: the checkbox must stay free to change it.
  }, []);
}

export function ChartkitGallery() {
  useSimpleFromAddress();
  const marks = useSeriesMarks();
  const frames = useFrames();
  const [simple, setSimple] = useSimpleMarksSetting();
  const [last, setLast] = useState('Nothing clicked yet.');
  const drill = (c: CellRef) => setLast(`Drilled into ${c.row.label}, ${c.column.label}.`);
  const filter = (c: CellRef) => setLast(`Filtered to ${c.row.label}, ${c.column.label}.`);
  const handlers = { onDrill: drill, onFilter: filter, source: SOURCE };
  return (
    <div className="ck-gallery" data-chartkit-gallery="">
      <header>
        <h1>Chart kit</h1>
        <p className="note" role="status">
          {last}
        </p>
        <label className="note">
          <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} /> Simple chart marks
        </label>
      </header>
      <section aria-labelledby="ck-marks">
        <h2 id="ck-marks">The four marks, Other and None</h2>
        <ul className="ck-legend">
          {marks.map((m, i) => (
            <li key={m.name} className="ck-legend__item">
              <span className="ck-legend__btn">
                <Swatch mark={m} frames={frames} />
                <span>Mark {i + 1}</span>
              </span>
            </li>
          ))}
          <li className="ck-legend__item">
            <span className="ck-legend__btn">
              <Swatch kind="other" />
              <span>Other</span>
            </span>
          </li>
          <li className="ck-legend__item">
            <span className="ck-legend__btn">
              <Swatch kind="none" />
              <span>None</span>
            </span>
          </li>
        </ul>
      </section>
      <section>
        <ChartFrame title="Work mix by month, in points" result={WORK_MIX} scheme={SCHEME} {...handlers}>
          {(view) => <StackedColumns view={view} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Work mix by month, as bars" result={WORK_MIX_COMPLETE} scheme={SCHEME} defaultMode="share" {...handlers}>
          {(view) => <StackedBars view={view} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Releases by type" result={RELEASES} {...handlers}>
          {(view) => <StackedBars view={view} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Work mix over time" result={WORK_MIX_COMPLETE} scheme={SCHEME} {...handlers}>
          {(view) => <StackedArea view={view} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Burn-up with a forecast" result={BURNUP} modes={false} legend="line" {...handlers}>
          {(view) => <Lines view={view} scope={BURNUP_SCOPE} forecast={BURNUP_FORECAST} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Work mix, as a heatmap" result={WORK_MIX} legend="none" {...handlers}>
          {(view) => (
            <>
              <Heatmap view={view} />
              <RampKey />
            </>
          )}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="Work mix, one chart for each" result={WORK_MIX_COMPLETE} scheme={SCHEME} legend="none" {...handlers}>
          {(view) => <SmallMultiples view={view} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame title="A release split nobody read" result={UNREAD_SPLIT} {...handlers} unreadAction={<button type="button">Read releases</button>}>
          {(view) => <StackedColumns view={view} />}
        </ChartFrame>
      </section>
      <section aria-labelledby="ck-mix">
        <h2 id="ck-mix">A mix bar, for a card</h2>
        <MixBar result={PERSON_MIX} scheme={SCHEME} label="Work mix" onDrill={drill} />
      </section>
    </div>
  );
}

export default ChartkitGallery;
