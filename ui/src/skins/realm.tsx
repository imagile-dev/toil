/**
 * Realm's skins (#210): a chronicle in ink. A board card names the quest it
 * serves (its epic, with the source's own word beside the theme's), panels
 * close with an inked flourish, the header carries one too, an empty list is
 * a blank scroll, the agent writes as a scribe, and while a view loads the
 * quill is still at work (#267). The art is drawn for this theme and hidden
 * from screen readers.
 * Every quest is recorded in the ledger before any hero is consulted.
 */

import { useContext, type ReactNode } from 'react';
import { DataContext } from '../data.ts';
import type { Skins } from '../skins.tsx';
import { useTerm } from '../theme-context.ts';
import type { WorkItem } from '../toil.ts';

const art = (file: string) => new URL(`../../themes/realm/assets/${file}`, import.meta.url).href;

function Flourish({ className }: { className: string }) {
  return <img className={className} src={art('flourish.svg')} alt="" width={160} height={16} loading="lazy" decoding="async" aria-hidden="true" />;
}

/** The epic a card's item belongs to, as its quest: "Quest (Epic): Card tokenisation". */
function Quest({ item }: { item: WorkItem }) {
  const data = useContext(DataContext);
  const term = useTerm();
  const parent = item.parent ? data?.byId.get(item.parent) : undefined;
  if (!parent || parent.type !== 'EPIC') return null;
  return (
    <p className="realm-quest">
      {term('epic', parent.typeName ?? 'Epic')}: {parent.title}
    </p>
  );
}

function Scribe({ children }: { children: ReactNode }) {
  const term = useTerm();
  return (
    <div className="bubble bubble--agent realm-scribe">
      <p className="realm-scribe-name">
        <img src={art('quill.svg')} alt="" width={24} height={24} loading="lazy" decoding="async" />
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
      <Quest item={item} />
    </>
  ),
  Panel: ({ children }) => (
    <>
      {children}
      <Flourish className="realm-flourish realm-flourish--panel" />
    </>
  ),
  Header: ({ children }) => (
    <>
      {children}
      <Flourish className="realm-flourish realm-flourish--header" />
    </>
  ),
  ChatMessage: ({ from, children }) => (from === 'agent' ? <Scribe>{children}</Scribe> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art realm-scroll">
      <img src={art('scroll.svg')} alt="" width={200} height={120} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art realm-writing" role="status">
      <img src={art('quill-and-scroll.webp')} alt="" width={240} height={160} decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
