/**
 * The board panel (#252, #347): the toil project's sprint in one column per OWI
 * status category, whatever tracker each item came from, with its source's
 * own status word, its assignee, its estimate and its insights on the card.
 * The whole card is the drag handle (dnd-kit): a mouse or pen after a few
 * pixels of movement, a finger after a short hold, the keyboard with Space or
 * Enter on the focused card. Its context menu (right-click, the Menu key,
 * a long press, or M while it has focus) is the single-pointer way to make
 * the same move, so no card carries a button for it. Either way nothing
 * changes: the move becomes a proposal card naming the toil command that
 * would apply it (src/model/board.ts), and the card stays where its tracker
 * says it is.
 *
 * What a person sees (#393): while a card is dragged, a copy of it follows
 * the pointer (dnd-kit's DragOverlay, in a portal so no scrolling box clips
 * it) and says what a drop there would do; the card itself stays put as a
 * dashed placeholder; the column under the pointer is outlined as a target,
 * or as refused when the card is already in it. After any move, by drag,
 * keyboard or menu, a ghost of the card sits at the top of the target column,
 * marked as a proposal not applied, with Undo and the way to apply it.
 */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  useDndContext,
  type Announcements,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Header, Menu, MenuItem, MenuSection, Popover } from 'react-aria-components';
import { Avatar, InsightChips, StatusChip } from '../components/bits.tsx';
import { CategoryChip, hasCategory } from '../components/category-chip.tsx';
import { MixBar } from '../components/chartkit/index.ts';
import { ProposalCard } from '../components/proposal.tsx';
import { ReclassifyDialog } from '../components/reclassify.tsx';
import { useClassify } from '../classify-state.tsx';
import { AssignModal } from '../assign/views.tsx';
import { useData, useDerived } from '../data.ts';
import { STATUS_CATEGORY_LABEL, estimateText, itemHref, peekHref, personText, shortKey, sourceLabel } from '../format.ts';
import { canMove, columns, proposeMove } from '../model/board.ts';
import { flows } from '../model/flow.ts';
import { boardLanes, mixOfItems, type Lane } from '../model/lanes.ts';
import { useWorkInsights } from '../insights-data.ts';
import { labelOfDimension } from '../model/work-insights.ts';
import './lanes.css';
import { flagsAttention, insights, type Prepared } from '../model/insights.ts';
import type { Proposal } from '../proposal.ts';
import { ariaKeys, matches } from '../shortcuts.ts';
import { useSkins, useWords } from '../skins.tsx';
import type { StatusCategory, WorkItem } from '../toil.ts';

const label = (c: StatusCategory) => STATUS_CATEGORY_LABEL[c];

/**
 * The pointer sensor, for a mouse or a pen only. A finger goes to the touch
 * sensor, which waits for a hold, so a swipe across the cards still scrolls
 * the page instead of picking one up. Both would otherwise answer the same
 * touch, and the first to claim it wins.
 */
class MouseSensor extends PointerSensor {
  static override activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (...args: Parameters<(typeof PointerSensor.activators)[number]['handler']>) => args[0].nativeEvent.pointerType !== 'touch' && PointerSensor.activators[0]!.handler(...args),
    },
  ];
}

/** How many cards a column shows before "Show N more": finished work piles up fastest, so it shows the fewest. */
const COLUMN_LIMIT: Record<string, number> = { DONE: 10 };

/**
 * Ids under swimlanes. A card that holds several values (two components) sits in several lanes, so a draggable's id says
 * which lane it was picked up in, and a column's says which lane it is in; ungrouped, both are the plain ids they always were.
 */
const SEP = '';
export const dragId = (lane: string, item: string) => (lane ? `${lane}${SEP}${item}` : item);
export const dropId = (lane: string, category: string) => (lane ? `${lane}${SEP}${category}` : category);
const parseId = (id: UniqueIdentifier): { lane: string; rest: string } => {
  const s = String(id);
  const at = s.indexOf(SEP);
  return at < 0 ? { lane: '', rest: s } : { lane: s.slice(0, at), rest: s.slice(at + 1) };
};

/** A hold this long picks a card up by touch; moving further than the tolerance first is a scroll. */
const TOUCH_HOLD = { delay: 250, tolerance: 8 };
/** A touch drag that ends nearer than this to where it began was a long press, which opens the menu. */
const PRESS_SLOP = 10;

