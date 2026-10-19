/**
 * The theme, and how deep it goes (#283), at the top of Settings, General:
 * the same theme picker as the header's, then "Themed wording" (the theme's
 * own microcopy) and "Themed agent voice" (its voice in the agent's prompt),
 * both on by default and kept in this browser beside the theme. Plain has no
 * wording or voice of its own, so with Plain both are off and say why. The
 * page links the documentation, which says what each one changes and what it
 * never changes.
 * Two boxes, each pre-ticked, which is the only kind of form that gets returned on time.
 */

import { Checkbox } from 'react-aria-components';
import { Choice } from '../../components/choice.tsx';
import { Card } from '../../components/layout.tsx';
import { useTheme, useThemeChoiceContext } from '../../theme-context.ts';
import { THEMES } from '../../themes.ts';

/** The documentation page that explains the themes. */
export const THEMES_DOCS = 'https://imagile-dev.github.io/toil/docs/themes/';

export function ThemeSetting() {
  const theme = useTheme();
  const choice = useThemeChoiceContext();
  const plain = theme.lexicon === undefined && theme.voice === undefined;
  return (
    <Card as="section" className="panel theme-setting" aria-labelledby="theme-setting">
      <h2 id="theme-setting">Theme</h2>
      <Choice label="Theme" value={theme.name} onChange={choice.setTheme} options={THEMES.map((t) => ({ id: t.name, label: t.label }))} />
      <p className="note">{theme.description}</p>
      <Box label="Themed wording" on={choice.wording && !plain} disabled={plain} onChange={choice.setWording} />
      <p className="note">Empty states, loading lines and notes in the theme's own words. Buttons, links, headings, figures, ids, commands and errors always read the same.</p>
      <Box label="Themed agent voice" on={choice.voice && !plain} disabled={plain} onChange={choice.setVoice} />
      <p className="note">The agent answers in the theme's register. It changes phrasing only: citations, figures and proposals stay exact. Your own instructions are under Settings, Agent.</p>
      {plain && <p className="note theme-setting__plain">Plain has no wording or voice of its own, so both are off while it's chosen. Pick a game theme to use them.</p>}
      <p className="note">
        Saved in this browser only. What each one changes is in <a href={THEMES_DOCS}>the themes documentation</a>. To ask for a new theme, send a feature request from Feedback.
      </p>
    </Card>
  );
}

function Box({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <Checkbox className="check" isSelected={on} isDisabled={disabled} onChange={onChange}>
      <span className="box" aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      {label}
    </Checkbox>
  );
}
