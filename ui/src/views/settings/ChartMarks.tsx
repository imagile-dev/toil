/**
 * "Simple chart marks" (#567), under Settings, Appearance: one checkbox, kept
 * in this browser only. On, every chart draws its series with plain borders
 * (solid, dashed, dotted, double ...) instead of the decorative themes'
 * picture frames. Plain and Crate have no frames, so it changes nothing there,
 * and a note says so rather than offering a choice that does nothing.
 * A tick-box to simplify the diagrams, itself kept simple at the committee's request.
 */

import { Checkbox } from 'react-aria-components';
import { Card } from '../../components/layout.tsx';
import { Help } from '../../components/help.tsx';
import { useSimpleMarksSetting } from '../../simple-marks.ts';
import { useTheme } from '../../theme-context.ts';

export function ChartMarksSetting() {
  const theme = useTheme();
  const [simple, setSimple] = useSimpleMarksSetting();
  const framed = Object.values(theme.series).some((marks) => marks.some((m) => m.frame));
  return (
    <Card as="section" className="panel chart-marks-setting" aria-labelledby="chart-marks">
      <h2 id="chart-marks">Charts</h2>
      <div className="theme-setting__row">
        <Checkbox className="check" isSelected={simple} onChange={setSimple} aria-describedby="chart-marks-note">
          <span className="box" aria-hidden="true">
            {simple ? '✓' : ''}
          </span>
          Simple chart marks
        </Checkbox>
        <Help topic="simple-marks" />
      </div>
      <p className="note" id="chart-marks-note">
        {framed ? 'Charts draw each series with a plain border instead of the theme\'s picture frame.' : "This theme's charts already use plain borders, so this changes nothing here. It applies in the themes that have picture frames."}
      </p>
    </Card>
  );
}
