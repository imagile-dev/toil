import { ToilError } from '../errors.js';
import { isRecord } from '../owi/common.js';
import type { Change, ChangeState, StatusCategory, WorkItem } from '../owi/types.js';

/**
 * Reads the briefing's input back in: what `util owi map` printed (each
 * envelope, or its data), JSON arrays of OWI records, or one record a line,
 * in any mix, so the items and the pull requests can come from separate
 * calls (`jira issue search … | util owi map` and `bitbucket pr list … |
 * util owi map`). A record is a work item when it has a statusCategory and a
 * change when it has a repo and a state. Anything else is skipped and listed
 * with why, never guessed at; the fields the rules read are checked for their
 * shape, and a missing list is read as empty. Forms received in triplicate,
 * filed once.
 */

export interface BriefRecords {
  items: WorkItem[];
  changes: Change[];
  skipped: Array<{ at: string; reason: string }>;
  /** Ids given more than once; the first was kept. */
  duplicates: string[];
}

const CATEGORIES = new Set<StatusCategory>(['TODO', 'IN_PROGRESS', 'DONE', 'UNKNOWN']);
const STATES = new Set<ChangeState>(['OPEN', 'MERGED', 'DECLINED', 'DRAFT']);
const isEnvelope = (v: unknown): v is { ok: unknown; data?: unknown; meta: { command: string } } => isRecord(v) && 'ok' in v && isRecord(v.meta) && typeof v.meta.command === 'string';
const list = (v: unknown) => (Array.isArray(v) ? v : []);

function values(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === '') throw new ToilError('INVALID_INPUT', 'The input is empty.', { fix: 'Pipe OWI records in (toil jira issue search … | toil util owi map | toil dossiers brief), or pass the file that holds them.' });
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

/** The work items and changes in some text. */
export function readBriefRecords(text: string): BriefRecords {
  const out: BriefRecords = { items: [], changes: [], skipped: [], duplicates: [] };
  const seen = new Set<string>();
  const add = (at: string, value: unknown) => {
    const r = record(value);
    if (typeof r === 'string') return void out.skipped.push({ at, reason: r });
    if (seen.has(r.record.id)) return void out.duplicates.push(r.record.id);
    seen.add(r.record.id);
    if (r.kind === 'item') out.items.push(r.record);
    else out.changes.push(r.record);
  };
  const walk = (value: unknown, at: string, depth: number): void => {
    if (isEnvelope(value)) {
      if (value.meta.command !== 'util owi map') {
        throw new ToilError('INVALID_INPUT', `${at === 'the input' ? 'The input' : at} is the output of "${value.meta.command}", not OWI records.`, { fix: `Map it first: pipe it through toil util owi map, then into toil dossiers brief.` });
      }
      if (value.ok !== true) return void out.skipped.push({ at, reason: 'the util owi map call failed, so it holds no records' });
      return walk(value.data, at, depth);
    }
    if (Array.isArray(value) && depth < 2) return value.forEach((v, i) => walk(v, `${at}, [${i}]`, depth + 1));
    if (isRecord(value) && !('title' in value) && (Array.isArray(value.items) || Array.isArray(value.changes))) {
      list(value.items).forEach((v, i) => add(`${at}, items[${i}]`, v));
      list(value.changes).forEach((v, i) => add(`${at}, changes[${i}]`, v));
      return;
    }
    add(at, value);
  };
  const all = values(text);
  all.forEach((v, i) => walk(v, all.length === 1 ? 'the input' : `document ${i + 1}`, 0));
  return out;
}

type Read = { kind: 'item'; record: WorkItem } | { kind: 'change'; record: Change };

function record(v: unknown): Read | string {
  if (!isRecord(v)) return 'it is not an OWI record';
  if (typeof v.id !== 'string' || v.id === '') return 'it has no id';
  if (typeof v.title !== 'string') return `${v.id} has no title`;
  if (typeof v.repo === 'string' && STATES.has(v.state as ChangeState)) {
    return { kind: 'change', record: { ...(v as unknown as Change), workItems: list(v.workItems).filter((w): w is string => typeof w === 'string'), reviewers: list(v.reviewers) as Change['reviewers'] } };
  }
  if (CATEGORIES.has(v.statusCategory as StatusCategory)) {
    const source = isRecord(v.source) && typeof v.source.key === 'string' ? (v.source as WorkItem['source']) : { area: '', connection: v.id.split(':')[0] ?? '', key: v.id.slice(v.id.indexOf(':') + 1), command: '' };
    return { kind: 'item', record: { ...(v as unknown as WorkItem), source, links: list(v.links) as WorkItem['links'], url: typeof v.url === 'string' ? v.url : null } };
  }
  return `${v.id} is neither a work item (no statusCategory) nor a change (no repo and state)`;
}
