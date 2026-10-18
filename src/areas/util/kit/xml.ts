/**
 * A small XML reader for the `util` commands: test and coverage reports
 * (JUnit, TRX, Cobertura) and Confluence's storage format. Built in rather
 * than a dependency, because what these need is narrow: elements,
 * attributes, text, CDATA, comments and processing instructions, with the
 * five predefined entities and character references, and positions for
 * every error.
 *
 * - **Streaming.** `XmlTokenizer` takes text in chunks of any size and emits
 *   events as soon as each construct is complete, so a report of any size is
 *   read holding one construct at a time. `parseXml` builds a tree on top.
 * - **Well-formed or refused.** A mismatched or unclosed tag, a duplicate
 *   attribute, a bare `&`, an unknown entity or text outside the root is an
 *   `XmlSyntaxError` with the line and column.
 * - **No DTD processing.** A DOCTYPE is reported as an event and nothing in
 *   it is applied: entities it declares stay unknown, so nothing expands
 *   without bound and nothing is fetched. Extra named entities (HTML's, for
 *   storage format) come only from the caller, as `entities`.
 * - **Names as written.** A prefixed name (`ac:structured-macro`) is kept
 *   whole; `localName` strips the prefix. Namespaces aren't resolved.
 *
 * A markup language whose specification runs to forty pages, read here with
 * the five entities anyone has ever needed and a polite refusal for the rest.
 */

export interface XmlPosition {
  line: number;
  column: number;
}

export type XmlEvent =
  | ({ type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean } & XmlPosition)
  | ({ type: 'close'; name: string } & XmlPosition)
  /** Text may arrive in several events in a row; join them. */
  | ({ type: 'text'; text: string; cdata: boolean } & XmlPosition)
  | ({ type: 'comment'; text: string } & XmlPosition)
  | ({ type: 'pi'; target: string; body: string } & XmlPosition)
  | ({ type: 'doctype'; body: string } & XmlPosition);

export interface XmlOptions {
  /** Named entities beyond XML's five, without `&` and `;`: `{ nbsp: '\u00a0' }`. */
  entities?: Readonly<Record<string, string>>;
  /** Accept a fragment: any number of top-level elements and text, as storage format is. Default false: one root element. */
  fragment?: boolean;
  /** The longest single construct (a tag, a comment, a CDATA section) before it's refused. Default 16 MiB. */
  maxToken?: number;
}

export class XmlSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'XmlSyntaxError';
  }
}

const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const NAME = /^[A-Za-z_:\u00c0-\uffff][\w:.\u00b7\u00c0-\uffff-]*$/;
const DEFAULT_MAX_TOKEN = 16 * 1024 * 1024;

/** `ac:structured-macro` -> `structured-macro`. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Pushes events to `onEvent` as text arrives through `write`. Call `end` once, after the last chunk. */
export class XmlTokenizer {
  private buffer = '';
  private line = 1;
  private column = 1;
  private readonly stack: string[] = [];
  private roots = 0;
  private ended = false;
  private readonly entities: Readonly<Record<string, string>>;
  private readonly maxToken: number;

  constructor(
    private readonly onEvent: (event: XmlEvent) => void,
    private readonly options: XmlOptions = {},
  ) {
    this.entities = { ...options.entities, ...PREDEFINED };
    this.maxToken = options.maxToken ?? DEFAULT_MAX_TOKEN;
  }

  /** The element names open at this point, outermost first. */
  get open(): readonly string[] {
    return this.stack;
  }

  write(chunk: string): void {
    if (this.ended) throw new Error('write() after end()');
    // A byte-order mark is not content.
    this.buffer += this.line === 1 && this.column === 1 && this.buffer === '' ? chunk.replace(/^\ufeff/, '') : chunk;
    this.drain(false);
  }

  end(): void {
    this.ended = true;
    this.drain(true);
    if (this.stack.length) throw this.error(`<${this.stack.at(-1)!}> is never closed`);
    if (!this.options.fragment && this.roots === 0) throw this.error('There is no root element');
  }

  private error(message: string, at: XmlPosition = { line: this.line, column: this.column }): XmlSyntaxError {
    return new XmlSyntaxError(message, at.line, at.column);
  }

  /** Moves the position past `text`. */
  private advance(text: string) {
    let nl = text.indexOf('\n');
    if (nl === -1) {
      this.column += text.length;
      return;
    }
    let last = nl;
    while (nl !== -1) {
      this.line++;
      last = nl;
      nl = text.indexOf('\n', nl + 1);
    }
    this.column = text.length - last;
  }

