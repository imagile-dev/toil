import type { Align, Block, Doc, Inline, ListItem } from './ast.js';
import { Losses } from './ast.js';

/**
 * Markdown in and out: a focused CommonMark reader with GFM's tables, task
 * lists, strikethrough and bare-URL links, and a writer that prints the one
 * canonical spelling of each construct, which is the form every round trip
 * is compared in.
 *
 * What the reader covers: ATX and setext headings, paragraphs, fenced and
 * indented code, block quotes (with lazy continuation lines), bullet and
 * ordered lists to any depth, task list items, GFM tables with alignment,
 * thematic breaks, and inline code, emphasis, strong, strikethrough, inline
 * links and images (with titles), autolinks, bare URLs, hard breaks,
 * backslash escapes, entities and `<br>`.
 *
 * What it doesn't, and says so as a loss rather than guess: raw HTML other
 * than `<br>` (kept as its literal text), link reference definitions and the
 * reference links that use them, and footnotes (both kept as text). The
 * emphasis rules follow CommonMark's delimiter algorithm, so the corner
 * cases CommonMark itself argues about may read differently here; the
 * round-trip check reports any that do. A specification of 650 examples,
 * consulted here roughly as often as the staff handbook.
 */

// ---------------------------------------------------------------- reading

interface Line {
  text: string;
  /** 1-based line number in the input. */
  n: number;
}

const BLANK = /^[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const HTML_BLOCK = /^ {0,3}<(?:\/?[A-Za-z][\w-]*(?=[\s/>]|$)|!--)/;
const REF_DEF = /^ {0,3}\[[^\]]+\]:/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const indentOf = (text: string) => /^ */.exec(text)![0].length;

/** Leading tabs become spaces to the next multiple of four, which is all the indentation rules need. */
function expandTabs(text: string): string {
  if (!text.includes('\t')) return text;
  let out = '';
  let i = 0;
  for (; i < text.length && (text[i] === ' ' || text[i] === '\t'); i++) out += text[i] === '\t' ? ' '.repeat(4 - (out.length % 4)) : ' ';
  return out + text.slice(i);
}

/** Whether `line` starts a block that may interrupt a paragraph. */
function interrupts(text: string): boolean {
  if (FENCE.test(text) || ATX.test(text) || HR.test(text) || QUOTE.test(text)) return true;
  const item = ITEM.exec(text);
  // A list item interrupts a paragraph only if it has content, and an ordered one only if it starts at 1.
  if (item && item[4]!.trim() !== '' && (/^[-+*]$/.test(item[2]!) || /^1[.)]$/.test(item[2]!))) return true;
  return false;
}

