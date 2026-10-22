/**
 * Sprawl's skins (#412): a terminal in a rain-soaked megacity. Panels and the
 * header get a notched corner and a title-bar tab, the agent answers in a
 * terminal window whose title bar names it as the netrunner, loading is a
 * cyberdeck jacking in under an awning (it flickers only when motion is
 * welcome), and an empty list is a dead drop: an empty alley and a terminal
 * nobody is at. The art is drawn for this theme and hidden from screen
 * readers; the words beside it say what it shows.
 * The corner was cut to spec; the spec was cut from a smaller corner.
 */

import type { ReactNode } from 'react';
import type { Skins } from '../skins.tsx';
import { useTerm } from '../theme-context.ts';

const art = (file: string) => new URL(`../../themes/sprawl/assets/${file}`, import.meta.url).href;

/** The notch and the tab, laid over the frame and out of the way of everything in it. */
function Notch() {
  return <span className="sprawl-notch" aria-hidden="true" />;
}

function Terminal({ children }: { children: ReactNode }) {
  const term = useTerm();
  return (
    <div className="bubble bubble--agent sprawl-term">
      <p className="sprawl-term__bar">
        <img src={art('netrunner.svg')} alt="" width={20} height={20} loading="lazy" decoding="async" />
        {term('agent', 'Agent')}
      </p>
      <div className="sprawl-term__body">{children}</div>
    </div>
  );
}

export const sprawlSkins: Partial<Skins> = {
  Panel: ({ children }) => (
    <>
      <Notch />
      {children}
    </>
  ),
  Header: ({ children }) => (
    <>
      <Notch />
      {children}
    </>
  ),
  ChatMessage: ({ from, children }) => (from === 'agent' ? <Terminal>{children}</Terminal> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art sprawl-art">
      <img src={art('dead-drop.webp')} alt="" width={240} height={160} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art sprawl-art sprawl-loading" role="status">
      <img src={art('jack-in.webp')} alt="" width={240} height={160} loading="lazy" decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
