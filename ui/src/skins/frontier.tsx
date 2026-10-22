/**
 * Frontier's skins (#413): steampunk on the wild west frontier. The agent
 * answers as the operator at the telegraph key, an empty list is a blank
 * wanted poster nailed up beside a gauge reading zero, and while a view loads
 * a little locomotive gets up steam at the water tower (#267). The brass, the
 * gauges and the survey map are theme.css's. The art is drawn for this theme
 * and hidden from screen readers; the words beside it say what it shows.
 * Every claim is filed in triplicate at the assay office before the drive moves.
 */

import type { ReactNode } from 'react';
import type { Skins } from '../skins.tsx';
import { useTerm } from '../theme-context.ts';

const art = (file: string) => new URL(`../../themes/frontier/assets/${file}`, import.meta.url).href;

function Operator({ children }: { children: ReactNode }) {
  const term = useTerm();
  return (
    <div className="bubble bubble--agent frontier-operator">
      <p className="frontier-operator-name">
        <img src={art('telegraph-key.svg')} alt="" width={24} height={24} loading="lazy" decoding="async" />
        {term('agent', 'Agent')}
      </p>
      {children}
    </div>
  );
}

export const frontierSkins: Partial<Skins> = {
  ChatMessage: ({ from, children }) => (from === 'agent' ? <Operator>{children}</Operator> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art frontier-wanted">
      <img src={art('wanted-poster.webp')} alt="" width={240} height={160} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art frontier-steam" role="status">
      <img src={art('locomotive.webp')} alt="" width={240} height={160} decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
