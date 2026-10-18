import type { AdfDocument, AdfNode } from '../../jira-cloud/adf.js';
import { ToilError } from '../../../core/errors.js';
import type { Warning } from '../../../core/envelope.js';
import type { UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';
import { parseAdf, renderAdf } from './adf.js';
import { dropEmpty, Losses, normalizeBlocks, type Doc, type Loss } from './ast.js';
import { parseMarkdown, renderBlock, renderMarkdown } from './markdown.js';
import { parseStorage, renderStorage, XmlSyntaxError } from './storage.js';
import { parseWiki, renderWiki } from './wiki.js';

/**
 * `util md`: one document converted between Markdown and Jira wiki markup,
 * ADF or Confluence storage format, then checked by converting it back.
 *
 *   1. The input is read into the shared tree (ast.ts), noting losses.
 *   2. The tree is written in the target format, noting losses.
 *   3. The output is read back into a tree and both trees are printed as
 *      canonical Markdown, block by block. Every block that differs is a
 *      difference; a difference with a loss reported in the same block was
 *      expected, and one without is a failed check (`MD_ROUNDTRIP_MISMATCH`).
 *   4. ADF output is validated against the ADF schema, and storage output is
 *      read back as XML, before either is returned. Neither can be returned
 *      broken.
 *
 * `lossless` is true only when nothing was lost and the round trip matched
 * block for block. The conversion is graded by the same office that issued it,
 * which is why the grading is published.
 */

export type Format = 'md' | 'wiki' | 'adf' | 'storage';

export interface MdInput {
  file?: string | undefined;
  text?: string | undefined;
  from?: Format | undefined;
  to?: Format | undefined;
}

export interface Difference {
  /** Where the block starts in the input. */
  at: string;
  /** The block as canonical Markdown before the round trip, and after. */
  expected: string;
  actual: string;
  /** Whether a loss was reported for this block. */
  explained: boolean;
}

export interface MdData {
  from: Format;
  to: Format;
  /** The converted document: an ADF document object for `adf`, text for the others. */
  output: string | AdfDocument;
  lossless: boolean;
  losses: Loss[];
  roundTrip: { blocks: number; differences: Difference[] };
  verified: Verified;
}

/** Stand-ins a test uses to break the conversion on purpose and watch the checks catch it. */
export interface Hooks {
  tamper?: (output: string | AdfDocument) => string | AdfDocument;
}

/** The input cap: a ticket or page, not an archive. */
export const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIFFERENCES = 50;
const MAX_LOSSES = 500;

const NAMES: Record<Format, string> = { md: 'Markdown', wiki: 'Jira wiki markup', adf: 'ADF', storage: 'Confluence storage format' };

function parse(format: Format, text: string, losses: Losses | undefined, label: string): Doc {
  if (format === 'md') return parseMarkdown(text, losses);
  if (format === 'wiki') return parseWiki(text, losses);
  if (format === 'storage') {
    try {
      return parseStorage(text, losses);
    } catch (err) {
      if (err instanceof XmlSyntaxError) {
        throw new ToilError('INVALID_INPUT', `${label} is not well-formed storage format: ${err.message}`, {
          fix: 'Pass the page body exactly as Confluence returns it in body.storage.value. Only XML\'s entities and HTML\'s common named ones (&nbsp;, &mdash; …) are known; write any other as a numeric reference.',
        });
      }
      throw err;
    }
  }
  return parseAdf(adfDocument(text, label), losses);
}

/** The ADF document in `text`, or INVALID_INPUT saying why it isn't one. */
function adfDocument(text: string, label: string): AdfNode {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new ToilError('INVALID_INPUT', `${label} is not JSON: ${(err as Error).message}`, { fix: 'Pass an ADF document: { "type": "doc", "version": 1, "content": [...] }.' });
  }
  if (typeof value !== 'object' || value === null || (value as AdfNode).type !== 'doc' || !Array.isArray((value as AdfNode).content)) {
    throw new ToilError('INVALID_INPUT', `${label} is JSON but not an ADF document: the top level needs "type": "doc" and a "content" array.`, {
      fix: 'Pass the document itself (an issue\'s fields.description, a comment\'s body), not the issue or comment around it.',
    });
  }
  return value as AdfNode;
}

function render(format: Format, doc: Doc, losses: Losses): string | AdfDocument {
  if (format === 'md') return renderMarkdown(doc);
  if (format === 'wiki') return renderWiki(doc, losses);
  if (format === 'storage') return renderStorage(doc, losses);
  return renderAdf(doc, losses);
}