/**
 * What dropping an item on a column would do: propose a move, or nothing,
 * and why. The same rule as proposeMove: its own column, or Unknown, which
 * no tracker has a status for, proposes nothing.
 */
export function dropVerdict(item: WorkItem, to: StatusCategory | null, sameLane = true): { ok: boolean; text: string } {
  if (!to) return { ok: false, text: 'Not over a column' };
  if (!sameLane) return { ok: false, text: 'Another lane: a lane is a grouping, nothing to change' };
  if (to === item.statusCategory) return { ok: false, text: `Already in ${label(to)}: nothing to propose` };
  if (to === 'UNKNOWN') return { ok: false, text: 'Unknown is no status to move to' };
  return { ok: true, text: `Drop to propose: ${label(to)}` };
}

/** A proposed move on the board, with the column it would go to. */
interface Move {
  proposal: Proposal;
  to: StatusCategory;
}

/**
 * The card's face: what it shows, in the column and under the pointer. The
 * copy under the pointer (`ids` unset) is decoration for the eye only: its key
 * is no link and it names nothing, since the announcements speak for it.
 */
/** ` card--attention` on a card that needs attention (#394), for its edge. */
const attentionClass = (item: WorkItem, p: Prepared) => (flagsAttention(insights(item, p)) ? ' card--attention' : '');

function CardFace({ item, ids }: { item: WorkItem; ids?: string }) {
  const { insights: prepared } = useDerived();
  const { Card: Skin } = useSkins();
  const key = shortKey(item);
  const found = insights(item, prepared);
  const ins = useWorkInsights();
  return (
    <Skin item={item}>
      <div className="card-top">
        {ids ? (
          <a id={`${ids}-key`} href={peekHref(typeof window === 'undefined' ? '#/' : window.location.hash, item.id)} className="item-link card-key" draggable={false}>
            <span className="key">{key}</span>
          </a>
        ) : (
          <span className="card-key">
            <span className="key">{key}</span>
          </span>
        )}
        {/* Needs attention (#394): the flag the board's filter keys on, a shape as well as a colour. */}
        {flagsAttention(found) && (
          <span className="card-flag" title="Needs attention">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path d="M4 14V2.5M4 3h7.5l-1.8 2.8L11.5 8.5H4" />
            </svg>
            <span className="sr-only">Needs attention</span>
          </span>
        )}
        <StatusChip category={item.statusCategory} status={item.status} inColumn />
        {/* The category, display-only and small; an Unsure item shows none, to keep cards quiet. */}
        {hasCategory(ins, item.id) && <CategoryChip ins={ins} itemId={item.id} compact skipTab />}
      </div>
      <p id={ids && `${ids}-title`} className="card-title">
        {item.title}
      </p>
      <div className="card-foot">
        <span className="who">
          <Avatar person={item.assignee} /> {personText(item.assignee)}
        </span>
        <span className="card-meta">
          <InsightChips insights={found} compact titles={prepared.byId} />
          <span className="field">
            <span className="source">{sourceLabel(item.source.area)}</span> · {estimateText(item)}
          </span>
        </span>
      </div>
    </Skin>
  );
}

/** The copy of the card that follows the pointer, saying what a drop where it is would do. */
function DragCard({ item }: { item: WorkItem }) {
  const { over, active } = useDndContext();
  const { insights: prepared } = useDerived();
  const target = over ? parseId(over.id) : null;
  const verdict = dropVerdict(item, (target?.rest as StatusCategory | undefined) ?? null, !target || !active || target.lane === parseId(active.id).lane);
  return (
    <div className={`card card--${item.statusCategory.toLowerCase()}${attentionClass(item, prepared)} card--overlay`} data-drag-overlay aria-hidden="true">
      <div className="card-grip">
        <CardFace item={item} />
      </div>
      <p className={`drop-verdict${verdict.ok ? '' : ' drop-verdict--no'}`} data-drop-verdict>
        {verdict.text}
      </p>
    </div>
  );
}

/**
 * The proposal where the person dropped it: a ghost of the card at the top of
 * the column it would move to, plainly not the card itself. Undo takes the
 * proposal back; How to apply goes to its card under the board, which has the
 * command.
 */