  private drain(final: boolean) {
    for (;;) {
      const lt = this.buffer.indexOf('<');
      if (lt !== 0) {
        // Text up to the next tag. Without a tag in sight, hold back a possible half-read entity.
        let end = lt === -1 ? this.buffer.length : lt;
        if (lt === -1 && !final) {
          // Entities are short; past 32 characters an `&` is not the start of one, and holding text back would cost memory.
          const amp = this.buffer.lastIndexOf('&');
          if (amp !== -1 && this.buffer.length - amp <= 32 && this.buffer.indexOf(';', amp) === -1) end = amp;
          // A trailing ] or ]] may be the start of a ]]> the next chunk finishes, which text may not hold.
          while (end > 0 && end > this.buffer.length - 2 && this.buffer[end - 1] === ']') end--;
          // A CR may be half of a CRLF.
          if (end > 0 && this.buffer[end - 1] === '\r') end--;
        }
        if (end === 0) return;
        this.text(this.buffer.slice(0, end));
        this.consume(end);
        if (lt === -1) return;
        continue;
      }
      const length = this.markup(final);
      if (length === 0) {
        if (this.buffer.length > this.maxToken) throw this.error(`A single construct is longer than ${this.maxToken} characters`);
        if (final) throw this.error('The document ends inside markup');
        return;
      }
    }
  }

  private consume(n: number) {
    this.advance(this.buffer.slice(0, n));
    this.buffer = this.buffer.slice(n);
  }

  /** Handles the markup at the start of the buffer and returns how much it used, or 0 when it isn't all here yet. */
  private markup(final: boolean): number {
    const b = this.buffer;
    const at: XmlPosition = { line: this.line, column: this.column };
    const startsWith = (prefix: string) => b.startsWith(prefix) || (!final && prefix.startsWith(b));
    const until = (close: string, from: number) => {
      const i = b.indexOf(close, from);
      return i === -1 ? -1 : i + close.length;
    };
    if (startsWith('<!--')) {
      if (b.length < 4) return 0;
      const end = until('-->', 4);
      if (end === -1) return 0;
      this.onEvent({ type: 'comment', text: b.slice(4, end - 3), ...at });
      this.consume(end);
      return end;
    }
    if (startsWith('<![CDATA[')) {
      if (b.length < 9) return 0;
      const end = until(']]>', 9);
      if (end === -1) return 0;
      this.inElementOrFragment(at, true);
      this.onEvent({ type: 'text', text: b.slice(9, end - 3).replace(/\r\n?/g, '\n'), cdata: true, ...at });
      this.consume(end);
      return end;
    }
    if (startsWith('<!DOCTYPE')) {
      if (b.length < 9) return 0;
      // An internal subset in brackets may hold `>`; the DOCTYPE ends at the first `>` after it.
      const open = b.indexOf('[');
      const firstGt = b.indexOf('>');
      let end: number;
      if (open !== -1 && (firstGt === -1 || open < firstGt)) {
        const close = b.indexOf(']', open);
        end = close === -1 ? -1 : until('>', close);
      } else end = firstGt === -1 ? -1 : firstGt + 1;
      if (end === -1) return 0;
      this.onEvent({ type: 'doctype', body: b.slice(9, end - 1).trim(), ...at });
      this.consume(end);
      return end;
    }
    if (b.startsWith('<!')) {
      if (!final && b.length < 9) return 0;
      throw this.error('Unrecognised markup after <!');
    }
    if (b.startsWith('<?')) {
      const end = until('?>', 2);
      if (end === -1) return 0;
      const body = b.slice(2, end - 2);
      const target = /^\S+/.exec(body)?.[0] ?? '';
      this.onEvent({ type: 'pi', target, body: body.slice(target.length).trim(), ...at });
      this.consume(end);
      return end;
    }
    const end = tagEnd(b);
    if (end === -1) return 0;
    if (end === -2) throw this.error('A tag holds "<", or is never closed with ">"', at);
    const raw = b.slice(1, end - 1);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const expected = this.stack.pop();
      if (expected === undefined) throw this.error(`</${name}> closes nothing`, at);
      if (name !== expected) throw this.error(`</${name}> found where </${expected}> was expected`, at);
      this.onEvent({ type: 'close', name, ...at });
    } else {
      const selfClosing = raw.endsWith('/');
      const { name, attrs } = this.tag(selfClosing ? raw.slice(0, -1) : raw, at);
      if (this.stack.length === 0) {
        if (!this.options.fragment && this.roots > 0) throw this.error(`<${name}> is a second root element`, at);
        this.roots++;
      }
      this.onEvent({ type: 'open', name, attrs, selfClosing, ...at });
      if (selfClosing) this.onEvent({ type: 'close', name, ...at });
      else this.stack.push(name);
    }
    this.consume(end);
    return end;
  }

  private inElementOrFragment(at: XmlPosition, cdata: boolean) {
    if (this.stack.length === 0 && !this.options.fragment) throw this.error(`${cdata ? 'CDATA' : 'Text'} outside the root element`, at);
  }

  private text(raw: string) {
    const at: XmlPosition = { line: this.line, column: this.column };
    if (this.stack.length === 0 && !this.options.fragment) {
      if (raw.trim() !== '') this.inElementOrFragment(at, false);
      return;
    }
    if (raw.includes(']]>')) throw this.error('"]]>" is not allowed in text', at);
    this.onEvent({ type: 'text', text: this.decode(raw.replace(/\r\n?/g, '\n'), at), cdata: false, ...at });
  }

  private tag(raw: string, at: XmlPosition): { name: string; attrs: Record<string, string> } {
    const name = /^[^\s/>=]+/.exec(raw)?.[0] ?? '';
    if (!NAME.test(name)) throw this.error(`"<${raw.slice(0, 40)}" is not a valid tag`, at);
    const attrs: Record<string, string> = {};
    let rest = raw.slice(name.length);
    const ATTR = /^\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
    for (;;) {
      if (rest.trim() === '') break;
      const m = ATTR.exec(rest);
      if (!m) throw this.error(`<${name}> has a malformed attribute near "${rest.trim().slice(0, 40)}"`, at);
      const attr = m[1]!;
      if (!NAME.test(attr)) throw this.error(`<${name}> has an invalid attribute name "${attr}"`, at);
      if (Object.hasOwn(attrs, attr)) throw this.error(`<${name}> has the attribute "${attr}" twice`, at);
      if ((m[2] ?? m[3] ?? '').includes('<')) throw this.error(`<${name}> has "<" in the value of "${attr}"; write it as &lt;`, at);
      // Attribute-value normalisation: a tab or line break is a space.
      attrs[attr] = this.decode((m[2] ?? m[3] ?? '').replace(/\r\n|[\t\n\r]/g, ' '), at);
      rest = rest.slice(m[0].length);
    }
    return { name, attrs };
  }

  private decode(text: string, at: XmlPosition): string {
    if (!text.includes('&')) return text;
    return text.replace(/&([^;&\s]*);?/g, (whole, ref: string) => {
      if (!whole.endsWith(';')) throw this.error(`A bare "&" must be written &amp;`, at);
      if (ref.startsWith('#')) {
        const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : /^\d+$/.test(ref.slice(1)) ? parseInt(ref.slice(1), 10) : NaN;
        if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw this.error(`"&${ref};" is not a valid character reference`, at);
        return String.fromCodePoint(code);
      }
      const value = Object.hasOwn(this.entities, ref) ? this.entities[ref] : undefined;
      if (value === undefined) throw this.error(`"&${ref};" is not an entity this reader knows`, at);
      return value;
    });
  }
}

