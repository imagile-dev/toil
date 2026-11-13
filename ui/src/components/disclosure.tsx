/**
 * The chevron at the start of a `<details>` summary: right while it is closed, down while it is open, drawn from the icon
 * set. Both are in the markup and the stylesheet shows the one that fits the `open` attribute, so it needs no state and
 * follows whatever opens the section (a press, the keyboard, a link that opens it from elsewhere). The browser still
 * announces expanded or collapsed; the chevron is the sign for people who can see it. A disclosure, in other words, with a door sign.
 */

import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx';
import './disclosure.css';

export function SummaryChevron() {
  return (
    <span className="disclosure-chevron" aria-hidden="true">
      <ChevronRightIcon size={16} className="disclosure-chevron__closed" />
      <ChevronDownIcon size={16} className="disclosure-chevron__open" />
    </span>
  );
}
