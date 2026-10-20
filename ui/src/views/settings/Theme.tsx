/**
 * The theme, and how deep it goes (#283), at the top of Settings, General:
 * the same theme picker as the header's, then "Themed wording" (the theme's
 * own microcopy) and "Themed agent voice" (its voice in the agent's prompt),
 * both on by default and kept in this browser beside the theme. Plain has no
 * wording or voice of its own, so with Plain both are off and say why. The
 * page links the documentation, which says what each one changes and what it
 * never changes. A theme whose theme.json names particles also gets
 * "Particles and ambient effects" (#348), kept per theme, under the motion
 * switch in precedence: the OS and "Reduce motion and effects" still stop
 * them whichever way it's set, and the note says so.
 * Two boxes, each pre-ticked, which is the only kind of form that gets returned on time.
 */

import { Checkbox } from 'react-aria-components';
import { Choice } from '../../components/choice.tsx';
import { Card } from '../../components/layout.tsx';
import { useMotionAllowed, useMotionChoice, useParticlesChoice } from '../../motion.ts';
import { useTheme, useThemeChoiceContext } from '../../theme-context.ts';
import { THEMES } from '../../themes.ts';

/** The documentation page that explains the themes. */
export const THEMES_DOCS = 'https://imagile-dev.github.io/toil/docs/themes/';

export function ThemeSetting() {
  const theme = useTheme();
  const choice = useThemeChoiceContext();
  const noWording = theme.lexicon === undefined;
  const noVoice = theme.voice === undefined;
  const particles = theme.ambient?.particles;
  const [particlesOn, setParticlesOn] = useParticlesChoice(theme.name);
  const [motion] = useMotionChoice();
  const moving = useMotionAllowed();
  return (
    <Card as="section" className="panel theme-setting" aria-labelledby="theme-setting">
      <h2 id="theme-setting">Theme</h2>
      <Choice label="Theme" value={theme.name} onChange={choice.setTheme} options={THEMES.map((t) => ({ id: t.name, label: t.label }))} />
      <p className="note">{theme.description}</p>
      <p className="note" id="theme-effects">
        {particles ? `Particles: ${particles}, ${!particlesOn ? 'off' : moving ? 'on' : 'off while motion is reduced'}.` : 'Particles: none.'}
      </p>
      <Box label="Themed wording" on={choice.wording && !noWording} disabled={noWording} onChange={choice.setWording} describedBy="theme-wording-note theme-none-note" />
      <p className="note" id="theme-wording-note">
        The dossier list's lede, page eyebrows, the dashboard's notes, empty states and loading lines in the theme's own words, and its names for a sprint, a board or an epic beside the real ones. Buttons, links, figures, ids, commands and errors always read the same.
      </p>
      <Box label="Themed agent voice" on={choice.voice && !noVoice} disabled={noVoice} onChange={choice.setVoice} describedBy="theme-voice-note theme-none-note" />
      <p className="note" id="theme-voice-note">
        The agent answers in the theme's register. It changes phrasing only: citations, figures and proposals stay exact. Your own instructions are under Settings, Agent.
      </p>
      {particles && (
        <>
          <Box label="Particles and ambient effects" on={particlesOn} disabled={false} onChange={setParticlesOn} describedBy="theme-particles-note" />
          <p className="note" id="theme-particles-note">
            {!moving
              ? `${motion === 'reduced' ? 'Reduce motion and effects is ticked below' : 'Your system asks for reduced motion'}, so no particles show whichever way this is set. It's kept for ${theme.label} for when motion is back.`
              : `${theme.label}'s ${particles} behind the page. Off removes the particles entirely; other animations keep following Motion and effects. Kept for ${theme.label} only, so each theme has its own.`}
          </p>
        </>
      )}
      {(noWording || noVoice) && (
        <p className="note theme-setting__plain" id="theme-none-note">
          {noWording && noVoice ? `${theme.label} has no wording or voice of its own, so both are off while it's chosen. Pick a game theme to use them.` : `${theme.label} has no ${noWording ? 'wording' : 'voice'} of its own, so that box is off while it's chosen.`}
        </p>
      )}
      <p className="note">
        Saved in this browser only. What each one changes is in{' '}
        <a href={THEMES_DOCS} target="_blank" rel="noopener noreferrer">
          the themes documentation (opens in a new tab)
        </a>
        . To ask for a new theme, send a feature request from Feedback.
      </p>
    </Card>
  );
}

function Box({ label, on, disabled, onChange, describedBy }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void; describedBy: string }) {
  return (
    <Checkbox className="check" isSelected={on} isDisabled={disabled} onChange={onChange} aria-describedby={describedBy}>
      <span className="box" aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      {label}
    </Checkbox>
  );
}