/**
 * Where the tag at the start of `b` ends (just past its `>`), skipping `>`
 * inside quoted values: -1 when it isn't all here yet, -2 when a `<` comes
 * first, which no tag may hold.
 */
function tagEnd(b: string): number {
  let quote = '';
  for (let i = 1; i < b.length; i++) {
    const c = b[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
    else if (c === '<') return -2;
  }
  return -1;
}

export interface XmlElement extends XmlPosition {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  type: 'text';
  text: string;
  cdata: boolean;
}

export interface XmlComment {
  type: 'comment';
  text: string;
}

export type XmlNode = XmlElement | XmlText | XmlComment;

/**
 * The whole document as a tree: the nodes at the top level, which for a
 * document (not a fragment) is the one root element. Adjacent text is merged;
 * comments are kept only with `comments: true`.
 */
export function parseXml(text: string, options: XmlOptions & { comments?: boolean } = {}): XmlNode[] {
  const top: XmlNode[] = [];
  const open: XmlElement[] = [];
  const add = (node: XmlNode) => {
    const siblings = open.at(-1)?.children ?? top;
    const prev = siblings.at(-1);
    if (node.type === 'text' && prev?.type === 'text' && prev.cdata === node.cdata) prev.text += node.text;
    else siblings.push(node);
  };
  const tokenizer = new XmlTokenizer((event) => {
    if (event.type === 'open') {
      const element: XmlElement = { type: 'element', name: event.name, attrs: event.attrs, children: [], line: event.line, column: event.column };
      add(element);
      open.push(element);
    } else if (event.type === 'close') open.pop();
    else if (event.type === 'text') add({ type: 'text', text: event.text, cdata: event.cdata });
    else if (event.type === 'comment' && options.comments) add({ type: 'comment', text: event.text });
  }, options);
  tokenizer.write(text);
  tokenizer.end();
  return top;
}

/** The text inside a node, its descendants' included, in document order. */
export function textOf(node: XmlNode): string {
  if (node.type === 'text') return node.text;
  if (node.type === 'comment') return '';
  return node.children.map(textOf).join('');
}

/** The child elements of `element`, optionally only those whose local name is `name`. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter((c): c is XmlElement => c.type === 'element' && (name === undefined || localName(c.name) === name));
}
