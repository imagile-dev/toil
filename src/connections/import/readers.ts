import { XmlSyntaxError, XmlTokenizer, type XmlElement, type XmlNode } from '../../areas/util/kit/xml.js';
import { ImportFormatError } from './common.js';

/**
 * The two file syntaxes the importers need that nobody here wrote: JSON with
 * comments (editor settings files) and XML with a ceiling on how deep it goes.
 * Both take text that came from a file outside the workspace, so both assume the
 * file was written by someone with a grudge: a size cap lives in the command,
 * and nesting is capped here. A settings file with a hundred levels of brackets
 * is not a settings file, it is an invitation.
 */

/** JSON that may hold `//` and block comments and trailing commas, as VS Code's settings.json does. */
export function parseJsonc(text: string, what: string): unknown {
  const clean = stripJsonc(text.replace(/^\uFEFF/, ''));
  try {
    return JSON.parse(clean) as unknown;
  } catch (err) {
    // JSON.parse's own message quotes the start of the file, and a file here may hold a password: say where, never what.
    if (err instanceof RangeError) throw new ImportFormatError(`${what} is nested too deeply to read.`);
    const at = /position (\d+)/.exec(err instanceof Error ? err.message : '');
    throw new ImportFormatError(`${what} isn't valid JSON${at ? ` (at character ${at[1]})` : ''}.`);
  }
}

/** Removes comments and trailing commas outside strings, keeping everything else byte for byte. */
export function stripJsonc(text: string): string {
  // Pass one: comments. Pass two, on what is left: a comma that only whitespace separates from a closing bracket.
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  let result = '';
  i = 0;
  while (i < out.length) {
    const c = out[i]!;
    if (c === '"') {
      const end = endOfString(out, i);
      result += out.slice(i, end);
      i = end;
    } else if (c === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j]!)) j++;
      if (out[j] !== '}' && out[j] !== ']') result += c;
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

/** The index just past the string that opens at `start`. */
function endOfString(text: string, start: number): number {
  let j = start + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, text.length);
}

const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 200_000;

/** The XML as a tree of elements, refusing one nested deeper than 64 levels or with more than 200,000 elements. */
export function readXml(text: string, what: string): XmlElement[] {
  const top: XmlNode[] = [];
  const open: XmlElement[] = [];
  let elements = 0;
  const tokenizer = new XmlTokenizer((event) => {
    if (event.type === 'open') {
      elements++;
      if (open.length >= MAX_XML_DEPTH) throw new ImportFormatError(`${what} is nested more than ${MAX_XML_DEPTH} levels deep, which no real export is.`);
      if (elements > MAX_XML_ELEMENTS) throw new ImportFormatError(`${what} has more than ${MAX_XML_ELEMENTS} elements, which no real export has.`);
      const element: XmlElement = { type: 'element', name: event.name, attrs: event.attrs, children: [], line: event.line, column: event.column };
      (open.at(-1)?.children ?? top).push(element);
      if (!event.selfClosing) open.push(element);
    } else if (event.type === 'close') open.pop();
    else if (event.type === 'text') (open.at(-1)?.children ?? top).push({ type: 'text', text: event.text, cdata: event.cdata });
  });
  try {
    tokenizer.write(text.replace(/^\uFEFF/, ''));
    tokenizer.end();
  } catch (err) {
    if (err instanceof XmlSyntaxError) throw new ImportFormatError(`${what} isn't valid XML (line ${err.line}, column ${err.column}).`);
    throw err;
  }
  return top.filter((n): n is XmlElement => n.type === 'element');
}

/** The local name of an element, namespace prefix dropped (`RegisteredServers:Name` is `Name`). */
export function local(element: XmlElement): string {
  const colon = element.name.indexOf(':');
  return colon < 0 ? element.name : element.name.slice(colon + 1);
}

/** The element's direct child elements, optionally only those with this local name. */
export function kids(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter((c): c is XmlElement => c.type === 'element' && (name === undefined || local(c) === name));
}

/** The text directly inside an element and its text-only children, trimmed; `undefined` when empty. Walks at most a few levels, never the whole tree. */
export function textIn(element: XmlElement | undefined, depth = 3): string | undefined {
  if (!element) return undefined;
  const parts: string[] = [];
  const walk = (el: XmlElement, left: number) => {
    for (const c of el.children) {
      if (c.type === 'text') parts.push(c.text);
      else if (c.type === 'element' && left > 0) walk(c, left - 1);
    }
  };
  walk(element, depth);
  const text = parts.join('').trim();
  return text === '' ? undefined : text;
}

/** Every descendant element with this local name, in document order, found without recursion. */
export function descendants(root: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (local(el) === name) found.push(el);
    const children = kids(el);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return found;
}
