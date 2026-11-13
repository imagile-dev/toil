/**
 * A quiet menu of dimensions (#567): Group by on the Board, "Show each person's
 * work by" on People, Split by in the Summary's modals. Each lists the
 * dimensions it is given by their plain names and greys the ones the read never
 * fetched, "not read yet", instead of leaving them out, so an absence is never
 * a mystery (principle 12). It is the Choice menu with one extra idea, which is
 * that some answers are not available yet. A menu of options with some greyed out
 * is, in most organisations, called a roadmap.
 */

import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import { labelOfDimension, type WorkInsights } from '../model/work-insights.ts';
import { ChevronDownIcon } from './icons.tsx';

const NONE = '(none)';

export interface DimensionPickerProps {
  label: string;
  /** The chosen dimension, or null for the menu's own "none" answer. */
  value: string | null;
  options: readonly string[];
  /** The words for the answer that picks no dimension ("No grouping"); without it the menu has no such answer. */
  none?: string;
  ins: WorkInsights;
  onChange: (spec: string | null) => void;
}

export function DimensionPicker({ label, value, options, none, ins, onChange }: DimensionPickerProps) {
  const rows = [...(none ? [{ id: NONE, text: none, unread: false }] : []), ...options.map((spec) => ({ id: spec, text: labelOfDimension(spec), unread: ins.valuesIn(spec) === null }))];
  const shown = rows.find((r) => r.id === (value ?? NONE))?.text ?? (value ? labelOfDimension(value) : (none ?? ''));
  return (
    <Select className="choice dimension-picker" selectedKey={value ?? NONE} onSelectionChange={(k) => k !== null && onChange(String(k) === NONE ? null : String(k))} disabledKeys={rows.filter((r) => r.unread).map((r) => r.id)} data-picker={label}>
      <Label>{label}</Label>
      <Button className="btn choice-button btn--small">
        <SelectValue>{() => shown}</SelectValue>
        <ChevronDownIcon size={14} />
      </Button>
      <Popover className="popover">
        <ListBox className="menu">
          {rows.map((r) => (
            <ListBoxItem key={r.id} id={r.id} className="menu-item" textValue={r.unread ? `${r.text}, not read yet` : r.text}>
              {r.text}
              {r.unread && <span className="note dimension-picker__unread">not read yet</span>}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
