/**
 * The classification ledger: what `classify run --record` kept, what people
 * corrected, and the arithmetic that turns the two into "where the scheme gets
 * it wrong" (#566, docs/work-classification-proposal.md, Step 4). Two halves.
 * The pure half reads JSONL tolerantly, finds the last word on each item, and
 * scores sources and revisions; the `Ledger` half owns `~/.toil/classify/
 * <scheme>.jsonl`, in the scheme catalog's manner: a name held to
 * SCHEME_NAME, a folder only you can open, a path judged after realpath, one
 * append call per batch so two writers never interleave, and no credential
 * ever written. The ledger stays on the person's machine; what a team shares
 * is the sharper scheme file. Every disagreement is filed here, which is more
 * than the escalation form on the intranet ever promised.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ToilError } from '../errors.js';
import { forwardSlashes } from '../files.js';
import { findSecrets } from '../secret-shapes.js';
import { inside } from '../toil-project.js';
import {
  LEDGER_DOORS,
  LEDGER_TEXT_MAX,
  MAX_LEDGER_BYTES,
  type Backtest,
  type ClassifyStats,
  type LedgerCorrection,
  type LedgerDoor,
  type LedgerLine,
  type LedgerStanding,
  type LedgerVerdict,
  type SourceScore,
} from './ledger-types.js';
import { SCHEME_NAME, UNSURE, type Scheme } from './types.js';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** A title or reason as the ledger keeps it: control and bidirectional-override characters dropped, one line, cut to LEDGER_TEXT_MAX. */
export function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex -- the point is to drop them
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > LEDGER_TEXT_MAX ? `${flat.slice(0, LEDGER_TEXT_MAX - 3)}...` : flat;
}

/** `cleanText`, with anything shaped like a credential replaced by `[redacted]`: a ledger holds none, whatever a title says. */
export function safeText(text: string): string {
  const flat = cleanText(text);
  const hits = findSecrets(flat);
  if (hits.length === 0) return flat;
  let out = flat;
  for (const hit of [...hits].sort((a, b) => b.index - a.index)) out = `${out.slice(0, hit.index)}[redacted]${out.slice(hit.index + hit.length)}`;
  return cleanText(out);
}

/** A line as the ledger keeps it: title and reason cleaned and scrubbed of anything shaped like a credential. */
export function cleanLine(line: LedgerLine): LedgerLine {
  return line.kind === 'correction' ? { ...line, title: safeText(line.title), reason: line.reason === null ? null : safeText(line.reason) } : { ...line, title: safeText(line.title) };
}

function readLine(value: unknown): LedgerLine | undefined {
  if (!isRecord(value)) return undefined;
  const common = isText(value.at) && isText(value.item) && isText(value.title) && isTextOrNull(value.toilProject) && isText(value.scheme) && typeof value.revision === 'number';
  if (!common) return undefined;
  if (value.kind === 'verdict') {
    if (!isTextOrNull(value.category) || !isText(value.source)) return undefined;
    return value as unknown as LedgerVerdict;
  }
  if (value.kind === 'correction') {
    const via = value.via;
    if (!isTextOrNull(value.from) || !isTextOrNull(value.fromSource) || !isText(value.to) || typeof value.confirmed !== 'boolean') return undefined;
    if (!isText(via) || !(LEDGER_DOORS as readonly string[]).includes(via) || !isTextOrNull(value.by) || !isTextOrNull(value.reason)) return undefined;
    return value as unknown as LedgerCorrection;
  }
  return undefined;
}

/**
 * Reads a ledger's text. A line that isn't JSON, isn't a known kind or lacks a
 * field is skipped and counted, never fatal: a crash mid-append leaves a torn
 * last line, and one bad line must not lose the rest. CRLF is accepted.
 */