/** The canonical form both sides of the round trip are compared in. */
function canonical(doc: Doc, losses?: Losses): Doc {
  const blocks = normalizeBlocks(doc.blocks);
  const keep = new Set(dropEmpty(blocks));
  // The losses noted while reading name blocks by their place before empty
  // paragraphs went; renumber them, or a loss would explain a block it isn't in.
  // A loss in a dropped block stays in the list but explains no block (-1):
  // handing it to a neighbour would excuse a real change there.
  const index: number[] = [];
  let kept = 0;
  blocks.forEach((b, k) => {
    index[k] = keep.has(b) ? kept++ : -1;
  });
  for (const loss of losses?.list ?? []) loss.block = loss.block < 0 ? -1 : (index[loss.block] ?? -1);
  return { blocks: blocks.filter((b) => keep.has(b)), at: doc.at.filter((_, k) => keep.has(blocks[k]!)) };
}

/** A longest-common-subsequence alignment of two lists of strings, as the runs that differ. */
function hunks(a: string[], b: string[]): Array<{ a: [number, number]; b: [number, number] }> {
  const n = a.length;
  const m = b.length;
  // Past a few million cells the table costs more than it tells: compare position by position.
  if (n * m > 4_000_000) {
    const out: Array<{ a: [number, number]; b: [number, number] }> = [];
    for (let k = 0; k < Math.max(n, m); k++) if (a[k] !== b[k]) out.push({ a: [Math.min(k, n), Math.min(k + 1, n)], b: [Math.min(k, m), Math.min(k + 1, m)] });
    return out;
  }
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Array<{ a: [number, number]; b: [number, number] }> = [];
  let i = 0;
  let j = 0;
  let open: { a: [number, number]; b: [number, number] } | undefined;
  const close = () => {
    if (open) out.push(open);
    open = undefined;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { a: [i, i], b: [j, j] };
    if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) open.b[1] = ++j;
    else open.a[1] = ++i;
  }
  close();
  return out;
}

/** The two formats, or INVALID_INPUT: one of them must be Markdown, and they must differ. */
export function formats(input: Pick<MdInput, 'from' | 'to'>): { from: Format; to: Format } {
  const from: Format = input.from ?? 'md';
  const to: Format = input.to ?? 'md';
  if (from === to || (from !== 'md' && to !== 'md')) {
    throw new ToilError('INVALID_INPUT', from === to ? `Nothing to convert: from and to are both ${NAMES[from]}.` : `util md converts to or from Markdown, not from ${NAMES[from]} to ${NAMES[to]}.`, {
      fix: 'Pass --to wiki|adf|storage to convert Markdown, or --from wiki|adf|storage to convert to Markdown.',
    });
  }
  return { from, to };
}

/**
 * Converts `text`, read from `source`, checks the result, and returns it with
 * what was checked. The command reads the input before this module loads:
 * the input reader brings zod with it, which must stay out of anything
 * loaded lazily (docs/util.md).
 */
