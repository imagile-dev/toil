/**
 * Help and edit links (#346). `Help` is the small (i) beside a term: hovering
 * or focusing it shows its topic's one or two sentences in React Aria's
 * Tooltip, and pressing it (a click, a tap, Enter or Space) opens the same
 * sentences in a popover with the Read more link. The link lives in the
 * popover because a tooltip closes the moment focus or the pointer leaves its
 * trigger, so a link inside one could be read but never reached by keyboard
 * or touch. `EditLink` is the pencil beside a configurable value: a plain
 * link to the settings section where it's set, which never changes anything
 * by itself. `useLandOn` is how that section takes focus once its page has
 * loaded. Both keep one size and place in every theme (help.css).
 * Clarifying notes are available on request, and on hover, which saves a request.
 */

import { useEffect } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { HELP, helpHref, type HelpTopicId } from '../help.ts';
import './help.css';

export function Help({ topic }: { topic: HelpTopicId }) {
  const t = HELP[topic];
  return (
    <DialogTrigger>
      <TooltipTrigger delay={400} closeDelay={200}>
        <Button className="btn help-button" data-help={topic} aria-label={`About ${t.title}`}>
          <span aria-hidden="true" className="help-button__mark">
            i
          </span>
        </Button>
        <Tooltip className="help-tooltip" offset={6}>
          {t.text}
        </Tooltip>
      </TooltipTrigger>
      <Popover className="popover help-popover" placement="bottom" offset={6}>
        <Dialog className="help-popover__dialog" aria-label={`About ${t.title}`}>
          <Heading slot="title" className="help-popover__title">
            About {t.title}
          </Heading>
          <p>{t.text}</p>
          <p>
            <a href={helpHref(t)} target="_blank" rel="noopener noreferrer" data-read-more="">
              Read more<span className="sr-only"> about {t.title} in the docs (opens in a new tab)</span>
            </a>
          </p>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** The pencil: `label` is its whole accessible name, such as "Edit the corp-jira connection". */
export function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="btn btn--small edit-link" href={href} aria-label={label} title={label} data-edit-link="">
      <span aria-hidden="true">✎</span>
    </a>
  );
}

/**
 * Once `ready`, moves focus to the element with this id and scrolls it into
 * view: an edit link's target, found after its page has read what it shows.
 * With no such element (a connection since removed), the view's heading
 * takes focus instead, and the page says what it didn't find.
 */
export function useLandOn(id: string | null, ready: boolean) {
  useEffect(() => {
    if (!id || !ready) return;
    const el = document.getElementById(id) ?? document.querySelector<HTMLElement>('main h1');
    if (!el) return;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.scrollIntoView?.({ block: 'start' });
    el.focus();
  }, [id, ready]);
}
