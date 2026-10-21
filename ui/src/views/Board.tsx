/**
 * The board panel (#252, #347): the dossier's sprint in one column per OWI
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
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Header, Menu, MenuItem, MenuSection, Popover } from 'react-aria-components';
import { Avatar, InsightChips, StatusChip } from '../components/bits.tsx';
import { ProposalCard } from '../components/proposal.tsx';
import { AssignModal } from '../assign/views.tsx';
import { useData, useDerived } from '../data.ts';
import { STATUS_CATEGORY_LABEL, estimateText, itemHref, personText, shortKey, sourceLabel } from '../format.ts';
import { columns, proposeMove } from '../model/board.ts';
import { flagsAttention, insights } from '../model/insights.ts';
import type { Proposal } from '../proposal.ts';
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

/** A hold this long picks a card up by touch; moving further than the tolerance first is a scroll. */
const TOUCH_HOLD = { delay: 250, tolerance: 8 };
/** A touch drag that ends nearer than this to where it began was a long press, which opens the menu. */
const PRESS_SLOP = 10;

/**
 * Arrow keys jump a picked-up card a whole column at a time, in board order:
 * Right or Down to the next, Left or Up to the previous, so the same keys
 * work whether the columns sit side by side or stack on a phone. The card
 * lands just under the column's heading, where nothing but that column is.
 */
export const columnSteps =
  (order: StatusCategory[], home: (id: UniqueIdentifier) => StatusCategory | undefined): KeyboardCoordinateGetter =>
  (event, { active, context: { collisionRect, droppableRects, over } }) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.code];
    if (!step || !collisionRect) return undefined;
    event.preventDefault();
    const at = order.indexOf((over?.id as StatusCategory | undefined) ?? home(active)!);
    const next = order[Math.min(order.length - 1, Math.max(0, at + step))];
    const rect = next ? droppableRects.get(next) : undefined;
    if (!rect) return undefined;
    return { x: rect.left + Math.max(0, (rect.width - collisionRect.width) / 2), y: rect.top + 48 };
  };

function Card({ item, others, onMove, menuOpen, setMenuOpen }: { item: WorkItem; others: StatusCategory[]; onMove: (to: StatusCategory) => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void }) {
  const { insights: prepared } = useDerived();
  const { dossier, assignments } = useData();
  const { Card: Skin } = useSkins();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: item.id, attributes: { role: 'group', roleDescription: 'draggable card' } });
  const [assigning, setAssigning] = useState(false);
  const grip = useRef<HTMLDivElement | null>(null);
  const ids = useId();
  const key = shortKey(item);
  const href = itemHref(dossier.name, item.id);
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const found = insights(item, prepared);
  // Needs attention (#394): the flag the board's filter keys on, a shape as well as a colour.
  const flagged = flagsAttention(found);

  // The card is its own activator, so Space or Enter on the key's link inside it follows the link instead of picking the card up.
  const gripRef = (el: HTMLDivElement | null) => {
    grip.current = el;
    setActivatorNodeRef(el);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isDragging && (e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
    else onMove(k as StatusCategory);
  };

  return (
    <li ref={setNodeRef} style={style} className={`card card--${item.statusCategory.toLowerCase()}${flagged ? ' card--attention' : ''}${isDragging ? ' card--dragging' : ''}`}>
      <div
        ref={gripRef}
        className="card-grip"
        {...attributes}
        {...listeners}
        aria-labelledby={`${ids}-key ${ids}-title`}
        aria-keyshortcuts="M"
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        onClick={onClick}
      >
        <Skin item={item}>
          <div className="card-top">
            <a id={`${ids}-key`} href={href} className="item-link card-key" draggable={false}>
              <span className="key">{key}</span>
            </a>
            {flagged && (
              <span className="card-flag" title="Needs attention">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M4 14V2.5M4 3h7.5l-1.8 2.8L11.5 8.5H4" />
                </svg>
                <span className="sr-only">Needs attention</span>
              </span>
            )}
            <StatusChip category={item.statusCategory} status={item.status} />
          </div>
          <p id={`${ids}-title`} className="card-title">
            {item.title}
          </p>
          <div className="card-foot">
            <span className="who">
              <Avatar person={item.assignee} /> {personText(item.assignee)}
            </span>
            <span className="card-meta">
              <InsightChips insights={found} compact />
              <span className="field">
                <span className="source">{sourceLabel(item.source.area)}</span> · {estimateText(item)}
              </span>
            </span>
          </div>
        </Skin>
      </div>
      {/* Outside the card's own element: a portal's events still bubble through React, and a press in the menu must not start a drag. */}
      <Popover triggerRef={grip} isOpen={menuOpen} onOpenChange={closeMenu} placement="bottom start" className="popover">
        <Menu className="menu" aria-label={`${key} ${item.title}`} autoFocus="first" onAction={onAction}>
          <MenuItem id="open" className="menu-item">
            Open
          </MenuItem>
          <MenuSection>
            <Header className="menu-header">Move to</Header>
            {others.map((c) => (
              <MenuItem key={c} id={c} className="menu-item">
                {label(c)}
              </MenuItem>
            ))}
          </MenuSection>
          {assignments ? (
            <MenuItem id="assign" className="menu-item">
              Assign to an agent…
            </MenuItem>
          ) : null}
        </Menu>
      </Popover>
      {assignments && <AssignModal item={item} isOpen={assigning} onOpenChange={setAssigning} />}
    </li>
  );
}