export function parseLedger(text: string): { lines: LedgerLine[]; skipped: number } {
  const lines: LedgerLine[] = [];
  let skipped = 0;
  for (const raw of text.split('\n')) {
    const row = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (row.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch {
      skipped++;
      continue;
    }
    const line = readLine(parsed);
    if (line) lines.push(line);
    else skipped++;
  }
  return { lines, skipped };
}

/**
 * The last word on each item, in file order (the order lines were appended,
 * which is the order things happened; the clock on two machines is not). A
 * correction's `to` stands as source `person`, whoever recorded it.
 */
export function standing(lines: readonly LedgerLine[]): Map<string, LedgerStanding> {
  const out = new Map<string, LedgerStanding>();
  for (const line of lines) {
    const before = out.get(line.item);
    const corrections = (before?.corrections ?? 0) + (line.kind === 'correction' && !line.confirmed ? 1 : 0);
    const title = line.title !== '' ? line.title : (before?.title ?? line.item);
    if (line.kind === 'verdict') out.set(line.item, { item: line.item, title, category: line.category, source: line.source, corrections });
    // A person who says unsure has taken the category back, not chosen one.
    else out.set(line.item, { item: line.item, title, category: line.to === UNSURE ? null : line.to, source: 'person', corrections });
  }
  return out;
}

/** Each item's last correction, for the engine: a person's say, by item id. */
export function personSay(lines: readonly LedgerLine[]): Record<string, { category: string; reason: string | null }> {
  const out: Record<string, { category: string; reason: string | null }> = {};
  for (const line of lines) {
    if (line.kind !== 'correction') continue;
    // Saying "unsure" asks for a fresh look, so it is no category to hold the rules to.
    if (line.to === UNSURE) delete out[line.item];
    else out[line.item] = { category: line.to, reason: line.reason };
  }
  return out;
}

/**
 * Whether an item is held back from the tune prompt, so a revised scheme is
 * scored on items it never saw. The first four bytes of the SHA-256 of the id,
 * as a big-endian number, modulo 3: zero holds the item back, about a third of
 * all ids. No randomness and no list to pass, so `classify tune` and `classify
 * stats --backtest` agree on every machine and every day.
 */
export function heldBack(itemId: string): boolean {
  return createHash('sha256').update(itemId, 'utf8').digest().readUInt32BE(0) % 3 === 0;
}

const share = (confirmed: number, checked: number): number | null => (checked === 0 ? null : Math.round((confirmed / checked) * 1000) / 1000);

/**
 * What the ledger says about a scheme. Only a correction checks a verdict,
 * and only one whose `from` the classifier gave: where the ledger held nothing
 * (`fromSource` null) there was nothing to check, and where a person's earlier
 * say was changed (`fromSource` `person`) it is a changed mind, shown under
 * `changedTwice` and not held against the rules. Shares are null, never 0,
 * where nothing was checked.
 */
export function ledgerStats(lines: readonly LedgerLine[], scheme: Scheme, options: { toilProject?: string | null | undefined } = {}): ClassifyStats {
  const toilProject = options.toilProject ?? null;
  const within = toilProject === null ? lines : lines.filter((l) => l.toilProject === toilProject);

  let verdicts = 0;
  let corrections = 0;
  let confirmations = 0;
  const items = new Set<string>();
  const byDoor: Record<LedgerDoor, number> = { cli: 0, mcp: 0, api: 0, tracker: 0 };
  const revisionOf = new Map<string, number>();
  const sources = new Map<string, SourceScore>();
  const categories = new Map<string, { checked: number; confirmed: number }>(scheme.categories.map((c) => [c.id, { checked: 0, confirmed: 0 }]));
  const revisions = new Map<number, { checked: number; confirmed: number }>();
  const confusion = new Map<string, { from: string; to: string; count: number }>();
  const twice = new Map<string, { item: string; title: string; corrections: number }>();
  let sinceLastTune = 0;
  let checked = 0;
  let confirmed = 0;

  for (const line of within) {
    items.add(line.item);
    if (line.kind === 'verdict') {
      verdicts++;
      revisionOf.set(line.item, line.revision);
      continue;
    }
    if (line.confirmed) confirmations++;
    else {
      corrections++;
      byDoor[line.via]++;
      if (line.revision === scheme.revision) sinceLastTune++;
      const t = twice.get(line.item);
      twice.set(line.item, { item: line.item, title: line.title || (t?.title ?? line.item), corrections: (t?.corrections ?? 0) + 1 });
    }
    if (line.fromSource === null || line.fromSource === 'person') continue;

    checked++;
    if (line.confirmed) confirmed++;
    const was = line.from ?? UNSURE;
    const revision = revisionOf.get(line.item) ?? line.revision;

    const source = sources.get(line.fromSource) ?? { source: line.fromSource, checked: 0, confirmed: 0, overruled: 0, overruledTo: {}, agreement: null };
    source.checked++;
    if (line.confirmed) source.confirmed++;
    else {
      source.overruled++;
      source.overruledTo[line.to] = (source.overruledTo[line.to] ?? 0) + 1;
    }
    sources.set(line.fromSource, source);

    const c = categories.get(was) ?? { checked: 0, confirmed: 0 };
    c.checked++;
    if (line.confirmed) c.confirmed++;
    categories.set(was, c);

    const r = revisions.get(revision) ?? { checked: 0, confirmed: 0 };
    r.checked++;
    if (line.confirmed) r.confirmed++;
    revisions.set(revision, r);

    if (!line.confirmed) {
      const key = `${was}\u0000${line.to}`;
      const k = confusion.get(key) ?? { from: was, to: line.to, count: 0 };
      k.count++;
      confusion.set(key, k);
    }
  }

  return {
    scheme: { name: scheme.name, revision: scheme.revision },
    toilProject,
    ledger: { lines: within.length, verdicts, corrections, confirmations, items: items.size },
    agreement: {
      overall: share(confirmed, checked),
      checked,
      byCategory: [...categories.entries()].map(([category, c]) => ({ category, checked: c.checked, confirmed: c.confirmed, agreement: share(c.confirmed, c.checked) })),
      byRevision: [...revisions.entries()].sort((a, b) => a[0] - b[0]).map(([revision, r]) => ({ revision, checked: r.checked, confirmed: r.confirmed, agreement: share(r.confirmed, r.checked) })),
    },
    sources: [...sources.values()]
      .map((s) => ({ ...s, agreement: share(s.confirmed, s.checked) }))
      .sort((a, b) => b.overruled - a.overruled || b.checked - a.checked || a.source.localeCompare(b.source)),
    confusion: [...confusion.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    sinceLastTune,
    changedTwice: [...twice.values()].filter((t) => t.corrections > 1).sort((a, b) => b.corrections - a.corrections || a.item.localeCompare(b.item)),
    byDoor,
  };
}

/** One held-back item as a backtest scores it: what people finally said, and what the scheme as it was had said. */
export interface HeldBackItem {
  item: string;
  title: string;
  people: string;
  before: string | null;
}

/**
 * The held-back items a backtest can score: each item whose id is held back and
 * that people checked, with the classifier's first verdict the ledger knew
 * (`before`) and the person's last word (`people`). An item whose first
 * correction found nothing recorded has no "before" to compare, so it is left
 * out and counted in `unscored`, rather than scored as a miss for a scheme that
 * never gave an answer.
 */
export function heldBackItems(lines: readonly LedgerLine[], options: { toilProject?: string | null | undefined } = {}): { items: HeldBackItem[]; unscored: number } {
  const toilProject = options.toilProject ?? null;
  const first = new Map<string, LedgerCorrection>();
  const last = new Map<string, LedgerCorrection>();
  for (const line of lines) {
    if (line.kind !== 'correction' || !heldBack(line.item)) continue;
    if (toilProject !== null && line.toilProject !== toilProject) continue;
    if (!first.has(line.item)) first.set(line.item, line);
    last.set(line.item, line);
  }
  const items: HeldBackItem[] = [];
  let unscored = 0;
  for (const [item, c] of first) {
    if (c.fromSource === null) {
      unscored++;
      continue;
    }
    const final = last.get(item)!;
    items.push({ item, title: final.title, people: final.to, before: c.from });
  }
  return { items, unscored };
}

/**
 * Scores the scheme as it was and as revised against what people said, on the
 * held-back items. `after` maps an item to the revised scheme's category, null
 * for unsure, and has no entry for an item nothing answered; those count in
 * `missing` and as not agreed, so a partial answer can't flatter the revision.
 * `worse` is true when the revision scores lower; toil changes nothing either way.
 */
export function backtest(input: { items: readonly HeldBackItem[]; revision: number; revised: string; after: ReadonlyMap<string, string | null> }): Backtest {
  const { items } = input;
  let beforeAgreed = 0;
  let afterAgreed = 0;
  let unsure = 0;
  let missing = 0;
  const disagreements: Backtest['disagreements'] = [];
  for (const h of items) {
    if (h.before === h.people) beforeAgreed++;
    const has = input.after.has(h.item);
    const after = has ? input.after.get(h.item)! : null;
    if (!has) missing++;
    else if (after === null) unsure++;
    if (has && after === h.people) afterAgreed++;
    else disagreements.push({ item: h.item, title: h.title, people: h.people, before: h.before, after });
  }
  const before = share(beforeAgreed, items.length);
  const after = share(afterAgreed, items.length);
  return {
    heldBack: items.length,
    before: { revision: input.revision, agreed: beforeAgreed, agreement: before },
    after: { scheme: input.revised, agreed: afterAgreed, unsure, missing, agreement: after },
    disagreements,
    worse: before !== null && after !== null && after < before,
  };
}

export interface LedgerOptions {
  /** The user's home folder; the ledger lives in `<home>/.toil/classify`. */
  home: string;
}

/** The ledger's files, one per scheme, in the folder the person's own schemes are in. */
export class Ledger {
  readonly folder: string;
  constructor(options: LedgerOptions) {
    this.folder = join(options.home, '.toil', 'classify');
  }

  /** Where a scheme's ledger is (or would be), as a path on disk. */
  path(scheme: string): string {
    if (!SCHEME_NAME.test(scheme)) {
      throw new ToilError('INVALID_INPUT', `"${scheme}" isn't a scheme name, so it has no ledger.`, { fix: 'A name is lowercase letters, digits and single hyphens, e.g. ktlo-feature.' });
    }
    return join(this.folder, `${scheme}.jsonl`);
  }

  /** A path's canonical form whether or not it exists yet: the nearest part that does, real-pathed, with the rest added back. */
  private real(path: string): string {
    let existing = resolve(path);
    const rest: string[] = [];
    for (;;) {
      try {
        return join(realpathSync.native(existing), ...rest);
      } catch {
        const parent = resolve(existing, '..');
        if (parent === existing) return resolve(path);
        rest.unshift(basename(existing));
        existing = parent;
      }
    }
  }

  /** The file, after realpath, refused when a link would take it out of the ledger folder. */
  private safe(scheme: string): string {
    const file = this.path(scheme);
    const target = this.real(file);
    if (!inside(target, this.real(this.folder))) {
      throw new ToilError('INVALID_INPUT', `The ledger ${forwardSlashes(file)} is a link to ${forwardSlashes(target)}, outside ${forwardSlashes(this.folder)}, so toil won't use it.`, {
        fix: 'Remove the link, or move the file back into your classify folder.',
      });
    }
    return target;
  }

  private tooBig(file: string): ToilError {
    return new ToilError('INVALID_INPUT', `The ledger ${forwardSlashes(file)} is larger than ${MAX_LEDGER_BYTES / (1024 * 1024)} MiB, the most toil reads.`, {
      fix: `Start a new one: rename ${forwardSlashes(file)} (for example to ${basename(file).replace(/\.jsonl$/, '')}-old.jsonl) and toil begins an empty ledger on the next record.`,
    });
  }

  /** A scheme's ledger lines. A missing file is an empty ledger, not an error. */
  read(scheme: string): { lines: LedgerLine[]; skipped: number; file: string } {
    const file = this.safe(scheme);
    let fd: number;
    try {
      fd = openSync(file, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [], skipped: 0, file: forwardSlashes(file) };
      throw new ToilError('CONFIG_INVALID', `The ledger ${forwardSlashes(file)} can't be read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.`, { fix: `Check that ${forwardSlashes(file)} is readable.` });
    }
    try {
      if (fstatSync(fd).size > MAX_LEDGER_BYTES) throw this.tooBig(file);
      // Read from the open file and stop a byte past the cap, so a file that grows meanwhile still can't be read whole.
      const buffer = Buffer.alloc(MAX_LEDGER_BYTES + 1);
      let length = 0;
      for (;;) {
        const n = readSync(fd, buffer, length, buffer.length - length, null);
        if (n === 0) break;
        length += n;
        if (length > MAX_LEDGER_BYTES) throw this.tooBig(file);
      }
      return { ...parseLedger(buffer.toString('utf8', 0, length)), file: forwardSlashes(file) };
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Appends lines in one write to a file opened for append, so two writers
   * (a CLI and a Toil UI, say) never interleave inside a line. Titles and
   * reasons are cleaned and scrubbed of anything shaped like a credential on
   * the way in; nothing else is ever in a line.
   */
  append(scheme: string, lines: readonly LedgerLine[]): { file: string } {
    const file = this.safe(scheme);
    if (lines.length === 0) return { file: forwardSlashes(file) };
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    // Judged again now the folder exists: a link made since the first look still can't lead out.
    const target = this.safe(scheme);
    try {
      if (statSync(target).size > MAX_LEDGER_BYTES) throw this.tooBig(target);
    } catch (err) {
      if (err instanceof ToilError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new ToilError('CONFIG_INVALID', `The ledger ${forwardSlashes(target)} can't be written: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.`, { fix: `Check that ${forwardSlashes(this.folder)} is writable.` });
    }
    const text = lines
      .map((line) => `${JSON.stringify(cleanLine(line))}
`)
      .join('');
    appendFileSync(target, text, { encoding: 'utf8', mode: 0o600 });
    return { file: forwardSlashes(target) };
  }
}
