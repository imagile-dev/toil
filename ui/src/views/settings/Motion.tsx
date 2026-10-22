/**
 * "Reduce motion and effects" (#271): Toil UI's own setting, kept in this
 * browser like the theme, never in toil's config. On, it stops what the
 * operating system's reduced-motion setting stops: every animation and the
 * themes' particles (src/motion.ts). The OS setting still wins when it asks
 * for less; this page says so rather than offering a switch that would do
 * nothing. A theme's particles can also be switched off on their own, under
 * Theme (#348); this switch wins over that one.
 *
 * Under it, Theme motion (#419): how much the theme's moments move, full,
 * subtle or off, which reads off whenever either switch above asks for less;
 * and whether the loading screens carry a toil tip.
 * A form to reduce the forms' animations, filed in triplicate, approved at once.
 */

import { Checkbox } from 'react-aria-components';
import { THEME_MOTIONS, useMotionAllowed, useMotionChoice, useThemeMotion, useThemeMotionChoice, type ThemeMotion } from '../../motion.ts';
import { useTipsOn } from '../../tips.ts';
import { Choice } from '../../components/choice.tsx';
import { Card } from '../../components/layout.tsx';
import { Help } from '../../components/help.tsx';

const MOTION_LABEL: Record<ThemeMotion, string> = { full: 'Full', subtle: 'Subtle', off: 'Off' };

export function MotionSetting() {
  const [choice, setChoice] = useMotionChoice();
  const allowed = useMotionAllowed();
  const reduced = choice === 'reduced';
  const [mine, setMine] = useThemeMotionChoice();
  const level = useThemeMotion();
  const [tips, setTips] = useTipsOn();
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
      <div className="theme-setting__row">
        <Choice label="Theme motion" value={mine} onChange={(v) => setMine(v as ThemeMotion)} options={THEME_MOTIONS.map((m) => ({ id: m, label: MOTION_LABEL[m] }))} />
        <Help topic="theme-motion" />
      </div>
      {level !== mine && (
        <p className="note" id="theme-motion-note">
          Off for now: {reduced ? 'Reduce motion and effects is ticked' : 'your system asks for reduced motion'}. {MOTION_LABEL[mine]} is kept for when motion is back.
        </p>
      )}
      <div className="theme-setting__row">
        <Checkbox className="check" isSelected={tips} onChange={setTips}>
          <span className="box" aria-hidden="true">
            {tips ? '✓' : ''}
          </span>
          Toil tips on loading screens
        </Checkbox>
        <Help topic="tips" />
      </div>
    </Card>
  );
}