function Column({ category, items, all, onMove, menuFor, setMenuFor }: { category: StatusCategory; items: WorkItem[]; all: StatusCategory[]; onMove: (item: WorkItem, to: StatusCategory) => void; menuFor: string | null; setMenuFor: (id: string | null) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: category });
  const words = useWords();
  const id = `col-${category}`;
  return (
    <section ref={setNodeRef} className={`column column--${category.toLowerCase()}${isOver ? ' column--over' : ''}`} aria-labelledby={id}>
      <h3 id={id}>
        {label(category)} <span className="count">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="cards">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              others={all.filter((c) => c !== category && c !== 'UNKNOWN')}
              onMove={(to) => onMove(item, to)}
              menuOpen={menuFor === item.id}
              setMenuOpen={(open) => setMenuFor(open ? item.id : null)}
            />
          ))}
        </ul>
      ) : (
        <p className="note">{words('empty.column')}</p>
      )}
    </section>
  );
}

export function Board({ items }: { items: WorkItem[] }) {
  const { dossier, byId } = useData();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [said, setSaid] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const cols = columns(items);
  const cats = cols.map((c) => c.category);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_HOLD }),
    useSensor(KeyboardSensor, { coordinateGetter: columnSteps(cats, (id) => byId.get(String(id))?.statusCategory) }),
  );
  const keyOf = (id: unknown) => {
    const item = byId.get(String(id));
    return item ? shortKey(item) : String(id);
  };

  const propose = (item: WorkItem, to: StatusCategory) => {
    const p = proposeMove(item, to, dossier.items, dossier.name);
    if (!p) {
      setSaid(`${shortKey(item)} is already in ${label(to)}. Nothing proposed.`);
      return;
    }
    setProposals((list) => [p, ...list.filter((x) => x.id !== p.id && x.item !== p.item)]);
    setSaid(`Proposed: ${p.title}. Nothing has changed in ${dossier.name}'s tracker.`);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const item = byId.get(String(e.active.id));
    if (!item) return;
    // A finger held still and lifted was a long press: iOS sends no contextmenu, so this is its menu.
    if ('touches' in e.activatorEvent && Math.hypot(e.delta.x, e.delta.y) < PRESS_SLOP) {
      setMenuFor(item.id);
      return;
    }
    if (e.over) propose(item, e.over.id as StatusCategory);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${keyOf(active.id)}. Moving it proposes a change; nothing is changed.`,
    onDragOver: ({ active, over }) => (over ? `${keyOf(active.id)} is over ${label(over.id as StatusCategory)}.` : `${keyOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => {
      if (!over) return `Dropped ${keyOf(active.id)} outside the columns. Nothing proposed.`;
      const home = byId.get(String(active.id))?.statusCategory === over.id;
      return `Dropped ${keyOf(active.id)} on ${label(over.id as StatusCategory)}${home ? ', where it already is. Nothing proposed.' : '.'}`;
    },
    onDragCancel: ({ active }) => `Stopped dragging ${keyOf(active.id)}. Nothing proposed.`,
  };

  return (
    <>
      <p className="note">
        One column per status category, across every tracker, each card with its own status word. Drag a card to another column, or open its menu with a right-click, a long press or M, to propose a move: nothing changes until someone applies it with toil.
      </p>
      <DndContext
        sensors={sensors}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'To pick up the card, press Space or Enter. Use the arrow keys to move it to the next or previous column, then press Space or Enter to propose the move, or Escape to cancel. Press M or the Menu key for its menu.',
          },
        }}
      >
        <div className="board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(15rem, 1fr))` }}>
          {cols.map((c) => (
            <Column key={c.category} category={c.category} items={c.items} all={cats} onMove={propose} menuFor={menuFor} setMenuFor={setMenuFor} />
          ))}
        </div>
      </DndContext>
      <p className="sr-only" role="status">
        {said}
      </p>
      {proposals.length > 0 && (
        <div className="proposals" aria-label="Proposed moves" role="group">
          <h3>Proposed moves</h3>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onDismiss={() => setProposals((list) => list.filter((x) => x.id !== p.id))} />
          ))}
        </div>
      )}
    </>
  );
}
