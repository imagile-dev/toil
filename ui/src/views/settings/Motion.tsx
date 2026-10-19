/**
 * "Reduce motion and effects" (#271): Toil UI's own setting, kept in this
 * browser like the theme, never in toil's config. On, it stops what the
 * operating system's reduced-motion setting stops: every animation, the
 * themes' particles and Crate's parallax (src/motion.ts). The OS setting
 * still wins when it asks for less; this page says so rather than offering a
 * switch that would do nothing.
 * A form to reduce the forms' animations, filed in triplicate, approved at once.
 */

import { Checkbox } from 'react-aria-components';
import { useMotionAllowed, useMotionChoice } from '../../motion.ts';

export function MotionSetting() {
  const [choice, setChoice] = useMotionChoice();
  const allowed = useMotionAllowed();
  const reduced = choice === 'reduced';
  return (
    <section className="panel motion-setting" aria-labelledby="motion">
      <h2 id="motion">Motion and effects</h2>
      <Checkbox className="check" isSelected={reduced} onChange={(on) => setChoice(on ? 'reduced' : 'full')}>
        <span className="box" aria-hidden="true">
          {reduced ? '✓' : ''}
        </span>
        Reduce motion and effects
      </Checkbox>
      <p className="note">
        {reduced
          ? 'Nothing moves: no animations, particles or parallax. Saved in this browser only.'
          : allowed
            ? "The themes' animations, particles and parallax are on. Saved in this browser only."
            : "Your system asks for reduced motion, so nothing moves whichever way this is set."}
      </p>
    </section>
  );
}
