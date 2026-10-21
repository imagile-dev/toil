/**
 * "Reduce motion and effects" (#271): Toil UI's own setting, kept in this
 * browser like the theme, never in toil's config. On, it stops what the
 * operating system's reduced-motion setting stops: every animation and the
 * themes' particles (src/motion.ts). The OS setting still wins when it asks
 * for less; this page says so rather than offering a switch that would do
 * nothing. A theme's particles can also be switched off on their own, under
 * Theme (#348); this switch wins over that one.
 * A form to reduce the forms' animations, filed in triplicate, approved at once.
 */

import { Checkbox } from 'react-aria-components';
import { useMotionAllowed, useMotionChoice } from '../../motion.ts';
import { Card } from '../../components/layout.tsx';
import { Help } from '../../components/help.tsx';

export function MotionSetting() {
  const [choice, setChoice] = useMotionChoice();
  const allowed = useMotionAllowed();
  const reduced = choice === 'reduced';
  return (
    <Card as="section" className="panel motion-setting" aria-labelledby="motion">
      <h2 id="motion">Motion and effects</h2>
      <div className="theme-setting__row">
        <Checkbox className="check" isSelected={reduced} onChange={(on) => setChoice(on ? 'reduced' : 'full')}>
          <span className="box" aria-hidden="true">
            {reduced ? '✓' : ''}
          </span>
          Reduce motion and effects
        </Checkbox>
        <Help topic="motion" />
      </div>
      <p className="note">
        {reduced
          ? 'Nothing moves: no animations or particles. Saved in this browser only.'
          : allowed
            ? "The themes' animations and particles are on, apart from any theme's particles switched off under Theme. Saved in this browser only."
            : "Your system asks for reduced motion, so nothing moves whichever way this is set."}
      </p>
    </Card>
  );
}
