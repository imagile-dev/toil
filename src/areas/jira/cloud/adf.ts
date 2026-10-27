/**
 * Jira Cloud's rich-text fields (an issue's description, a comment's body) are
 * Atlassian Document Format: a JSON tree, not a string. toil converts both ways
 * as plainly as it can, and says so rather than pretending to be a renderer:
 *
 * - **In:** text becomes paragraphs, one per run of text between blank lines,
 *   with each single line break kept as a hard break. Nothing else is read into
 *   it: Markdown and wiki markup arrive as the literal characters typed.
 * - **Out:** the ADF Jira returns is passed through untouched, and a plain-text
 *   rendering sits beside it (`descriptionText`, `bodyText`). Formatting is
 *   dropped; text, mentions, emoji, links, dates, list items and table cells
 *   keep their words.
 *
 * The format is documented at
 * https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/.
 * A document format with its own schema for a paragraph is how a memo gets a
 * steering committee.
 */

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  [key: string]: unknown;
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Plain text as an ADF document: blank lines separate paragraphs, single line breaks become hard breaks. */
export function textToAdf(text: string): AdfDocument {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .filter((p) => p.trim() !== '');
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((paragraph) => {
      const lines = paragraph.replace(/^\n+|\n+$/g, '').split('\n');
      const content: AdfNode[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        // ADF refuses an empty text node, so a blank line inside a paragraph is just the break.
        if (line !== '') content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content };
    }),
  };
}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'panel', 'bulletList', 'orderedList', 'table', 'rule', 'mediaSingle', 'mediaGroup', 'expand', 'nestedExpand', 'decisionList', 'taskList', 'blockCard', 'embedCard']);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One inline node's words. */
function inline(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return str(node.text);
    case 'hardBreak':
      return '\n';
    case 'mention':
    case 'status':
      return str(node.attrs?.text);
    case 'emoji':
      return str(node.attrs?.text) || str(node.attrs?.shortName);
    case 'inlineCard':
      return str(node.attrs?.url);
    case 'date':
      return str(node.attrs?.timestamp);
    default:
      return children(node.content);
  }
}

/** A block's text. Lists and tables get a light shape: `- item`, `1. item`, `a | b`. */
function block(node: AdfNode): string {
  switch (node.type) {
    case 'bulletList':
      return (node.content ?? []).map((item) => `- ${children(item.content)}`).join('\n');
    case 'orderedList': {
      const start = typeof node.attrs?.order === 'number' ? node.attrs.order : 1;
      return (node.content ?? []).map((item, i) => `${start + i}. ${children(item.content)}`).join('\n');
    }
    case 'table':
      return (node.content ?? []).map((row) => (row.content ?? []).map((cell) => children(cell.content)).join(' | ')).join('\n');
    case 'rule':
      return '---';
    case 'blockCard':
    case 'embedCard':
      return str(node.attrs?.url);
    default:
      return children(node.content);
  }
}

/** A run of nodes: blocks separated by a line each, inline nodes run together. */
function children(nodes: AdfNode[] | undefined): string {
  if (!nodes?.length) return '';
  const parts: string[] = [];
  let line = '';
  for (const node of nodes) {
    if (BLOCKS.has(node.type) || node.type === 'listItem' || node.type === 'taskItem' || node.type === 'decisionItem') {
      if (line) parts.push(line);
      line = '';
      parts.push(block(node));
    } else {
      line += inline(node);
    }
  }
  if (line) parts.push(line);
  return parts.join('\n');
}

/**
 * The plain text of an ADF document: top-level blocks separated by a blank
 * line. Anything that isn't a document (a string from an older API, null) is
 * returned as text if it's a string and as null otherwise.
 */
export function adfToText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || !Array.isArray((value as AdfNode).content)) return null;
  return ((value as AdfNode).content ?? [])
    .map((node) => (BLOCKS.has(node.type) ? block(node) : inline(node)))
    .filter((text) => text !== '')
    .join('\n\n');
}