export async function convertMarkdown(
  input: { from?: Format | undefined; to?: Format | undefined; text: string; source: Pick<UtilInput, 'source' | 'expectedBytes' | 'bytesRead' | 'truncated' | 'label'> },
  ctx: { warn: (w: Warning) => void },
  hooks: Hooks = {},
): Promise<MdData> {
  const { from, to } = formats(input);
  const { text, source } = input;
  const v = new Verifier(ctx.warn);
  v.inputComplete(source);

  const losses = new Losses();
  const read = canonical(parse(from, text, losses, source.label.replace(/^the /, 'The ')), losses);
  if (from === 'adf') {
    const schema = await validateAdf(JSON.parse(text));
    v.expect('input.adf.schema', schema.valid, { at: schema.problems[0]?.pointer ?? '', expected: 'a document the ADF schema accepts', actual: schema.problems[0]?.message }, { code: 'ADF_INPUT_INVALID', message: `The input doesn't match the ADF schema at ${schema.problems[0]?.pointer || '/'}: ${schema.problems[0]?.message ?? ''} (${schema.total} problem(s)); it was converted as far as it could be read.` });
  }

  let output = render(to, read, losses);
  if (hooks.tamper) output = hooks.tamper(output);

  if (to === 'adf') {
    const schema = await validateAdf(output);
    if (!schema.valid) {
      const where = schema.problems.slice(0, 3).map((p) => `${p.pointer || '/'}: ${p.message}`).join('; ');
      throw new ToilError('INTERNAL', `The ADF this produced doesn't match the ADF schema (${schema.total} problem(s): ${where}), so it isn't returned.`, {
        fix: 'This is a bug in util md: report it with the input that caused it. Converting to wiki or storage instead may work in the meantime.',
      });
    }
    v.pass('output.adf.schema');
  }

  // The round trip: read what was written, and compare it with what was read, block by block.
  let back: Doc;
  try {
    back = canonical(to === 'adf' ? parseAdf(output as unknown as AdfNode) : parse(to, output as string, undefined, 'The output'));
  } catch (err) {
    if (to === 'storage') {
      throw new ToilError('INTERNAL', `The storage format this produced is not well-formed XML (${(err as Error).message}), so it isn't returned.`, {
        fix: 'This is a bug in util md: report it with the input that caused it.',
      });
    }
    throw err;
  }
  if (to === 'storage') v.pass('output.storage.wellFormed');

  const printed = (doc: Doc) => doc.blocks.map((b, k) => renderBlock(b, doc.blocks[k - 1]));
  const before = printed(read);
  const after = printed(back);
  const lostIn = new Set(losses.list.map((l) => l.block));
  const differences: Difference[] = [];
  const diff = hunks(before, after);
  const changed = new Set<number>();
  let judged = 0;
  const judge = (aFrom: number, aTo: number, bFrom: number, bTo: number) => {
    const blocks = Array.from({ length: aTo - aFrom }, (_, k) => aFrom + k);
    for (const k of blocks) changed.add(k);
    // Only a block's own loss explains it. A run that gained or lost blocks is
    // explained only if every block in it had one; a block from nowhere never is.
    const explained = blocks.length > 0 && blocks.every((k) => lostIn.has(k));
    const at = read.at[aFrom] ?? read.at.at(-1) ?? 'the end';
    const expected = before.slice(aFrom, aTo).join('\n\n');
    const actual = after.slice(bFrom, bTo).join('\n\n');
    v.expect('roundTrip.blocks', explained, { at, expected, actual }, { code: 'MD_ROUNDTRIP_MISMATCH' });
    judged++;
    if (differences.length < MAX_DIFFERENCES) differences.push({ at, expected, actual, explained });
  };
  for (const h of diff) {
    const [a0, a1] = h.a;
    const [b0, b1] = h.b;
    // The same number of blocks on both sides: each changed into its counterpart, judged on its own.
    if (a1 - a0 === b1 - b0) for (let k = 0; k < a1 - a0; k++) judge(a0 + k, a0 + k + 1, b0 + k, b0 + k + 1);
    else judge(a0, a1, b0, b1);
  }
  for (let k = 0; k < before.length; k++) if (!changed.has(k)) v.pass('roundTrip.blocks');
  if (before.length === 0 && diff.length === 0) v.pass('roundTrip.blocks');
  if (judged > MAX_DIFFERENCES) ctx.warn({ code: 'MD_DIFFERENCES_CUT', message: `${judged} blocks differ after the round trip; the first ${MAX_DIFFERENCES} are listed.` });

  reportLosses(losses, ctx.warn);
  return {
    from,
    to,
    output,
    lossless: diff.length === 0 && losses.list.length === 0,
    losses: losses.list.slice(0, MAX_LOSSES).map(({ construct, at, detail }) => ({ construct, at, detail })),
    roundTrip: { blocks: before.length, differences },
    verified: v.done(),
  };
}

/** One warning per kind of loss, with where it happened. */
function reportLosses(losses: Losses, warn: (w: Warning) => void) {
  const byConstruct = new Map<string, Loss[]>();
  for (const loss of losses.list) {
    const list = byConstruct.get(loss.construct) ?? [];
    list.push(loss);
    byConstruct.set(loss.construct, list);
  }
  for (const [construct, list] of byConstruct) {
    const places = [...new Set(list.map((l) => l.at))];
    const shown = places.slice(0, 5).join(', ') + (places.length > 5 ? `, and ${places.length - 5} more` : '');
    warn({ code: 'MD_LOSSY', message: `${construct} at ${shown}: ${list[0]!.detail}.` });
  }
  if (losses.list.length > MAX_LOSSES) warn({ code: 'MD_LOSSES_CUT', message: `${losses.list.length} losses were found; data.losses lists the first ${MAX_LOSSES}.` });
}

let adfSchema: unknown;

/** Validates against the bundled ADF schema (@atlaskit/adf-schema's full.json), loading both only when asked. */
export async function validateAdf(value: unknown) {
  const [{ validateSchema }, schema] = await Promise.all([import('../kit/json-schema.js'), adfSchema ?? import('./adf-schema.json', { with: { type: 'json' } }).then((m) => m.default)]);
  adfSchema = schema;
  return validateSchema(schema as never, value, { maxProblems: 20 });
}

