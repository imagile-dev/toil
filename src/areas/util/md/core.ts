import type { AdfDocument, AdfNode } from '../../jira-cloud/adf.js';
import { ToilError } from '../../../core/errors.js';
import { parseAdf, renderAdf } from './adf.js';
import { dropEmpty, Losses, normalizeBlocks, type Doc, type Loss } from './ast.js';
import { parseMarkdown, renderBlock, renderMarkdown } from './markdown.js';
import { parseStorage, renderStorage, XmlSyntaxError } from './storage.js';
import { parseWiki, renderWiki } from './wiki.js';

/**
 * The reading and writing behind `util md`, run in the bounded worker
 * (kit/bounded.ts) because its cost is the document's to choose: emphasis,
 * brackets and nesting are parsed by backtracking over the text, and a few
 * hundred kilobytes of `*a ` kept the main thread for over a minute, and a
 * few thousand nested quotes ran it out of stack. Nothing here is async and
 * nothing reads a file; convert.ts sends the text in and gets plain data
 * back. Paperwork is processed in the back office, where the clock is.
 */

export type MdFormat = 'md' | 'wiki' | 'adf' | 'storage';

function parse(format: MdFormat, text: string, losses: Losses | undefined, label: string): Doc {
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

function render(format: MdFormat, doc: Doc, losses: Losses): string | AdfDocument {
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

/** Each block of a canonical document as canonical Markdown: what the round trip compares. */
const printed = (doc: Doc) => doc.blocks.map((b, k) => renderBlock(b, doc.blocks[k - 1]));

export interface Converted {
  /** The output, in the target format. */
  output: string | AdfDocument;
  /** Each block read from the input, printed as canonical Markdown, and where it started. */
  blocks: string[];
  at: string[];
  /** Every loss, with the canonical block it's in (-1 for none). */
  losses: Array<Loss & { block: number }>;
}

/** Reads `text` as `from` and writes it as `to`, noting what was lost on the way. */
export function convertText(from: MdFormat, to: MdFormat, text: string, label: string): Converted {
  const losses = new Losses();
  const read = canonical(parse(from, text, losses, label), losses);
  const output = render(to, read, losses);
  return { output, blocks: printed(read), at: read.at, losses: losses.list };
}

/** The output read back, each block printed as canonical Markdown, for the round trip. */
export function readBack(format: MdFormat, output: unknown): string[] {
  return printed(canonical(format === 'adf' ? parseAdf(output as AdfNode) : parse(format, output as string, undefined, 'The output')));
}
