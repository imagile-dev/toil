/**
 * Reading a category already on an item, from the `native` record the OWI
 * mapper kept (`src/core/owi/`). Nothing here asks a service: if the read
 * didn't carry the field, the answer is "unknown", and unknown means the plan
 * sets it. The category field is held to the same filing standard as the
 * category: it is only as good as the last person who looked at it.
 */
import type { WorkItem } from '../owi/types.js';
import type { ResolvedTarget } from './types.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The text of one field value: a string, or an option object's `value` (Jira's select) else `name`. */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const obj = record(value);
  if (!obj) return null;
  for (const key of ['value', 'name']) {
    const found = obj[key];
    if (typeof found === 'string' && found.trim()) return found.trim();
  }
  return null;
}

/** The first native record the item holds under one of an area's commands. */
function nativeOf(item: WorkItem, commands: string[]): Record<string, unknown> | undefined {
  // The mapper keys `native` by the whole command, area first: `jira issue search`.
  for (const command of commands) {
    const found = record(item.native[`${item.source.area} ${command}`]);
    if (found) return found;
  }
  return undefined;
}

/**
 * The category field's value as the read carried it: `undefined` when the
 * field wasn't read (unknown), `null` when it was read and is empty, else the
 * text. Jira and Azure DevOps look the field up by `target.fieldId` in the
 * record's `fields`; GitHub looks for the Projects v2 field named
 * `target.field` among the item's `fieldValues`, which leave an empty field out.
 */
export function readCategoryField(item: WorkItem, target: ResolvedTarget | undefined): string | null | undefined {
  if (!target) return undefined;
  switch (item.source.area) {
    case 'jira':
    case 'ado': {
      const commands = item.source.area === 'jira' ? ['issue search', 'issue get'] : ['work-item get', 'work-item get-many'];
      const fields = record(nativeOf(item, commands)?.fields);
      if (!fields || !target.fieldId || !(target.fieldId in fields)) return undefined;
      const raw = fields[target.fieldId];
      return textOf(Array.isArray(raw) ? raw[0] : raw);
    }
    case 'github': {
      const entry = nativeOf(item, ['project items']);
      if (!entry || !target.field) return undefined;
      const wanted = target.field.toLowerCase();
      for (const value of Array.isArray(entry.fieldValues) ? entry.fieldValues : []) {
        const v = record(value);
        const name = record(v?.field)?.name;
        if (v && typeof name === 'string' && name.toLowerCase() === wanted) return textOf(v.name) ?? textOf(v.text);
      }
      return null;
    }
    default:
      return undefined;
  }
}