function splitRow(text: string): string[] {
  let row = text.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '\\' && row[i + 1] === '|') {
      // GFM: an escaped pipe is a pipe in the cell, code spans included.
      cell += '|';
      i++;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

class BlockReader {
  constructor(private readonly losses: Losses | undefined) {}

  read(lines: Line[], top: boolean): { blocks: Block[]; at: string[] } {
    const blocks: Block[] = [];
    const at: string[] = [];
    let i = 0;
    const emit = (block: Block, line: number) => {
      blocks.push(block);
      at.push(`line ${line}`);
    };
    const enter = (line: number) => {
      if (top) this.losses?.enter(blocks.length, `line ${line}`);
    };
    while (i < lines.length) {
      const line = lines[i]!;
      const text = line.text;
      if (BLANK.test(text)) {
        i++;
        continue;
      }
      enter(line.n);
      const indent = indentOf(text);
      if (indent >= 4) {
        const body: string[] = [];
        while (i < lines.length && (indentOf(lines[i]!.text) >= 4 || BLANK.test(lines[i]!.text))) body.push(lines[i++]!.text.slice(4));
        while (body.length && BLANK.test(body.at(-1)!)) body.pop();
        emit({ type: 'code', text: body.join('\n') }, line.n);
        continue;
      }
      const fence = FENCE.exec(text);
      if (fence && !(fence[2]![0] === '`' && fence[3]!.includes('`'))) {
        const [, pad, marks, info] = fence as unknown as [string, string, string, string];
        const body: string[] = [];
        i++;
        const close = new RegExp(`^ {0,3}${marks[0] === '`' ? '`' : '~'}{${marks.length},}[ \\t]*$`);
        while (i < lines.length && !close.test(lines[i]!.text)) {
          const t = lines[i++]!.text;
          body.push(t.slice(Math.min(pad.length, indentOf(t))));
        }
        i++;
        const lang = unescapeText(info.trim().split(/\s+/)[0] ?? '');
        emit({ type: 'code', ...(lang ? { lang } : {}), text: body.join('\n') }, line.n);
        continue;
      }
      const atx = ATX.exec(text);
      if (atx) {
        const content = atx[2]!.trim().replace(/(^|[ \t]+)#+[ \t]*$/, '').trim();
        emit({ type: 'heading', level: atx[1]!.length, content: this.inline(content) }, line.n);
        i++;
        continue;
      }
      if (HR.test(text)) {
        emit({ type: 'rule' }, line.n);
        i++;
        continue;
      }
      if (QUOTE.test(text)) {
        const inner: Line[] = [];
        let lastBlank = false;
        while (i < lines.length) {
          const t = lines[i]!.text;
          if (QUOTE.test(t)) {
            const rest = t.replace(QUOTE, '');
            inner.push({ text: rest, n: lines[i]!.n });
            lastBlank = BLANK.test(rest);
          } else if (!BLANK.test(t) && !lastBlank && inner.length && !interrupts(t) && !BLANK.test(inner.at(-1)!.text)) {
            // A lazy continuation line: a paragraph inside the quote goes on without the >.
            inner.push({ text: t, n: lines[i]!.n });
          } else break;
          i++;
        }
        emit({ type: 'quote', children: this.read(inner, false).blocks }, line.n);
        continue;
      }
      const item = ITEM.exec(text);
      if (item) {
        const [list, next] = this.list(lines, i);
        emit(list, line.n);
        i = next;
        continue;
      }
      if (text.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]!.text)) {
        const head = splitRow(text);
        const delims = splitRow(lines[i + 1]!.text);
        if (head.length === delims.length) {
          const rows: Inline[][][] = [head.map((c) => this.inline(c))];
          i += 2;
          while (i < lines.length && !BLANK.test(lines[i]!.text) && !interrupts(lines[i]!.text)) {
            const cells = splitRow(lines[i]!.text);
            if (cells.length > head.length) this.losses?.add('table row cells', `line ${lines[i]!.n} has ${cells.length} cells and the header ${head.length}; the extra cells were dropped, as GFM does`, `line ${lines[i]!.n}`);
            rows.push(head.map((_, c) => this.inline(cells[c] ?? '')));
            i++;
          }
          emit({ type: 'table', align: delims.map(alignOf), rows }, line.n);
          continue;
        }
      }
      if (HTML_BLOCK.test(text) || REF_DEF.test(text)) {
        const body: string[] = [];
        while (i < lines.length && !BLANK.test(lines[i]!.text)) body.push(lines[i++]!.text.trim());
        if (REF_DEF.test(text)) {
          this.losses?.add(text.trimStart().startsWith('[^') ? 'footnote' : 'link reference definition', 'reference definitions and footnotes are not read; the text is kept as it is', `line ${line.n}`);
        } else this.losses?.add('raw HTML', 'HTML is not converted; its text is kept as it is', `line ${line.n}`);
        emit({ type: 'paragraph', content: [{ type: 'text', text: body.join(' ') }] }, line.n);
        continue;
      }
      // A paragraph, which a setext underline may turn into a heading.
      const raw: string[] = [text];
      i++;
      let heading = 0;
      while (i < lines.length) {
        const t = lines[i]!.text;
        if (BLANK.test(t)) break;
        const setext = SETEXT.exec(t);
        if (setext) {
          heading = setext[1]![0] === '=' ? 1 : 2;
          i++;
          break;
        }
        if (interrupts(t)) break;
        raw.push(t);
        i++;
      }
      // Two trailing spaces before a line break make it a hard break, as a backslash does.
      const joined = raw.map((r, k) => (k < raw.length - 1 && / {2,}$/.test(r) ? `${r.trim()}\\` : r.trim())).join('\n');
      const content = this.inline(joined);
      emit(heading ? { type: 'heading', level: heading, content } : { type: 'paragraph', content }, line.n);
    }
    return { blocks, at };
  }

  private list(lines: Line[], start: number): [Block, number] {
    const first = ITEM.exec(lines[start]!.text)!;
    const bullet = /^[-+*]$/.test(first[2]!);
    const kind = bullet ? first[2]! : first[2]!.slice(-1);
    const items: ListItem[] = [];
    let i = start;
    while (i < lines.length) {
      const m = ITEM.exec(lines[i]!.text);
      if (!m || HR.test(lines[i]!.text)) break;
      const isBullet = /^[-+*]$/.test(m[2]!);
      if (isBullet !== bullet || (bullet ? m[2] : m[2]!.slice(-1)) !== kind) break;
      const markerEnd = m[1]!.length + m[2]!.length;
      const spaces = m[3]!.length;
      let rest = m[4]!;
      const content = rest === '' ? markerEnd + 1 : spaces >= 5 ? markerEnd + 1 : markerEnd + spaces;
      if (rest !== '' && spaces >= 5) rest = ' '.repeat(spaces - 1) + rest;
      let task: ListItem['task'];
      const box = /^\[([ xX])\](?:[ \t]+|$)/.exec(rest);
      if (box) {
        task = box[1] === ' ' ? 'todo' : 'done';
        rest = rest.slice(box[0].length);
      }
      const inner: Line[] = [{ text: rest, n: lines[i]!.n }];
      i++;
      while (i < lines.length) {
        const t = lines[i]!.text;
        if (BLANK.test(t)) {
          // A blank line stays in the item only if something indented follows.
          let j = i;
          while (j < lines.length && BLANK.test(lines[j]!.text)) j++;
          if (j < lines.length && indentOf(lines[j]!.text) >= content) {
            for (; i < j; i++) inner.push({ text: '', n: lines[i]!.n });
            continue;
          }
          break;
        }
        if (indentOf(t) >= content) {
          inner.push({ text: t.slice(content), n: lines[i]!.n });
          i++;
          continue;
        }
        const last = inner.at(-1)!.text;
        if (!BLANK.test(last) && !interrupts(t) && !ITEM.test(t) && !FENCE.test(last) && !/^ {0,3}(`{3,}|~{3,})/.test(inner[0]!.text)) {
          inner.push({ text: t.trim(), n: lines[i]!.n });
          i++;
          continue;
        }
        break;
      }
      items.push({ ...(task ? { task } : {}), children: this.read(inner, false).blocks });
      // Blank lines between items keep the list going when the next line is another item.
      let j = i;
      while (j < lines.length && BLANK.test(lines[j]!.text)) j++;
      if (j < lines.length && ITEM.test(lines[j]!.text)) i = j;
      else break;
    }
    const startNumber = bullet ? 1 : parseInt(first[2]!, 10);
    return [{ type: 'list', ordered: !bullet, start: startNumber, items }, i];
  }

  inline(text: string): Inline[] {
    return new InlineReader(text, this.losses).read();
  }
}

/** Reads Markdown into a document, noting what it couldn't read in `losses`. */
export function parseMarkdown(text: string, losses?: Losses): Doc {
  const lines = text
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t, k) => ({ text: expandTabs(t), n: k + 1 }));
  return new BlockReader(losses).read(lines, true);
}

// ---------------------------------------------------------------- inline reading

const PUNCT = /[!-/:-@[-`{-~\p{P}\p{S}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×', rarr: '→', larr: '←', deg: '°' };

function decodeEntity(ref: string): string | undefined {
  if (ref.startsWith('#')) {
    const code = /^#[xX]/.test(ref) ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return undefined;
    return code === 0 || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
  }
  return Object.hasOwn(NAMED, ref) ? NAMED[ref] : undefined;
}

/** Backslash escapes and entities, for a link destination, title or info string. */
function unescapeText(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])|&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z]+);/g, (whole, esc: string | undefined, ref: string | undefined) => esc ?? decodeEntity(ref!) ?? whole);
}

type Delim = { kind: 'delim'; char: '*' | '_' | '~'; count: number; orig: number; canOpen: boolean; canClose: boolean };
type Bracket = { kind: 'bracket'; image: boolean; active: boolean };
type Node = Inline | Delim | Bracket;

const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const isPunct = (c: string | undefined) => c !== undefined && PUNCT.test(c);

const LINK_TAIL = /^\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)/;
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]*/;
const INLINE_HTML = /^<\/?[A-Za-z][\w-]*(?:\s+[^<>]*)?\/?>|^<!--[\s\S]*?-->/;

