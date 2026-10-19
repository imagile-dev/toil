/**
 * The board panel (#252): the dossier's sprint in one column per OWI status
 * category, whatever tracker each item came from, with its source's own status
 * word, its assignee, its estimate and its insights on the card. A card can be
 * dragged to another column (dnd-kit, with the keyboard as well as a pointer),
 * or moved with its "Move" menu, the single-pointer way to do the same. Either
 * way nothing changes: the move becomes a proposal card naming the toil
 * command that would apply it (src/model/board.ts), and the card stays where
 * its tracker says it is.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Avatar, InsightChips, StatusChip } from '../components/bits.tsx';
import { ItemLink } from '../components/items.tsx';
import { ProposalCard } from '../components/proposal.tsx';
import { useData, useDerived } from '../data.ts';
import { STATUS_CATEGORY_LABEL, estimateText, personText, shortKey } from '../format.ts';
import { columns, proposeMove } from '../model/board.ts';
import { insights } from '../model/insights.ts';
import type { Proposal } from '../proposal.ts';
import { useSkins } from '../skins.tsx';
import type { StatusCategory, WorkItem } from '../toil.ts';

const label = (c: StatusCategory) => STATUS_CATEGORY_LABEL[c];

function Card({ item, others, onMove }: { item: WorkItem; others: StatusCategory[]; onMove: (to: StatusCategory) => void }) {
  const { insights: prepared } = useDerived();
  const { Card: Skin } = useSkins();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const key = shortKey(item);
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <li ref={setNodeRef} style={style} className={`card card--${item.statusCategory.toLowerCase()}${isDragging ? ' card--dragging' : ''}`}>
      <Skin item={item}>
        <div className="card-top">
          <ItemLink id={item.id} />
          <StatusChip category={item.statusCategory} status={item.status} />
        </div>
        <p className="card-title">{item.title}</p>
        <div className="card-foot">
          <span className="who">
            <Avatar person={item.assignee} /> {personText(item.assignee)}
          </span>
          <span className="field">{estimateText(item)}</span>
        </div>
        <InsightChips insights={insights(item, prepared)} />
        <div className="card-actions">
          {/* The name is the visible word plus what it acts on, so voice control finds it by "Drag" (WCAG 2.5.3). */}
          <button type="button" className="drag" {...listeners} {...attributes}>
            <span aria-hidden="true">⠿</span> Drag<span className="sr-only"> {key} to another column</span>
          </button>
          <MenuTrigger>
            <Button className="btn btn--small">
              Move<span className="sr-only"> {key} to</span>…
            </Button>
            <Popover className="popover" placement="bottom end">
              <Menu className="menu" aria-label={`Move ${key} to`} onAction={(k) => onMove(k as StatusCategory)}>
                {others.map((c) => (
                  <MenuItem key={c} id={c} className="menu-item">
                    {label(c)}
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        </div>
      </Skin>
    </li>
  );
}

function Column({ category, items, all, onMove }: { category: StatusCategory; items: WorkItem[]; all: StatusCategory[]; onMove: (item: WorkItem, to: StatusCategory) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: category });
  const id = `col-${category}`;
  return (
    <section ref={setNodeRef} className={`column column--${category.toLowerCase()}${isOver ? ' column--over' : ''}`} aria-labelledby={id}>
      <h3 id={id}>
        {label(category)} <span className="count">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="cards">
          {items.map((item) => (
            <Card key={item.id} item={item} others={all.filter((c) => c !== category && c !== 'UNKNOWN')} onMove={(to) => onMove(item, to)} />
          ))}
        </ul>
      ) : (
        <p className="note">Nothing here.</p>
      )}
    </section>
  );
}

export function Board({ items }: { items: WorkItem[] }) {
  const { dossier, byId } = useData();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [said, setSaid] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const cols = columns(items);
  const cats = cols.map((c) => c.category);
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
    if (item && e.over) propose(item, e.over.id as StatusCategory);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${keyOf(active.id)}. Moving it proposes a change; nothing is changed.`,
    onDragOver: ({ active, over }) => (over ? `${keyOf(active.id)} is over ${label(over.id as StatusCategory)}.` : `${keyOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${keyOf(active.id)} on ${label(over.id as StatusCategory)}.` : `Dropped ${keyOf(active.id)} outside the columns. Nothing proposed.`),
    onDragCancel: ({ active }) => `Stopped dragging ${keyOf(active.id)}. Nothing proposed.`,
  };

  return (
    <>
      <p className="note">
        One column per status category, across every tracker, each card with its own status word. Drag a card, or use its Move menu, to propose a move: nothing changes until someone applies it with toil.
      </p>
      <DndContext
        sensors={sensors}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'To pick up a card, press Space or Enter. Use the arrow keys to move it over a column, then press Space or Enter to propose the move, or Escape to cancel.' },
        }}
      >
        <div className="board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(15rem, 1fr))` }}>
          {cols.map((c) => (
            <Column key={c.category} category={c.category} items={c.items} all={cats} onMove={propose} />
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
