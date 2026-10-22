/**
 * "Links to learning content" (#418), on by default and kept in this browser
 * (src/learning.ts). Off, the (i) popovers keep only toil's own words, Help
 * is the plain docs link again, and the agent's empty state has no Learn.
 * The checkbox for declining enrichment, checked by default, as enrichment prefers.
 */

import { Checkbox } from 'react-aria-components';
import { useLearningLinks } from '../../learning.ts';
import { Card } from '../../components/layout.tsx';

export function LearningSetting() {
  const [on, setOn] = useLearningLinks();
  return (
    <Card as="section" className="panel learning-setting" aria-labelledby="learning">
      <h2 id="learning">Learning content</h2>
      <div className="theme-setting__row">
        <Checkbox className="check" isSelected={on} onChange={setOn} data-learning-setting="">
          <span className="box" aria-hidden="true">
            {on ? '✓' : ''}
          </span>
          Links to learning content
        </Checkbox>
      </div>
      <p className="note">
        {on
          ? "Help, the agent's chat and the (i) beside AI terms link to Context Overflow's glossary and modules. Saved in this browser only."
          : 'No links to Context Overflow anywhere. Saved in this browser only.'}
      </p>
    </Card>
  );
}
