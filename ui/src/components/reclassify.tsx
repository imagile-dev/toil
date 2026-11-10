/**
 * Changing an item's category from where it is shown (#566, "Reclassify,
 * everywhere the chip is pressable"): the item page's header, the item drawer,
 * the items drawer's rows. The chip opens a small popover with the scheme's
 * categories by their plain names, "Unsure", an optional reason and one button.
 * Pressing it records the person's word in their own ledger (a local write,
 * `classify correct`) and queues the tracker's change on the Classify view's
 * Apply list; it never writes the tracker itself. Choosing the category the
 * item already has is a confirmation, which is recorded too: agreement is
 * measured, not only disagreement. A board card shows the chip display-only,
 * because a whole card is its drag handle and no card carries a button; the
 * card's menu opens the same form in a dialog. The one line under the tabs says
 * what just happened and offers to change it back. Nothing in this file writes
 * to a tracker, and the paperwork it files is the person's own, in a drawer only
 * they can open.
 */

import { useId, useRef, useState } from 'react';
import { Button, Dialog, Modal, ModalOverlay, Popover, Radio, RadioGroup, TextArea, TextField, Label } from 'react-aria-components';
import { CategoryChip } from './category-chip.tsx';
import { useData } from '../data.ts';
import { useWorkInsights } from '../insights-data.ts';
import { choicesOf } from '../model/classify.ts';
import { useClassify } from '../classify-state.tsx';
import { classifyHref, shortKey } from '../format.ts';
import type { WorkItem } from '../toil.ts';
import './classify.css';

/** What the form says is true of a press: the record is the person's own, and the tracker waits for Apply. */
export const RECLASSIFY_NOTE = 'This is saved in your own record on this computer. The tracker changes only when you apply it, from Sort work into categories.';

/** The form: every category by its plain name, Unsure, an optional reason and Confirm or Change. */
export function ReclassifyForm({ item, onDone }: { item: WorkItem; onDone: () => void }) {
  const ins = useWorkInsights();
  const { reclassify } = useClassify();
  const choices = choicesOf(ins.scheme);
  const verdict = ins.verdicts.get(item.id);
  const now = verdict?.category ?? null;
  const [picked, setPicked] = useState<string>(now ?? 'unsure');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();
  const same = picked === (now ?? 'unsure');
  const press = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await reclassify(item, picked === 'unsure' ? null : picked, reason);
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="reclassify__form"
      data-reclassify-form=""
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void press();
      }}
    >
      <h3 className="reclassify__title" id={`${ids}-title`}>
        What kind of work is {shortKey(item)}?
      </h3>
      <RadioGroup className="reclassify__choices" aria-labelledby={`${ids}-title`} value={picked} onChange={setPicked}>
        {choices.map((c) => (
          <Radio key={c.id ?? 'unsure'} value={c.id ?? 'unsure'} className="reclassify__choice" data-choice={c.id ?? 'unsure'}>
            {c.name}
          </Radio>
        ))}
      </RadioGroup>
      <TextField className="reclassify__reason" value={reason} onChange={setReason} maxLength={300}>
        <Label>Why? (optional)</Label>
        <TextArea rows={2} />
      </TextField>
      <p className="note">{RECLASSIFY_NOTE}</p>
      {problem && (
        <p className="failure" role="alert">
          {problem}
        </p>
      )}
      <div className="reclassify__actions">
        <Button type="submit" className="btn btn--accent" isDisabled={busy} data-reclassify-confirm="">
          {busy ? 'Saving…' : same ? 'Confirm' : 'Change'}
        </Button>
        <Button className="btn btn--quiet" onPress={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The category chip as a button that opens the form. Without a ledger to record in, it stays the plain display chip. */
export function ReclassifyChip({ item, compact = false }: { item: WorkItem; compact?: boolean }) {
  const ins = useWorkInsights();
  const { api } = useClassify();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  if (!api) return <CategoryChip ins={ins} itemId={item.id} compact={compact} />;
  return (
    <>
      <span ref={anchor} className="reclassify__anchor">
        <CategoryChip ins={ins} itemId={item.id} compact={compact} onPress={() => setOpen(true)} />
      </span>
      <Popover triggerRef={anchor} isOpen={open} onOpenChange={setOpen} placement="bottom start" className="popover reclassify">
        <Dialog aria-label={`Change the category of ${shortKey(item)}`} className="reclassify__dialog">
          <ReclassifyForm item={item} onDone={() => setOpen(false)} />
        </Dialog>
      </Popover>
    </>
  );
}

/** The same form in a dialog, for the board card's menu: a card has no button to anchor a popover to. */
export function ReclassifyDialog({ item, isOpen, onOpenChange }: { item: WorkItem; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="modal-overlay">
      <Modal className="modal reclassify">
        <Dialog aria-label={`Change the category of ${shortKey(item)}`} className="reclassify__dialog">
          <ReclassifyForm item={item} onDone={() => onOpenChange(false)} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/**
 * The one line under the tabs that says what the last change was, with its undo: the archive line's pattern. A change is
 * recorded the moment it is pressed, so the line says so and where the tracker's part waits; Undo records the item back
 * where it stood, in words ("Changed back"), since the ledger only ever adds.
 */
export function ClassifyNoticeLine() {
  const ins = useWorkInsights();
  const { toilProject } = useData();
  const { notice, setNotice, undo } = useClassify();
  if (!notice) return null;
  if (notice.kind === 'failed') {
    return (
      <p className="failure classify-notice" role="alert">
        {notice.message}{' '}
        <button type="button" className="btn btn--small" onClick={() => setNotice(null)}>
          Dismiss
        </button>
      </p>
    );
  }
  if (notice.kind === 'reverted') {
    return (
      <p className="note classify-notice" role="status" data-classify-notice="reverted">
        Changed back. <strong>{notice.key}</strong> is as it was.{' '}
        <button type="button" className="btn btn--small" onClick={() => setNotice(null)}>
          Dismiss
        </button>
      </p>
    );
  }
  const name = notice.to === 'unsure' ? 'Unsure' : (ins.definitions[notice.to]?.name ?? notice.to);
  return (
    <p className="note classify-notice" role="status" data-classify-notice="changed">
      <strong>{notice.key}</strong> is now {name}. It is saved in your own record; the tracker changes when you <a href={classifyHref(toilProject.name)}>apply it</a>.{' '}
      <button type="button" className="btn btn--small" onClick={() => void undo()}>
        Undo
      </button>{' '}
      <button type="button" className="btn btn--small" onClick={() => setNotice(null)}>
        Dismiss
      </button>
    </p>
  );
}
