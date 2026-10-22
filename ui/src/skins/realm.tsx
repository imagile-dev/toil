/**
 * Realm's skins (#210, #349, #415): a house ledger kept by candlelight, played
 * as a tabletop campaign. A board card names the campaign it serves (its
 * epic) and its place in the initiative order (its priority), each with the
 * source's own word beside the theme's; the sprint keeps its hit points
 * (points left) and experience (points done); a worklog day with no page is a
 * rest; the header closes on an embossed, riveted rule; an empty list is a
 * ledger lying open on blank pages; the agent answers as the dungeon master
 * under its wax seal; and while a view loads, a d20 rolls. The art is drawn
 * for this theme and hidden from screen readers, and every figure it dresses
 * is the data's own.
 * Every campaign is entered in the ledger before any council is convened.
 */

import { useContext, type ReactNode } from 'react';
import { DataContext, useDerived } from '../data.ts';
import type { Skins } from '../skins.tsx';
import { useTerm, useThemeChoiceContext } from '../theme-context.ts';
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

/** The card's priority, as its place in the initiative order: "Initiative (Priority): High". */
function Initiative({ item }: { item: WorkItem }) {
  const term = useTerm();
  if (!item.priority) return null;
  return (
    <p className="realm-initiative">
      {term('priority', 'Priority')}: {item.priority}
    </p>
  );
}

/**
 * The sprint's vitals: its points left as hit points, drawn as a bar, and its
 * points done as experience. The same two figures the sprint panel already
 * counts, so with themed wording off it shows nothing new and stays away.
 */
function Vitals() {
  const { health: h } = useDerived();
  const term = useTerm();
  const { wording } = useThemeChoiceContext();
  if (!h || !wording) return null;
  const left = h.remaining.points;
  const total = h.done.points + left;
  return (
    <div className="realm-vitals">
      <p className="realm-vital">
        <span className="realm-vital__name">{term('pointsLeft', 'Points left')}</span> <span className="realm-vital__value">{left} of {total}</span>
      </p>
      <span className="realm-hp" aria-hidden="true">
        <span style={{ width: `${total ? (100 * left) / total : 0}%` }} />
      </span>
      <p className="realm-vital">
        <span className="realm-vital__name">{term('pointsDone', 'Points done')}</span> <span className="realm-vital__value">{h.done.points}</span>
      </p>
    </div>
  );
}

/** Says what the camp fires on the worklog's calendar mean; the fires show only while it does. */
function Rests() {
  const { wording } = useThemeChoiceContext();
  if (!wording) return null;
  return <p className="note realm-rests">A past day with nothing on its page, or no page at all, is a rest, marked with a camp fire: a short rest on a weekday, a long rest at the weekend.</p>;
}

function Panel({ id, children }: { id: string; children: ReactNode }) {
  // A panel can sit outside a dossier (none do yet), so the vitals only ask for the sprint inside one.
  const inDossier = useContext(DataContext) !== null;
  const { wording } = useThemeChoiceContext();
  if (id === 'sprint' && inDossier) {
    return (
      <>
        <Vitals />
        {children}
      </>
    );
  }
  if (id === 'worklog-calendar') {
    return (
      <>
        {wording && <i className="realm-rest-key" hidden />}
        {children}
        <Rests />
      </>
    );
  }
  return children;
}

function DungeonMaster({ children }: { children: ReactNode }) {
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
      <Initiative item={item} />
      <Campaign item={item} />
    </>
  ),
  Panel,
  Header: ({ children }) => (
    <>
      {children}
      <img className="realm-rule realm-rule--header" src={art('rule.svg')} alt="" width={160} height={16} loading="lazy" decoding="async" aria-hidden="true" />
    </>
  ),
  ChatMessage: ({ from, children }) => (from === 'agent' ? <DungeonMaster>{children}</DungeonMaster> : <div className="bubble bubble--you">{children}</div>),
  EmptyState: ({ message, children }) => (
    <div className="skin-empty skin-empty--art realm-ledger">
      <img src={art('ledger.svg')} alt="" width={200} height={120} loading="lazy" decoding="async" />
      <p>{message}</p>
      {children}
    </div>
  ),
  // The die rolls only where motion is welcome (theme.css); with reduced motion it rests, twenty up.
  Loading: ({ message }) => (
    <div className="skin-loading skin-empty--art realm-roll" role="status">
      <img className="realm-d20" src={art('d20.svg')} alt="" width={88} height={88} decoding="async" />
      <p>{message}</p>
    </div>
  ),
};
