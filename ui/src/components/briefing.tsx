/**
 * The briefing's pieces (#494): the hook every view reads it through, and the
 * item drawer, the one step between a line on the briefing and an item's own
 * page. The drawer opens beside whatever view named the item (the briefing,
 * the Board, Pull requests) at that view's own address plus `?item=`, so a
 * peek can be shared and the view behind it stays put. It says why the item
 * is there and who said so, the next step, any change Analyze proposed, and
 * the pull requests and chain it sits in; everything else is on its page.
 * The memo, and then the file, for those who ask for the file.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { analyzeSettings } from '../../../src/core/brief/settings.ts';
import { useData } from '../data.ts';
import { dateTime, itemHref, peekHref, personText, shortKey, sourceLabel, STATUS_CATEGORY_LABEL, estimateText, unpeekHref } from '../format.ts';
import { briefingOf, itemBriefing, type BriefingView } from '../model/briefing.ts';
import { matches } from '../shortcuts.ts';
import { useChatScope } from './ask.tsx';
import { whoText } from './analysis.tsx';
import { Cited, ItemHrefContext, PrLink } from './items.tsx';
import { ProposalCard } from './proposal.tsx';
import './briefing.css';

/** The dossier's briefing: Analyze's when its latest is current, the code's otherwise. */
export function useBriefing(): BriefingView {
  const { dossier, now } = useData();
  const list = useChatScope()?.history.list ?? null;
  return useMemo(
    () =>
      briefingOf({
        items: dossier.items,
        pullRequests: dossier.pullRequests ?? [],
        now,
        settings: analyzeSettings(dossier.analyze ?? undefined, dossier.wipLimit ?? null).settings,
        analyses: list ?? [],
      }),
    [dossier, now, list],
  );
}

/** Who wrote the briefing, in words: "Analyze, Codex (gpt-5.5), 13 Oct 2026, 07:30 UTC" or "By code". */
export function briefingSource(view: BriefingView): string {
  return view.by === 'analyze' && view.analysis ? `Analyze, ${whoText(view.analysis)}, ${dateTime(view.analysis.at)}` : 'By code, no agent';
}

/** Links inside it open the drawer over the page you're on, not the item's page. */
export function PeekLinks({ children }: { children: ReactNode }) {
  const here = typeof window === 'undefined' ? '#/' : window.location.hash;
  return <ItemHrefContext.Provider value={(_d, id) => peekHref(here, id)}>{children}</ItemHrefContext.Provider>;
}

/** The drawer for one item, beside the view; Escape or Close goes back to the view alone. */
export function ItemDrawer({ id }: { id: string }) {
  const { dossier, byId } = useData();
  const view = useBriefing();
  const heading = useRef<HTMLHeadingElement>(null);
  const here = typeof window === 'undefined' ? '#/' : window.location.hash;
  const close = unpeekHref(here);
  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (matches('drawerClose', e)) window.location.hash = close;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, close]);
  const item = byId.get(id);
  const head = (
    <div className="drawer__top">
      <span className="drawer__key">{item ? `${sourceLabel(item.source.area)} ${shortKey(item)}` : id}</span>
      <span className="drawer__actions">
        {item && (
          <a className="btn btn--small" href={itemHref(dossier.name, id)} data-drawer-open="">
            Open
          </a>
        )}
        <a className="btn btn--small" href={close} aria-label="Close the drawer" data-drawer-close="">
          Close
        </a>
      </span>
    </div>
  );
  if (!item) {
    return (
      <aside className="item-drawer" aria-labelledby="drawer-title" data-drawer={id}>
        {head}
        <h2 id="drawer-title" ref={heading} tabIndex={-1} className="drawer__title">
          Not in this dossier
        </h2>
        <p className="error">
          <code>{id}</code> isn't one of {dossier.name}'s items as Toil UI last read them. Sync the dossier, or check where the link came from.
        </p>
      </aside>
    );
  }
  const { reason, item: briefed, code } = itemBriefing(view, id);
  const prs = (dossier.pullRequests ?? []).filter((c) => c.workItems.includes(id));
  const proposals = view.by === 'analyze' ? (view.analysis?.proposals ?? []).filter((p) => p.item === id) : [];
  const blockedBy = item.links.filter((l) => l.type === 'blocks' && l.direction === 'inward').map((l) => l.target);
  const blocks = item.links.filter((l) => l.type === 'blocks' && l.direction === 'outward').map((l) => l.target);
  return (
    <aside className="item-drawer" aria-labelledby="drawer-title" data-drawer={id}>
      {head}
      <h2 id="drawer-title" ref={heading} tabIndex={-1} className="drawer__title">
        {item.title}
      </h2>
      <p className="drawer__facts note">
        {item.status ?? STATUS_CATEGORY_LABEL[item.statusCategory]} · {personText(item.assignee)} · {estimateText(item)}
        {item.url && (
          <>
            {' · '}
            <a href={item.url} target="_blank" rel="noreferrer" data-drawer-tracker="">
              Open in {sourceLabel(item.source.area)}
            </a>
          </>
        )}
      </p>
      <PeekLinks>
        {briefed && reason ? (
          <section className={`drawer__why drawer__why--${reason.severity}`} aria-label="Why it's here">
            <h3>{reason.label}</h3>
            <p>
              <Cited text={briefed.why} />
            </p>
            <p className="source">{view.by === 'analyze' ? `${briefingSource(view)}. Every id checked against what its tools read.` : `By code, from ${code?.evidence.join(', ') ?? 'the record'}, read with toil ${item.source.command}.`}</p>
          </section>
        ) : (
          <p className="note">Nothing flags it: it's on track.</p>
        )}
        {briefed?.next && (
          <section className="drawer__next" aria-label="Next step">
            <h3>Next step</h3>
            <p>
              <Cited text={briefed.next} />
            </p>
          </section>
        )}
        {proposals.map((p, i) => (
          <ProposalCard key={i} proposal={p} />
        ))}
        {prs.length > 0 && (
          <section aria-label="Pull requests">
            <h3 className="drawer__label">Pull requests</h3>
            <ul className="rows">
              {prs.map((c) => (
                <li key={c.id}>
                  <PrLink change={c} withTitle /> <span className="note">{[c.state.toLowerCase(), c.checks ? `checks ${c.checks.toLowerCase()}` : ''].filter(Boolean).join(', ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(blockedBy.length > 0 || blocks.length > 0) && (
          <section aria-label="Chain">
            <h3 className="drawer__label">Chain</h3>
            {blockedBy.length > 0 && (
              <p>
                Blocked by <Cited text={blockedBy.map((b) => `[[${b}]]`).join(', ')} />
              </p>
            )}
            {blocks.length > 0 && (
              <p>
                Blocks <Cited text={blocks.map((b) => `[[${b}]]`).join(', ')} />
              </p>
            )}
          </section>
        )}
      </PeekLinks>
      <p className="source">
        Read {item.updated ? `as of ${dateTime(item.updated)}` : ''} with toil {item.source.command}, connection {item.source.connection}.
      </p>
    </aside>
  );
}
