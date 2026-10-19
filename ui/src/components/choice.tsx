/**
 * A labelled choice from a short list, on React Aria's Select: a button that
 * opens a listbox. The header's theme controls and Settings, General's theme
 * picker (#283) are each one of these.
 * One form, one field, a drop-down of pre-approved answers.
 */

import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';

export function Choice({ label, value, options, onChange }: { label: string; value: string; options: Array<{ id: string; label: string }>; onChange: (id: string) => void }) {
  return (
    <Select className="choice" selectedKey={value} onSelectionChange={(k) => k !== null && onChange(String(k))}>
      <Label>{label}</Label>
      <Button className="btn choice-button">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="popover">
        <ListBox className="menu">
          {options.map((o) => (
            <ListBoxItem key={o.id} id={o.id} className="menu-item">
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