function Ghost({ item, move, onUndo, onShow }: { item: WorkItem; move: Move; onUndo: () => void; onShow: () => void }) {
  const key = shortKey(item);
  return (
    <li className="card-ghost" data-proposed-ghost aria-label={`Proposed move, not applied: ${key} ${item.title}`}>
      <p className="card-ghost__kind">Proposed move, not applied</p>
      <p className="card-ghost__title">
        <span className="key">{key}</span> {item.title}
      </p>
      <p className="note">
        From {label(item.statusCategory)}. It stays there until someone applies the move with toil.
      </p>
      <div className="card-ghost__actions">
        <Button className="btn btn--quiet" onPress={onUndo} aria-label={`Undo the proposed move of ${key}`}>
          Undo
        </Button>
        <Button className="btn" onPress={onShow} aria-label={`How to apply the move of ${key} to ${label(move.to)}`}>
          How to apply
        </Button>
      </div>
    </li>
  );
}

/**
 * Arrow keys jump a picked-up card a whole column at a time, in board order:
 * Right or Down to the next, Left or Up to the previous, so the same keys
 * work whether the columns sit side by side or stack on a phone. The card
 * lands just under the column's heading, where nothing but that column is.
 */
export const columnSteps =
  (order: StatusCategory[], home: (id: UniqueIdentifier) => StatusCategory | undefined, laneOf: (id: UniqueIdentifier) => string = () => ''): KeyboardCoordinateGetter =>
  (event, { active, context: { collisionRect, droppableRects, over } }) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.code];
    if (!step || !collisionRect) return undefined;
    event.preventDefault();
    // A picked-up card steps through its own lane's columns; the lanes are for looking, not for moving between.
    const lane = laneOf(active);
    const at = order.indexOf(((over ? parseId(over.id).rest : undefined) as StatusCategory | undefined) ?? home(active)!);
    const next = order[Math.min(order.length - 1, Math.max(0, at + step))];
    const rect = next ? droppableRects.get(dropId(lane, next)) : undefined;
    if (!rect) return undefined;
    return { x: rect.left + Math.max(0, (rect.width - collisionRect.width) / 2), y: rect.top + 48 };
  };

function Card({ item, lane, others, onMove, menuOpen, setMenuOpen }: { item: WorkItem; lane: string; others: StatusCategory[]; onMove: (to: StatusCategory) => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void }) {
  const { toilProject, assignments } = useData();
  const { insights: prepared } = useDerived();
  // Decided up front, by the rule the proposal uses: a card that can't be moved isn't draggable, and says why.
  const can = canMove(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: dragId(lane, item.id), disabled: !can.ok, attributes: { role: 'group', ...(can.ok ? { roleDescription: 'draggable card' } : {}) } });
  const [assigning, setAssigning] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const { api: classifyApi } = useClassify();
  const grip = useRef<HTMLDivElement | null>(null);
  const ids = useId();
  const key = shortKey(item);
  const href = itemHref(toilProject.name, item.id);

  // The card is its own activator, so Space or Enter on the key's link inside it follows the link instead of picking the card up.
  const gripRef = (el: HTMLDivElement | null) => {
    grip.current = el;
    setActivatorNodeRef(el);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isDragging && matches('cardMenu', e)) {
      e.preventDefault();
      setMenuOpen(true);
      return;
    }
    listeners?.onKeyDown?.(e);
  };
  // Right-click and the Menu key. On the key's link the browser's own menu stays, so "open in a new tab" still works.
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('a') || isDragging) return;
    e.preventDefault();
    setMenuOpen(true);
  };
  // A click anywhere on the card opens the item, as its link does. After a drag dnd-kit swallows the click, so a drop never navigates.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('a, button')) return;
    window.location.hash = href;
  };
  const closeMenu = (open: boolean) => {
    setMenuOpen(open);
    // A menu dismissed with Escape or a click outside hands focus back to the card it came from.
    if (!open) requestAnimationFrame(() => document.activeElement === document.body && grip.current?.focus());
  };
  // A Popover with no MenuTrigger around it doesn't close on an action by itself.
  const onAction = (k: UniqueIdentifier) => {
    closeMenu(false);
    if (k === 'open') window.location.hash = href;
    else if (k === 'assign') setAssigning(true);
    else if (k === 'category') setReclassifying(true);
    else onMove(k as StatusCategory);
  };

  return (
    // While it's dragged the card stays where it is, as a placeholder; the copy in the DragOverlay is what moves.
    <li ref={setNodeRef} className={`card card--${item.statusCategory.toLowerCase()}${attentionClass(item, prepared)}${isDragging ? ' card--dragging' : ''}`}>
      <div
        ref={gripRef}
        className="card-grip"
        data-item={item.id}
        {...attributes}
        {...listeners}
        aria-labelledby={`${ids}-key ${ids}-title`}
        aria-describedby={can.ok ? attributes['aria-describedby'] : `${ids}-why`}
        aria-roledescription={can.ok ? attributes['aria-roledescription'] : undefined}
        aria-keyshortcuts={ariaKeys('cardMenu')}
        data-immovable={can.ok ? undefined : ''}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        onClick={onClick}
      >
        <CardFace item={item} ids={ids} />
        {!can.ok && (
          <p id={`${ids}-why`} className="card-why" data-why-immovable>
            {can.reason}
          </p>
        )}
      </div>
      {/* Outside the card's own element: a portal's events still bubble through React, and a press in the menu must not start a drag. */}
      <Popover triggerRef={grip} isOpen={menuOpen} onOpenChange={closeMenu} placement="bottom start" className="popover">
        <Menu className="menu" aria-label={`${key} ${item.title}`} autoFocus="first" onAction={onAction} disabledKeys={can.ok ? [] : others}>
          <MenuItem id="open" className="menu-item">
            Open
          </MenuItem>
          <MenuSection>
            <Header className="menu-header">{can.ok ? 'Move to' : can.reason}</Header>
            {others.map((c) => (
              <MenuItem key={c} id={c} className="menu-item">
                {label(c)}
              </MenuItem>
            ))}
          </MenuSection>
          {classifyApi ? (
            <MenuItem id="category" className="menu-item">
              Change its category…
            </MenuItem>
          ) : null}
          {assignments ? (
            <MenuItem id="assign" className="menu-item">
              Give to an AI agent…
            </MenuItem>
          ) : null}
        </Menu>
      </Popover>
      {assignments && <AssignModal item={item} isOpen={assigning} onOpenChange={setAssigning} />}
      {classifyApi && <ReclassifyDialog item={item} isOpen={reclassifying} onOpenChange={setReclassifying} />}
    </li>
  );
}

