/**
 * Starship's skins (#209): a bridge console. Panels and the header get HUD
 * corner brackets, the agent speaks as the ship's computer, loading is a
 * jump to lightspeed that holds still when reduced motion is on, and an empty
 * list is an empty sector on the scanner (#267). The art is
 * drawn for this theme and hidden from screen readers; the words beside it
 * say what it shows.
 * Lightspeed is available pending sign-off from the reduced-motion committee.
 */

import type { ReactNode } from 'react';
import type { Skins } from '../skins.tsx';
import { useTerm } from '../theme-context.ts';

const art = (file: string) => new URL(`../../themes/starship/assets/${file}`, import.meta.url).href;

/** Four corner brackets, laid over the frame and out of the way of everything in it. */
function Corners() {
  return (
    <span className="hud-corners" aria-hidden="true">
      <i className="hud-corner hud-corner--tl" />
      <i className="hud-corner hud-corner--tr" />
      <i className="hud-corner hud-corner--bl" />
      <i className="hud-corner hud-corner--br" />
    </span>
  );
}

function Computer({ children }: { children: ReactNode }) {
  const term = useTerm();
  return (
    <div className="bubble bubble--agent starship-computer">
      <p className="starship-voice">
        <img src={art('computer.svg')} alt="" width={24} height={24} loading="lazy" decoding="async" />
        {term('agent', 'Agent')}
      </p>
      {children}
    </div>
  );
}

export const starshipSkins: Partial<Skins> = {
  Panel: ({ children }) => (
    <>
      <Corners />
      {children}
    </>
  ),
  Header: ({ children }) => (
    <>
      <Corners />
      {children}
    </>
  ),
  ChatMessage: ({ from, children }) => (from === 'agent' ? <Computer>{children}</Computer> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art starship-empty">
      <img src={art('empty-sector.webp')} alt="" width={240} height={160} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art starship-jump" role="status">
      <img src={art('lightspeed.svg')} alt="" width={240} height={120} loading="lazy" decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
