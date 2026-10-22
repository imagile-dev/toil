/**
 * The theme's moments, previewed under Settings, General (#419): what the
 * theme on screen has, and a button for each, so a person can see the splash,
 * a loading screen and every event moment without waiting for a launch, a
 * slow read or a sync that brings news. The layout check opens the same
 * previews, so every loading screen is held to it in every theme. A preview
 * says it is one: its progress text is a sample, never a real read.
 * The fire drill, announced in advance, with the exits clearly marked.
 */

import { useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useThemeMotion } from '../motion.ts';
import { useTheme } from '../theme-context.ts';
import { SAMPLE_MOMENTS } from './events.ts';
import { Loader, momentsOf, Splash, useMomentPlayer } from './Moments.tsx';
import { MOMENT_KINDS, MOMENT_PLAIN } from './schema.ts';

const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** What a theme's moments are, in a sentence. */
export function momentsSummary(theme: ReturnType<typeof useTheme>): string {
  const m = momentsOf(theme);
  const events = MOMENT_KINDS.filter((k) => m.events?.[k]);
  const parts = [m.splash && 'a launch splash', m.loader ? 'its own loading screen' : null, m.entrance && 'a dossier entrance', m.tabs && 'tab transitions', events.length ? `${events.length} event ${events.length === 1 ? 'moment' : 'moments'}` : null].filter((x): x is string => Boolean(x));
  if (!parts.length) return `${theme.label} has no moments of its own: its loading screens show the progress text and a tip, and nothing else moves.`;
  return `${theme.label} has ${and(parts)}.`;
}

export function MomentsPreview() {
  const theme = useTheme();
  const level = useThemeMotion();
  const player = useMomentPlayer();
  const m = momentsOf(theme);
  const [open, setOpen] = useState<'splash' | 'loader' | null>(null);
  const events = MOMENT_KINDS.filter((k) => m.events?.[k]);
  return (
    <div className="moments-preview-block">
      <p className="note" id="moments-summary">
        {momentsSummary(theme)}
        {level === 'off' && (m.splash || events.length) ? ' Theme motion is off, so the splash and the event moments don’t play: each change shows at once.' : ''}
      </p>
      <div className="moments-preview" role="group" aria-label="Preview the theme's moments">
        {m.splash && (
          <Button className="btn btn--small" onPress={() => setOpen('splash')} isDisabled={level === 'off'} data-preview="splash">
            Preview the splash
          </Button>
        )}
        <Button className="btn btn--small" onPress={() => setOpen('loader')} data-preview="loader">
          Preview a loading screen
        </Button>
        {events.map((k) => (
          <Button key={k} className="btn btn--small" onPress={() => player.play([SAMPLE_MOMENTS[k]])} isDisabled={level === 'off'} data-preview={k}>
            Play: {MOMENT_PLAIN[k]}
          </Button>
        ))}
      </div>
      {open === 'splash' && <Splash ready={false} preview onDone={() => setOpen(null)} />}
      <ModalOverlay className="moment-preview-overlay" data-backdrop="" isDismissable isOpen={open === 'loader'} onOpenChange={(o) => !o && setOpen(null)}>
        <Modal className="moment-preview-modal">
          <Dialog className="moment-preview" aria-labelledby="moment-preview-title" data-moment-preview="">
            <Heading slot="title" id="moment-preview-title" className="sr-only">
              Preview of a loading screen
            </Heading>
            <Loader immediate message="Preview of a loading screen, reading card-payments…" detail="3 of 7 toil calls answered; reading toil jira issue search." />
            <Button className="btn" onPress={() => setOpen(null)} data-preview-close="">
              Close the preview
            </Button>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
