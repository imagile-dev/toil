import { ToilError } from '../errors.js';
import { isRecord } from './common.js';
import type { Body, Link, LinkType, WorkItem } from './types.js';
import type { SimilarItem } from './similar.js';

/**
 * Reads OWI records back in: what `util owi map` printed (the envelope, or its
 * `data`), a JSON array of records such as Toil UI's cache holds, or one record
 * a line. Only the fields the similarity scorer reads are kept, each checked
 * for its shape; a record without an id or a title is skipped and said so,
 * never guessed at. Paperwork returned to the office that issued it, and
 * accepted without a covering letter.
 */

/** A record that wasn't read, and why. */
export interface RecordSkipped {
  /** Where in the input: `document 2`, `document 1, items[4]`. */
  at: string;
  reason: string;
}

export interface OwiRecords {
  items: SimilarItem[];
  skipped: RecordSkipped[];
}

const BODY_FORMATS = new Set<Body['format']>(['markdown', 'wiki', 'adf', 'html']);
const LINK_TYPES = new Set<LinkType>(['blocks', 'relates', 'duplicates', 'implements', 'other']);

const isEnvelope = (v: unknown): v is { ok: unknown; data?: unknown; meta: { command: string } } => isRecord(v) && 'ok' in v && isRecord(v.meta) && typeof v.meta.command === 'string';

/** The JSON values in some text: one value, or one a line. */
function values(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === '') throw new ToilError('INVALID_INPUT', 'The input is empty.', { fix: 'Pipe OWI records in (toil util owi map … | toil util owi similar …), or pass the file that holds them.' });
  try {
    return [JSON.parse(trimmed) as unknown];
  } catch {
    // Not one JSON value: one record or envelope a line.
  }
  return trimmed.split(/\r?\n/).flatMap((line, i) => {
    if (line.trim() === '') return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (err) {
      throw new ToilError('INVALID_INPUT', `Line ${i + 1} of the input isn't JSON (${(err as Error).message}), and the input as a whole isn't one JSON value either.`, {
        fix: 'Pass what toil util owi map printed, a JSON array of OWI records, or one record a line.',
      });
    }
  });
}

/** The OWI records in some text, with any that couldn't be read listed in `skipped`. */
export function parseOwiRecords(text: string): OwiRecords {
  const out: OwiRecords = { items: [], skipped: [] };
  const all = values(text);
  all.forEach((value, i) => collect(value, all.length === 1 ? 'the input' : `document ${i + 1}`, out, 0));
  return out;
}

const upper = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function collect(value: unknown, at: string, out: OwiRecords, depth: number): void {
  if (isEnvelope(value)) {
    if (value.meta.command !== 'util owi map') {
      throw new ToilError('INVALID_INPUT', `${upper(at)} is the output of "${value.meta.command}", not OWI records.`, {
        fix: `Map it first: pipe it through toil util owi map, then into toil util owi similar.`,
      });
    }
    if (value.ok !== true) {
      out.skipped.push({ at, reason: 'the util owi map call failed, so it holds no records' });
      return;
    }
    return collect(value.data, at, out, depth);
  }
  if (Array.isArray(value) && depth < 2) {
    value.forEach((entry, i) => collect(entry, `${at}, [${i}]`, out, depth + 1));
    return;
  }
  if (isRecord(value) && Array.isArray(value.items) && !('title' in value)) {
    value.items.forEach((entry, i) => {
      const item = record(entry);
      if (typeof item === 'string') out.skipped.push({ at: `${at}, items[${i}]`, reason: item });
      else out.items.push(item);
    });
    return;
  }
  const item = record(value);
  if (typeof item === 'string') out.skipped.push({ at, reason: item });
  else out.items.push(item);
}

/** One record's scored fields, or why it can't be read. */
function record(value: unknown): SimilarItem | string {
  if (!isRecord(value)) return `it is ${Array.isArray(value) ? 'an array' : value === null ? 'null' : `a ${typeof value}`}, not an OWI record`;
  if (typeof value.id !== 'string' || value.id === '') return 'it has no id';
  if (typeof value.title !== 'string') return `${value.id} has no title`;
  const item: SimilarItem = { id: value.id, title: value.title };
  const body = value.body;
  if (isRecord(body) && BODY_FORMATS.has(body.format as Body['format']) && (typeof body.content === 'string' || isRecord(body.content))) {
    item.body = { format: body.format as Body['format'], content: body.content as Body['content'] };
  }
  if (Array.isArray(value.labels)) item.labels = value.labels.filter((l): l is string => typeof l === 'string');
  if (typeof value.parent === 'string') item.parent = value.parent;
  if (Array.isArray(value.links)) {
    item.links = value.links.filter(
      (l): l is Link => isRecord(l) && typeof l.target === 'string' && LINK_TYPES.has(l.type as LinkType) && (l.direction === 'outward' || l.direction === 'inward') && typeof l.name === 'string',
    );
  }
  const source = value.source;
  if (isRecord(source) && ['area', 'connection', 'key', 'command'].every((k) => typeof source[k] === 'string')) item.source = source as WorkItem['source'];
  if (typeof value.url === 'string') item.url = value.url;
  return item;
}