function Column({ category, lane, items, all, onMove, menuFor, setMenuFor, ghosts, onUndo, onShow }: { category: StatusCategory; lane: string; items: WorkItem[]; all: StatusCategory[]; onMove: (item: WorkItem, to: StatusCategory) => void; menuFor: string | null; setMenuFor: (id: string | null) => void; ghosts: { item: WorkItem; move: Move }[]; onUndo: (move: Move) => void; onShow: (move: Move) => void }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: dropId(lane, category) });
  const { byId } = useData();
  const words = useWords();
  const ids = useId();
  const id = `col-${ids}`;
  const dragged = active ? byId.get(parseId(active.id).rest) : undefined;
  // Under the pointer: a target, or refused (its own column, or another lane), whose reason the copy under the pointer gives.
  const drop = isOver && dragged ? (dropVerdict(dragged, category, !active || parseId(active.id).lane === lane).ok ? ' column--over' : ' column--refused') : '';
  // A long column is a wall: the first cards show, the rest are one press away, and the count in the heading stays the whole.
  const [more, setMore] = useState(false);
  const limit = COLUMN_LIMIT[category] ?? 25;
  const hiding = !more && items.length > limit ? items.length - limit : 0;
  const visible = hiding ? items.slice(0, limit) : items;
  return (
    <section ref={setNodeRef} className={`column column--${category.toLowerCase()}${drop}`} aria-labelledby={id}>
      <h3 id={id}>
        {label(category)} <span className="count">{items.length}</span>
      </h3>
      {items.length || ghosts.length ? (
        <ul className="cards">
          {ghosts.map((g) => (
            <Ghost key={g.move.proposal.id} item={g.item} move={g.move} onUndo={() => onUndo(g.move)} onShow={() => onShow(g.move)} />
          ))}
          {visible.map((item) => (
            <Card
              key={item.id}
              item={item}
              lane={lane}
              others={all.filter((c) => c !== category && c !== 'UNKNOWN')}
              onMove={(to) => onMove(item, to)}
              menuOpen={menuFor === item.id}
              setMenuOpen={(open) => setMenuFor(open ? item.id : null)}
            />
          ))}
        </ul>
      ) : null}
      {hiding > 0 && (
        <Button className="btn btn--small column__more" onPress={() => setMore(true)} data-show-more={category}>
          Show {hiding} more<span className="sr-only"> in {label(category)}</span>
        </Button>
      )}
      {items.length ? null : <p className="note">{words('empty.column')}</p>}
    </section>
  );
}

