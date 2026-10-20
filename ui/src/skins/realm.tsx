/**
 * Realm's skins (#210, #349): a house ledger kept by candlelight. A board card
 * names the campaign it serves (its epic, with the source's own word beside
 * the theme's), the header closes on an embossed, riveted rule, an empty list
 * is a ledger lying open on blank pages, the agent answers as the house's
 * steward under its wax seal, and while a view loads a candle burns beside the
 * closed ledger (#267). The art is drawn for this theme and hidden from
 * screen readers.
 * Every campaign is entered in the ledger before any council is convened.
 */

import { useContext, type ReactNode } from 'react';
import { DataContext } from '../data.ts';
import type { Skins } from '../skins.tsx';
import { useTerm } from '../theme-context.ts';
import type { WorkItem } from '../toil.ts';

const art = (file: string) => new URL(`../../themes/realm/assets/${file}`, import.meta.url).href;

/** The epic a card's item belongs to, as its campaign: "Campaign (Epic): Card tokenisation". */
function Campaign({ item }: { item: WorkItem }) {
  const data = useContext(DataContext);
  const term = useTerm();
  const parent = item.parent ? data?.byId.get(item.parent) : undefined;
  if (!parent || parent.type !== 'EPIC') return null;
  return (
    <p className="realm-campaign">
      {term('epic', parent.typeName ?? 'Epic')}: {parent.title}
    </p>
  );
}

function Steward({ children }: { children: ReactNode }) {
  const term = useTerm();
  return (
    <div className="bubble bubble--agent realm-steward">
      <p className="realm-steward-name">
        <img src={art('wax-seal.svg')} alt="" width={24} height={24} loading="lazy" decoding="async" />
        {term('agent', 'Agent')}
      </p>
      {children}
    </div>
  );
}

export const realmSkins: Partial<Skins> = {
  Card: ({ item, children }) => (
    <>
      {children}
      <Campaign item={item} />
    </>
  ),
  Header: ({ children }) => (
    <>
      {children}
      <img className="realm-rule realm-rule--header" src={art('rule.svg')} alt="" width={160} height={16} loading="lazy" decoding="async" aria-hidden="true" />
    </>
  ),
  ChatMessage: ({ from, children }) => (from === 'agent' ? <Steward>{children}</Steward> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art realm-ledger">
      <img src={art('ledger.svg')} alt="" width={200} height={120} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art realm-candle" role="status">
      <img src={art('candle-ledger.webp')} alt="" width={240} height={160} decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
