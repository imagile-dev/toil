import { instant, isRecord, person, str } from './common.js';
import type { Comment } from './types.js';

/**
 * The comments a work item's record carries, as OWI's optional `comments`.
 * Jira returns them inside the search itself when `comment` is asked for, so
 * reading them costs no request of their own. The newest ones are kept, since
 * the question a stand-up asks ("has anyone answered?") is about the end of the
 * thread, and each text is flattened to plain text and capped: tracker markup
 * is somebody else's formatting, and a record the size of a design review has
 * no business inside a cache of every item.
 * The newest is last, as the tracker lists them. Nobody has ever read a thread
 * newest-first and enjoyed the experience, including the ones who wrote it.
 */

/** The most comments one item keeps, the newest. */
export const MAX_COMMENTS = 20;
/** The most characters of one comment kept. */
export const MAX_COMMENT_TEXT = 500;

/** Text of an Atlassian Document Format node, paragraphs joined by a space. */
function adfText(node: unknown, out: string[]): void {
  if (!isRecord(node)) return;
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
  else if (node.type === 'mention' && isRecord(node.attrs) && typeof node.attrs.text === 'string') out.push(node.attrs.text);
  else if (node.type === 'hardBreak') out.push(' ');
  if (Array.isArray(node.content)) {
    for (const child of node.content) adfText(child, out);
    if (node.type === 'paragraph' || node.type === 'heading') out.push(' ');
  }
}

/** The text with each control character (C0 and C1) a space, so a comment can't move the cursor, ring a bell or end a line early. */
const withoutControls = (text: string) => Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || (ch.charCodeAt(0) >= 127 && ch.charCodeAt(0) < 160) ? ' ' : ch)).join('');

/** A comment body as plain text on one line: ADF's text, or wiki and Markdown markup with the markup taken out; control characters dropped. */
export function plainText(body: unknown): string {
  let raw = '';
  if (typeof body === 'string') raw = body;
  else if (isRecord(body)) {
    const parts: string[] = [];
    adfText(body, parts);
    raw = parts.join('');
  }
  return (
    withoutControls(raw)
      .replace(/\{(?:code|noformat)[^}]*\}[\s\S]*?\{(?:code|noformat)\}/g, ' ')
      .replace(/\[~(?:accountid:)?([^\]]+)\]/gi, '@$1')
      .replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1')
      .replace(/!\S+?!/g, ' ')
      .replace(/\{[a-z]+(?::[^}]*)?\}/gi, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/([*_~`])(\S[^*_~`]*?)\1/g, '$2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const cap = (text: string) => (text.length > MAX_COMMENT_TEXT ? `${text.slice(0, MAX_COMMENT_TEXT - 1)}…` : text);

/**
 * The comments of a Jira issue's `comment` field, or undefined when the record
 * doesn't hold the field (not read, which is not the same as no comments).
 */
export function jiraComments(field: unknown, itemUrl: string | null): Comment[] | undefined {
  if (!isRecord(field) || !Array.isArray(field.comments)) return undefined;
  const out: Comment[] = [];
  for (const c of field.comments) {
    if (!isRecord(c)) continue;
    const id = str(c.id) ?? (typeof c.id === 'number' ? String(c.id) : null);
    const at = instant(c.created);
    if (id === null || !at) continue;
    const author = isRecord(c.author) ? person(c.author.accountId ?? c.author.name ?? c.author.key, c.author.displayName, c.author.emailAddress) : null;
    out.push({ id, author, at, text: cap(plainText(c.body)), url: itemUrl ? `${itemUrl}?focusedCommentId=${encodeURIComponent(id)}` : null });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.slice(-MAX_COMMENTS);
}

/** Whether a comment reads as a question: it has a question mark outside a link. */
export const isQuestion = (text: string): boolean => text.replace(/\bhttps?:\/\/\S+/gi, ' ').includes('?');

const same = (a: Comment['author'], b: Comment['author']) => a !== null && b !== null && a.id.toLowerCase() === b.id.toLowerCase();

/**
 * The questions on one item nobody else has answered: a comment that reads as
 * a question with no later comment by anyone but its own author. Asking again
 * under your own question is a nudge, not an answer.
 */
export function outstandingQuestions(comments: readonly Comment[]): Comment[] {
  const sorted = [...comments].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return sorted.filter((c, i) => c.author !== null && isQuestion(c.text) && !sorted.slice(i + 1).some((later) => !same(later.author, c.author)));
}