/**
 * How far ahead a construct is looked for: an autolink, a link's destination and
 * title, an entity. Longer ones are text. It keeps reading a long paragraph linear
 * rather than copying the rest of it at every character.
 */
const WINDOW = 8192;

const runLength = (s: string, i: number, c: string) => {
  let j = i;
  while (s[j] === c) j++;
  return j - i;
};

class InlineReader {
  private readonly nodes: Node[] = [];
  private buf = '';

  constructor(
    private readonly src: string,
    private readonly losses: Losses | undefined,
  ) {}

  private flush() {
    if (this.buf) this.nodes.push({ type: 'text', text: this.buf });
    this.buf = '';
  }

  private emit(node: Node) {
    this.flush();
    this.nodes.push(node);
  }

  read(): Inline[] {
    const s = this.src;
    let i = 0;
    while (i < s.length) {
      const c = s[i]!;
      if (c === '\\') {
        const next = s[i + 1];
        if (next === '\n') {
          this.emit({ type: 'break' });
          i += 2;
          continue;
        }
        if (next !== undefined && ESCAPABLE.test(next)) {
          this.buf += next;
          i += 2;
          continue;
        }
        this.buf += c;
        i++;
        continue;
      }
      if (c === '\n') {
        this.buf = this.buf.replace(/ +$/, '');
        this.buf += ' ';
        i++;
        while (s[i] === ' ') i++;
        continue;
      }
      if (c === '`') {
        const run = '`'.repeat(runLength(s, i, '`'));
        let j = i + run.length;
        let close = -1;
        while (j < s.length) {
          const k = s.indexOf('`', j);
          if (k === -1) break;
          const r = '`'.repeat(runLength(s, k, '`'));
          if (r.length === run.length) {
            close = k;
            break;
          }
          j = k + r.length;
        }
        if (close === -1) {
          this.buf += run;
          i += run.length;
          continue;
        }
        let code = s.slice(i + run.length, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
        this.emit({ type: 'code', text: code });
        i = close + run.length;
        continue;
      }
      if (c === '<') {
        const rest = s.slice(i, i + WINDOW);
        const auto = AUTOLINK.exec(rest);
        if (auto) {
          this.emit({ type: 'link', href: auto[1]!, children: [{ type: 'text', text: auto[1]! }] });
          i += auto[0].length;
          continue;
        }
        const email = EMAIL.exec(rest);
        if (email) {
          this.emit({ type: 'link', href: `mailto:${email[1]}`, children: [{ type: 'text', text: email[1]! }] });
          i += email[0].length;
          continue;
        }
        const br = /^<br\s*\/?>/i.exec(rest);
        if (br) {
          this.emit({ type: 'break' });
          i += br[0].length;
          continue;
        }
        const html = INLINE_HTML.exec(rest);
        if (html) {
          this.losses?.add('inline HTML', `${html[0].slice(0, 40)} is not converted; it is kept as text`);
          this.buf += html[0];
          i += html[0].length;
          continue;
        }
        this.buf += c;
        i++;
        continue;
      }
      if (c === '&') {
        const m = /^&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(s.slice(i, i + 40));
        const decoded = m ? decodeEntity(m[1]!) : undefined;
        if (m && decoded !== undefined) {
          this.buf += decoded;
          i += m[0].length;
          continue;
        }
        this.buf += c;
        i++;
        continue;
      }
      if (c === '!' && s[i + 1] === '[') {
        this.emit({ kind: 'bracket', image: true, active: true });
        this.nodes.push({ type: 'text', text: '![' });
        i += 2;
        continue;
      }
      if (c === '[') {
        this.emit({ kind: 'bracket', image: false, active: true });
        this.nodes.push({ type: 'text', text: '[' });
        i++;
        continue;
      }
      if (c === ']') {
        i = this.closeBracket(i);
        continue;
      }
      if (c === '*' || c === '_' || c === '~') {
        const run = c.repeat(runLength(s, i, c));
        const prev = i === 0 ? undefined : s[i - 1];
        const next = s[i + run.length];
        const left = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
        const right = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
        let canOpen = left;
        let canClose = right;
        if (c === '_') {
          canOpen = left && (!right || isPunct(prev));
          canClose = right && (!left || isPunct(next));
        }
        if (c === '~' && run.length > 2) {
          this.buf += run;
        } else this.emit({ kind: 'delim', char: c, count: run.length, orig: run.length, canOpen, canClose });
        i += run.length;
        continue;
      }
      if ((c === 'h' || c === 'w') && (i === 0 || /[\s*_~(]/.test(s[i - 1]!))) {
        const url = BARE_URL.exec(s.slice(i, i + WINDOW));
        if (url) {
          const found = trimUrl(url[0]);
          if (found && (found.startsWith('www.') ? /^www\.[A-Za-z0-9-]+\.[A-Za-z]/.test(found) : /^https?:\/\/[A-Za-z0-9]/.test(found))) {
            this.emit({ type: 'link', href: found.startsWith('www.') ? `http://${found}` : found, children: [{ type: 'text', text: found }] });
            i += found.length;
            continue;
          }
        }
      }
      this.buf += c;
      i++;
    }
    this.flush();
    this.processEmphasis(0);
    return this.finish(this.nodes);
  }

  /** At `]`: a link or image if a usable opener and a destination are here, else a literal bracket. */
  private closeBracket(i: number): number {
    this.flush();
    let o = this.nodes.length - 1;
    while (o >= 0 && (this.nodes[o] as Bracket).kind !== 'bracket') o--;
    if (o < 0) {
      this.buf += ']';
      return i + 1;
    }
    const opener = this.nodes[o] as Bracket;
    const tail = LINK_TAIL.exec(this.src.slice(i + 1, i + 1 + WINDOW));
    if (!opener.active || !tail) {
      this.nodes.splice(o, 1);
      this.buf += ']';
      return i + 1;
    }
    let dest = tail[1]!;
    if (dest.startsWith('<')) dest = dest.slice(1, -1);
    const titleRaw = tail[2];
    const title = titleRaw === undefined ? undefined : unescapeText(titleRaw.slice(1, -1));
    // The opener's own text node ("[" or "![") follows it.
    this.processEmphasis(o + 2);
    const inner = this.finish(this.nodes.slice(o + 2));
    this.nodes.splice(o);
    const href = unescapeText(dest);
    if (opener.image) {
      this.nodes.push({ type: 'image', src: href, alt: plain(inner), ...(title !== undefined ? { title } : {}) });
    } else {
      // A link holds no link: bare URLs inside its text are its text.
      this.nodes.push({ type: 'link', href, ...(title !== undefined ? { title } : {}), children: unlink(inner) });
      for (const n of this.nodes) if ((n as Bracket).kind === 'bracket' && !(n as Bracket).image) (n as Bracket).active = false;
    }
    return i + 1 + tail[0].length;
  }

  /** CommonMark's "process emphasis", over the nodes from `bottom` on. */
  private processEmphasis(bottom: number) {
    const nodes = this.nodes;
    for (let c = bottom; c < nodes.length; c++) {
      const closer = nodes[c] as Delim;
      if (closer.kind !== 'delim' || !closer.canClose) continue;
      let o = c - 1;
      for (; o >= bottom; o--) {
        const opener = nodes[o] as Delim;
        if (opener.kind !== 'delim' || opener.char !== closer.char || !opener.canOpen) continue;
        if (closer.char === '~') {
          if (opener.count === closer.count) break;
          continue;
        }
        if ((opener.canClose || closer.canOpen) && (opener.orig + closer.orig) % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
        break;
      }
      if (o < bottom) {
        continue;
      }
      const opener = nodes[o] as Delim;
      const use = closer.char === '~' ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      const type = closer.char === '~' ? 'strike' : use === 2 ? 'strong' : 'em';
      const children = this.finish(nodes.slice(o + 1, c));
      nodes.splice(o + 1, c - o - 1, { type, children } as Inline);
      c = o + 2;
      opener.count -= use;
      closer.count -= use;
      if (closer.count === 0) nodes.splice(c, 1);
      if (opener.count === 0) {
        nodes.splice(o, 1);
        c--;
      }
      c--;
    }
  }

  /** Nodes to inline content: leftover delimiters and brackets are their text. */
  private finish(nodes: Node[]): Inline[] {
    const out: Inline[] = [];
    for (const n of nodes) {
      if ((n as Delim).kind === 'delim') out.push({ type: 'text', text: (n as Delim).char.repeat((n as Delim).count) });
      else if ((n as Bracket).kind === 'bracket') continue;
      else out.push(n as Inline);
    }
    return out;
  }
}

function trimUrl(url: string): string {
  let u = url.replace(/&[A-Za-z0-9]+;$/, '');
  for (;;) {
    const before = u;
    u = u.replace(/[?!.,:*_~'"]+$/, '');
    if (u.endsWith(')')) {
      const open = (u.match(/\(/g) ?? []).length;
      const close = (u.match(/\)/g) ?? []).length;
      if (close > open) u = u.slice(0, -1);
    }
    if (u === before) return u;
  }
}

function plain(nodes: Inline[]): string {
  return nodes.map((n) => ('text' in n ? n.text : n.type === 'image' ? n.alt : n.type === 'break' ? ' ' : plain(n.children))).join('');
}

function unlink(nodes: Inline[]): Inline[] {
  return nodes.flatMap((n): Inline[] => {
    if (n.type === 'link') return unlink(n.children);
    if (n.type === 'strong' || n.type === 'em' || n.type === 'strike') return [{ ...n, children: unlink(n.children) }];
    return [n];
  });
}

// ---------------------------------------------------------------- writing

/** Markdown text that reads back as itself: every character Markdown could take as syntax is escaped. */
function escapeText(text: string, table: boolean): string {
  let out = text.replace(/[\\`*_[\]<>~]/g, '\\$&').replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&').replace(/!$/, '\\!');
  if (table) out = out.replace(/\|/g, '\\|');
  // A URL that was text stays text: escaping its colon stops the bare-URL rule.
  out = out.replace(/(^|[\s(])(https?):\/\//g, '$1$2\\://').replace(/(^|[\s(])www\./g, '$1www\\.');
  return out;
}

/** The first characters of a line that would start a block: escaped. */
function escapeLineStart(line: string): string {
  if (/^[#>+=|-]/.test(line)) return `\\${line}`;
  const ordered = /^(\d{1,9})([.)])/.exec(line);
  if (ordered) return `${ordered[1]}\\${line.slice(ordered[1]!.length)}`;
  // Four spaces would make indented code; text never starts with spaces after trimming, but a nbsp may be kept.
  return line;
}

function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const n = Math.max(0, ...runs.map((r) => r.length)) + 1;
  const fence = '`'.repeat(n);
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function destination(href: string): string {
  if (href === '' || /[\s<>]/.test(href) || /[()]/.test(href)) return `<${href.replace(/[<>\\]/g, '\\$&')}>`;
  return href.replace(/\\/g, '\\\\');
}

const titlePart = (title: string | undefined) => (title === undefined ? '' : ` "${title.replace(/["\\]/g, '\\$&')}"`);

/** Inline content as one line of Markdown (a hard break is `\` and a newline, or `<br>` where a line can't break). */
export function renderInlines(nodes: Inline[], where: 'block' | 'table' | 'heading' = 'block'): string {
  const table = where === 'table';
  return nodes
    .map((n): string => {
      switch (n.type) {
        case 'text':
          return escapeText(n.text, table);
        case 'code':
          return codeSpan(table ? n.text.replace(/\|/g, '\\|') : n.text);
        case 'strong':
          return `**${renderInlines(n.children, where)}**`;
        case 'em':
          return `*${renderInlines(n.children, where)}*`;
        case 'strike':
          return `~~${renderInlines(n.children, where)}~~`;
        case 'break':
          return where === 'block' ? '\\\n' : '<br>';
        case 'image':
          return `![${escapeText(n.alt, table)}](${destination(n.src)}${titlePart(n.title)})`;
        case 'link': {
          const first = n.children[0];
          const only = n.children.length === 1 && first?.type === 'text' ? first.text : undefined;
          if (n.title === undefined && only !== undefined && !/[\s<>]/.test(n.href)) {
            if (only === n.href && /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(n.href)) return `<${n.href}>`;
            if (`mailto:${only}` === n.href && EMAIL.test(`<${only}>`)) return `<${only}>`;
          }
          return `[${renderInlines(n.children, where)}](${destination(n.href)}${titlePart(n.title)})`;
        }
      }
    })
    .join('')
    .split('\n')
    .map((line) => (where === 'block' ? escapeLineStart(line) : line))
    .join('\n');
}

const indent = (text: string, pad: string) =>
  text
    .split('\n')
    .map((l, k) => (k === 0 || l === '' ? l : pad + l))
    .join('\n');

/** One block as canonical Markdown. `previous` is the block before it, so two lists side by side stay two lists. */
export function renderBlock(block: Block, previous?: Block): string {
  switch (block.type) {
    case 'paragraph':
      return renderInlines(block.content);
    case 'heading':
      // A trailing # would read as the heading's closing sequence.
      return `${'#'.repeat(block.level)}${block.content.length ? ' ' : ''}${renderInlines(block.content, 'heading').replace(/#$/, '\\#')}`;
    case 'code': {
      const runs = block.text.match(/^`{3,}/gm) ?? [];
      const n = Math.max(2, ...runs.map((r) => r.length)) + 1;
      const char = block.lang?.includes('`') ? '~' : '`';
      const fence = char.repeat(n);
      return `${fence}${block.lang ?? ''}\n${block.text}${block.text === '' ? '' : '\n'}${fence}`;
    }
    case 'quote': {
      const inner = renderBlocks(block.children);
      return inner === '' ? '>' : inner.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n');
    }
    case 'rule':
      return '---';
    case 'table': {
      const row = (cells: Inline[][]) => `| ${cells.map((c) => renderInlines(c, 'table')).join(' | ')} |`;
      const delim = block.align.map((a) => (a === 'center' ? ':-:' : a === 'right' ? '--:' : a === 'left' ? ':--' : '---'));
      return [row(block.rows[0] ?? []), `| ${delim.join(' | ')} |`, ...block.rows.slice(1).map(row)].join('\n');
    }
    case 'list': {
      // Adjacent lists of one kind would read as one; the second takes the other marker.
      const alt = previous?.type === 'list' && previous.ordered === block.ordered;
      return block.items
        .map((item, k) => {
          const marker = block.ordered ? `${block.start + k}${alt ? ')' : '.'}` : alt ? '*' : '-';
          const pad = ' '.repeat(marker.length + 1);
          const box = item.task === undefined ? '' : item.task === 'done' ? '[x] ' : '[ ] ';
          const body = renderItem(item.children);
          // A task item's paragraph starts after the box; an item that starts with another block puts it on the next line.
          if (body === '') return item.task === undefined ? marker : `${marker} ${box.trimEnd()}`;
          const startsWithText = item.children[0]?.type === 'paragraph';
          const head = item.task !== undefined && !startsWithText ? `${marker} ${box.trimEnd()}\n${pad}` : `${marker} ${box}`;
          return head + indent(body, pad);
        })
        .join('\n');
    }
  }
}

/** The blocks of a list item: a paragraph and a list after it need no blank line between them. */
function renderItem(children: Block[]): string {
  let out = '';
  children.forEach((block, k) => {
    const prev = children[k - 1];
    if (k > 0) out += prev?.type === 'paragraph' && block.type === 'list' && (!block.ordered || block.start === 1) && (block.items[0]?.children.length ?? 0) > 0 ? '\n' : '\n\n';
    out += renderBlock(block, prev);
  });
  return out;
}

/** Blocks as canonical Markdown, a blank line between each. */
export function renderBlocks(blocks: Block[]): string {
  return blocks.map((b, k) => renderBlock(b, blocks[k - 1])).join('\n\n');
}

/** A document as canonical Markdown, ending in one line break. */
export function renderMarkdown(doc: Doc): string {
  const text = renderBlocks(doc.blocks);
  return text === '' ? '' : `${text}\n`;
}
