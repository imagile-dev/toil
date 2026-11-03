/**
 * The Plain words switch (src/plain-words.ts): a pressed-or-not button in the
 * header, and the same switch with its explanation in Settings, General. Its
 * own name never changes with the setting, so a person who turned it on can
 * find it again to turn it off. A light switch labelled, in two words, with what it does.
 */

import { ToggleButton } from 'react-aria-components';
import { Card } from './layout.tsx';
import { setPlain, usePlain } from '../plain-words.ts';
import '../plain-words.css';

export function PlainSwitch() {
  const { on } = usePlain();
  return (
    <ToggleButton className="btn plain-switch" isSelected={on} onChange={setPlain} data-plain-switch="">
      Plain words
    </ToggleButton>
  );
}

/** Settings, General: what the switch changes, and what it never does. */
export function PlainWordsSetting() {
  const { on } = usePlain();
  return (
    <Card as="section" className="panel plain-setting" aria-labelledby="plain-words">
      <h2 id="plain-words">Plain words</h2>
      <div className="theme-setting__row">
        <PlainSwitch />
      </div>
      <p className="note">
        {on
          ? 'On: tabs, buttons and headings use everyday words (a dossier is a team, a pull request is a code review, an agent is an AI helper). Hover any of them to see what toil calls it. Facts, numbers, commands and errors read the same. Saved in this browser only.'
          : 'Off: screens use toil’s own terms. Turn it on to read tabs, buttons and headings in everyday words, with toil’s term one hover away. Saved in this browser only.'}
      </p>
    </Card>
  );
}