/** The lane's header: its name and count as the button that folds it, and, when the grouping isn't by category, the mix of what is in it. */
function LaneHead({ lane, open, onToggle, mix, id }: { lane: Lane; open: boolean; onToggle: () => void; mix: ReturnType<typeof mixOfItems>; id: string }) {
  const ins = useWorkInsights();
  return (
    <div className="lane__head">
      <h3 id={id}>
        <button type="button" className="lane__toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} data-lane-toggle={lane.key}>
          <span className="lane__chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="lane__name">{lane.label}</span>{' '}
          <span className="count" data-lane-count="">
            {lane.items.length}
          </span>
        </button>
      </h3>
      {mix && (
        <span className="lane__mix">
          <span className="lane__mixlabel" aria-hidden="true">
            Mix by category
          </span>
          <MixBar result={mix} scheme={{ categories: ins.scheme.categories }} label={`${lane.label}: mix by category`} />
        </span>
      )}
    </div>
  );
}

/**
 * The Board. Grouped (`group` names a dimension), it is one lane per value over the same status columns: each lane keeps
 * its own "Show N more" limits, folds away, and takes a drag only within itself, because a lane is a grouping and not a
 * status. Ungrouped it is the single board it has always been, with no lane around it.
 */
export function Board({ items, group = null }: { items: WorkItem[]; group?: string | null }) {
  const { toilProject, byId } = useData();
  const ins = useWorkInsights();
  const [moves, setMoves] = useState<Move[]>([]);
  const [said, setSaid] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<WorkItem | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [allLanes, setAllLanes] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const laneSet = group ? boardLanes(ins, items, group, allLanes) : null;
  const cols = columns(items);
  const cats = cols.map((c) => c.category);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_HOLD }),
    useSensor(KeyboardSensor, { coordinateGetter: columnSteps(cats, (id) => byId.get(parseId(id).rest)?.statusCategory, (id) => parseId(id).lane) }),
  );
  const keyOf = (id: unknown) => {
    const item = byId.get(parseId(id as UniqueIdentifier).rest);
    return item ? shortKey(item) : String(id);
  };

  const propose = (item: WorkItem, to: StatusCategory) => {
    const p = proposeMove(item, to, toilProject.items, toilProject.name);
    if (!p) {
      setSaid(`${shortKey(item)} is already in ${label(to)}. Nothing proposed.`);
      return;
    }
    setMoves((list) => [{ proposal: p, to }, ...list.filter((x) => x.proposal.id !== p.id && x.proposal.item !== p.item)]);
    setSaid(`Proposed: ${p.title}. Nothing has changed in ${toilProject.name}'s tracker.`);
  };
  const dismiss = (move: Move) => setMoves((list) => list.filter((x) => x.proposal.id !== move.proposal.id));
  // Undo hands focus back to the card, which never left its column; looked for on this board only.
  const undo = (move: Move) => {
    dismiss(move);
    setSaid(`Took back the proposed move of ${keyOf(move.proposal.item)}. Nothing proposed.`);
    requestAnimationFrame(() => boardRef.current?.querySelector<HTMLElement>(`.card-grip[data-item="${CSS.escape(move.proposal.item)}"]`)?.focus());
  };
  // How to apply: the proposal's card under this board, which has the command.
  const show = (move: Move) => {
    const slot = listRef.current?.querySelector<HTMLElement>(`[data-proposal="${CSS.escape(move.proposal.id)}"]`);
    slot?.scrollIntoView?.({ block: 'center' });
    slot?.focus({ preventScroll: true });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const picked = parseId(e.active.id);
    const item = byId.get(picked.rest);
    if (!item) return;
    // A finger held still and lifted was a long press: iOS sends no contextmenu, so this is its menu.
    if ('touches' in e.activatorEvent && Math.hypot(e.delta.x, e.delta.y) < PRESS_SLOP) {
      setMenuFor(item.id);
      return;
    }
    if (!e.over) return;
    const target = parseId(e.over.id);
    if (target.lane !== picked.lane) {
      setSaid(`${shortKey(item)} was dropped in another lane. A lane is a grouping, not a status: nothing was changed and nothing proposed.`);
      return;
    }
    propose(item, target.rest as StatusCategory);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${keyOf(active.id)}. Moving it proposes a change; nothing is changed.`,
    onDragOver: ({ active, over }) =>
      over ? `${keyOf(active.id)} is over ${label(parseId(over.id).rest as StatusCategory)}${parseId(over.id).lane === parseId(active.id).lane ? '' : ' in another lane, where a drop changes nothing'}.` : `${keyOf(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) => {
      if (!over) return `Dropped ${keyOf(active.id)} outside the columns. Nothing proposed.`;
      if (parseId(over.id).lane !== parseId(active.id).lane) return `Dropped ${keyOf(active.id)} in another lane. Nothing was changed.`;
      const home = byId.get(parseId(active.id).rest)?.statusCategory === parseId(over.id).rest;
      return `Dropped ${keyOf(active.id)} on ${label(parseId(over.id).rest as StatusCategory)}${home ? ', where it already is. Nothing proposed.' : '.'}`;
    },
    onDragCancel: ({ active }) => `Stopped dragging ${keyOf(active.id)}. Nothing proposed.`,
  };

  const columnsOf = (lane: string, laneItems: WorkItem[]) => {
    const here = new Set(laneItems.map((i) => i.id));
    return (
      <div ref={lane ? undefined : boardRef} className="board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(15rem, 1fr))` }}>
        {cats.map((category) => (
          <Column
            key={category}
            category={category}
            lane={lane}
            items={laneItems.filter((i) => flows(i) && i.statusCategory === category)}
            all={cats}
            onMove={propose}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            ghosts={moves.flatMap((move) => {
              const item = move.to === category && here.has(move.proposal.item) ? byId.get(move.proposal.item) : undefined;
              return item ? [{ item, move }] : [];
            })}
            onUndo={undo}
            onShow={show}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging(byId.get(parseId(e.active.id).rest) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'To pick up the card, press Space or Enter. Use the arrow keys to move it to the next or previous column, then press Space or Enter to propose the move, or Escape to cancel. Press M or the Menu key for its menu.',
          },
        }}
      >
        {group && !laneSet && (
          <p className="note" data-lanes-unread="">
            {labelOfDimension(group)} wasn't read for this Toil project, so the board can't be grouped by it yet. It is shown ungrouped.
          </p>
        )}
        {laneSet ? (
          <div ref={boardRef} className="lanes" data-lanes={laneSet.spec}>
            {laneSet.lanes.map((lane) => {
              const open = !folded.has(lane.key);
              const id = `lane-${lane.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              const mix = laneSet.spec === 'category' ? null : mixOfItems(ins, lane.items.map((i) => i.id), 'category');
              return (
                <section key={lane.key} className="lane" aria-labelledby={id} data-lane={lane.key}>
                  <LaneHead
                    lane={lane}
                    open={open}
                    id={id}
                    mix={mix}
                    onToggle={() =>
                      setFolded((cur) => {
                        const next = new Set(cur);
                        if (next.has(lane.key)) next.delete(lane.key);
                        else next.add(lane.key);
                        return next;
                      })
                    }
                  />
                  {open && (
                    <div id={`${id}-body`} className="lane__body">
                      {columnsOf(lane.key, lane.items)}
                    </div>
                  )}
                </section>
              );
            })}
            {laneSet.foldable > 0 && (
              <Button className="btn btn--small lanes__all" onPress={() => setAllLanes((v) => !v)} data-show-all-lanes="">
                {allLanes ? 'Fold the small lanes into Other' : `Show all lanes (${laneSet.foldable} more)`}
              </Button>
            )}
          </div>
        ) : (
          columnsOf('', items)
        )}
        {/* In a portal, so no scrolling or transformed box around the board can clip or offset it. No drop animation: the
            card doesn't move on a drop, so flying the copy back to it would read as refused; the ghost says where it went. */}
        {createPortal(<DragOverlay dropAnimation={null}>{dragging ? <DragCard item={dragging} /> : null}</DragOverlay>, document.body)}
      </DndContext>
      <p className="sr-only" role="status">
        {said}
      </p>
      {moves.length > 0 && (
        <div ref={listRef} className="proposals" aria-label="Proposed moves" role="group">
          <h3>Proposed moves</h3>
          {moves.map((m) => (
            <div key={m.proposal.id} data-proposal={m.proposal.id} className="proposal-slot" tabIndex={-1}>
              <ProposalCard proposal={m.proposal} onDismiss={() => dismiss(m)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
