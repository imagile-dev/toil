import type { Align, Block, Doc, Inline, ListItem } from './ast.js';
import { blockInlines, joinInlines, Losses, plainText } from './ast.js';

/**
 * Jira wiki markup (Data Center's `/rest/api/2` text fields) in and out.
 *
 * Read: `h1.` to `h6.`, paragraphs (a single line break is a break, as Jira
 * renders it), `bq.` and `{quote}`, `{code}` and `{noformat}`, `*` / `#` / `-`
 * lists to any depth and mixed, `||header||` and `|cell|` tables, `----`,
 * `*strong*`, `_emphasis_`, `-strike-`, `{{monospace}}`, `[text|url]`,
 * `!image!`, `\\` breaks, backslash escapes, bare URLs and the `{*}` braced
 * forms. Everything else Jira has (underline, colour, superscript, citations,
 * panels, mentions, attachments, other macros) is reported as a loss, and
 * its words are kept wherever there are words to keep.
 *
 * Written: the same constructs, with every character Jira could read as
 * markup escaped. Jira has no task list, so a task is `[ ]` or `[x]` text,
 * reported; it has no table alignment, reported too. How Jira's own renderer
 * treats the escapes is the one thing here no unit test can see. Wiki markup:
 * a format whose specification is a help page, and whose help page is a popup.
 */

const EFFECTS: Record<string, 'strong' | 'em' | 'strike' | 'underline' | 'sup' | 'sub'> = { '*': 'strong', _: 'em', '-': 'strike', '+': 'underline', '^': 'sup', '~': 'sub' };
const LOST_EFFECT: Record<string, string> = { underline: 'underline', sup: 'superscript', sub: 'subscript', cite: 'citation' };
const BLOCK_MACRO = /^\s*\{(quote|code|noformat|panel|info|note|tip|warning|expand)(?::([^}]*))?\}(.*)$/i;
const LONE_MACRO = /^\s*\{([A-Za-z][\w-]*)(?::[^}]*)?\}\s*$/;
const HEADING = /^\s*h([1-6])\.\s*(.*)$/;
const BQ = /^\s*bq\.\s?(.*)$/;
const LIST = /^\s*([*#-]+)\s+(.*)$/;
const RULE = /^\s*-{4,}\s*$/;
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0', apos: "'" };

const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);

// ---------------------------------------------------------------- reading

class WikiReader {
  constructor(private readonly losses: Losses | undefined) {}

  blocks(lines: string[], base: number, top: boolean): { blocks: Block[]; at: string[] } {
    const blocks: Block[] = [];
    const at: string[] = [];
    let i = 0;
    const emit = (block: Block, line: number) => {
      blocks.push(block);
      at.push(`line ${line}`);
    };
    while (i < lines.length) {
      const text = lines[i]!;
      const n = base + i;
      if (text.trim() === '') {
        i++;
        continue;
      }
      if (top) this.losses?.enter(blocks.length, `line ${n}`);
      const macro = BLOCK_MACRO.exec(text);
      if (macro) {
        const name = macro[1]!.toLowerCase();
        const params = macro[2];
        const inner: string[] = [];
        let rest = macro[3]!;
        const close = new RegExp(`\\{${name}\\}`, 'i');
        let after: string | undefined;
        i++;
        for (;;) {
          const m = close.exec(rest);
          if (m) {
            inner.push(rest.slice(0, m.index));
            after = rest.slice(m.index + m[0].length);
            break;
          }
          inner.push(rest);
          if (i >= lines.length) break;
          rest = lines[i++]!;
        }
        if (after !== undefined && after.trim() !== '') {
          // Text after the closing tag on the same line is read as the next line.
          lines[i - 1] = after;
          i--;
        }
        if (inner[0]?.trim() === '') inner.shift();
        if (inner.length && inner.at(-1)!.trim() === '') inner.pop();
        if (name === 'code' || name === 'noformat') {
          let lang: string | undefined;
          if (name === 'code' && params) {
            const parts = params.split('|');
            const extra: string[] = [];
            for (const p of parts) {
              const kv = /^\s*([\w-]+)\s*=\s*(.*)$/.exec(p);
              if (!kv) lang = p.trim() || lang;
              else if (kv[1]!.toLowerCase() === 'language') lang = kv[2]!.trim();
              else extra.push(kv[1]!);
            }
            if (extra.length) this.losses?.add('code macro parameters', `{code} parameters ${extra.join(', ')} have no Markdown equivalent and were dropped`, `line ${n}`);
          } else if (params) this.losses?.add('noformat parameters', '{noformat} parameters have no Markdown equivalent and were dropped', `line ${n}`);
          emit({ type: 'code', ...(lang ? { lang } : {}), text: inner.join('\n') }, n);
          continue;
        }
        const children = this.blocks(inner, n, false).blocks;
        if (name === 'quote') emit({ type: 'quote', children }, n);
        else if (name === 'expand') {
          this.losses?.add('expand', 'an {expand} section has no Markdown equivalent; its title and content are kept as text', `line ${n}`);
          if (params) emit({ type: 'paragraph', content: [{ type: 'strong', children: [{ type: 'text', text: params.replace(/^title=/, '') }] }] }, n);
          for (const child of children) emit(child, n);
        } else {
          this.losses?.add(name === 'panel' ? 'panel' : `${name} panel`, `a {${name}} panel has no Markdown equivalent; its content is kept as a quote, its title as bold text`, `line ${n}`);
          const title = /(?:^|\|)\s*title\s*=\s*([^|]*)/.exec(params ?? '')?.[1]?.trim();
          emit({ type: 'quote', children: [...(title ? [{ type: 'paragraph', content: [{ type: 'strong', children: [{ type: 'text', text: title }] }] } as Block] : []), ...children] }, n);
        }
        continue;
      }
      const heading = HEADING.exec(text);
      if (heading) {
        emit({ type: 'heading', level: Number(heading[1]), content: this.inline(heading[2]!) }, n);
        i++;
        continue;
      }
      const bq = BQ.exec(text);
      if (bq) {
        emit({ type: 'quote', children: [{ type: 'paragraph', content: this.inline(bq[1]!) }] }, n);
        i++;
        continue;
      }
      if (RULE.test(text)) {
        emit({ type: 'rule' }, n);
        i++;
        continue;
      }
      if (text.trimStart().startsWith('|')) {
        const [table, next] = this.table(lines, i, base);
        emit(table, n);
        i = next;
        continue;
      }
      if (LIST.test(text)) {
        const [lists, next] = this.list(lines, i);
        for (const list of lists) emit(list, n);
        i = next;
        continue;
      }
      const lone = LONE_MACRO.exec(text);
      if (lone) {
        this.losses?.add(`${lone[1]} macro`, `the {${lone[1]}} macro has no Markdown equivalent and was dropped`, `line ${n}`);
        i++;
        continue;
      }
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && (body.length === 0 || !this.startsBlock(lines[i]!))) body.push(lines[i++]!);
      emit({ type: 'paragraph', content: this.inline(body.join('\n')) }, n);
    }
    if (top) this.losses?.close(blocks.length);
    return { blocks, at };
  }

  private startsBlock(text: string): boolean {
    return BLOCK_MACRO.test(text) || HEADING.test(text) || BQ.test(text) || RULE.test(text) || text.trimStart().startsWith('|') || LIST.test(text) || LONE_MACRO.test(text);
  }

  private list(lines: string[], start: number): [Block[], number] {
    const roots: Block[] = [];
    const stack: Array<{ list: Extract<Block, { type: 'list' }>; ch: string }> = [];
    let i = start;
    while (i < lines.length) {
      const text = lines[i]!;
      const m = LIST.exec(text);
      if (!m || RULE.test(text)) {
        // A line that isn't a new item or a new block carries on the item before it.
        if (text.trim() !== '' && !this.startsBlock(text) && stack.length) {
          const item = stack.at(-1)!.list.items.at(-1)!;
          const para = item.children[0];
          if (para?.type === 'paragraph') para.content.push({ type: 'break' }, ...this.inline(text.trim()));
          i++;
          continue;
        }
        break;
      }
      // `-` is a list only on its own: "-- x" is text.
      const marks = m[1]!.includes('-') && m[1] !== '-' ? undefined : m[1]!;
      if (marks === undefined) break;
      while (stack.length > marks.length) stack.pop();
      for (let k = 0; k < stack.length; k++) {
        if (stack[k]!.ch !== (marks[k] === '-' ? '*' : marks[k])) {
          stack.length = k;
          break;
        }
      }
      while (stack.length < marks.length) {
        const ch = marks[stack.length] === '-' ? '*' : marks[stack.length]!;
        const list: Extract<Block, { type: 'list' }> = { type: 'list', ordered: ch === '#', start: 1, items: [] };
        if (stack.length === 0) roots.push(list);
        else {
          const parent = stack.at(-1)!.list;
          if (parent.items.length === 0) parent.items.push({ children: [] });
          parent.items.at(-1)!.children.push(list);
        }
        stack.push({ list, ch });
      }
      let content = this.inline(m[2]!);
      let task: ListItem['task'];
      const first = content[0];
      if (first?.type === 'text') {
        const box = /^\[([ xX])\] ?/.exec(first.text);
        if (box) {
          task = box[1] === ' ' ? 'todo' : 'done';
          content = [{ type: 'text', text: first.text.slice(box[0].length) }, ...content.slice(1)];
        }
      }
      stack.at(-1)!.list.items.push({ ...(task ? { task } : {}), children: [{ type: 'paragraph', content }] });
      i++;
    }
    return [roots, i];
  }

  private table(lines: string[], start: number, base: number): [Block, number] {
    const rows: Array<Array<{ header: boolean; text: string }>> = [];
    let i = start;
    while (i < lines.length && lines[i]!.trimStart().startsWith('|')) {
      let row = lines[i++]!.trim();
      // A row whose last cell runs onto further lines ends at the line that ends in |.
      while (!/(^|[^\\])\|$/.test(row) && i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.trimStart().startsWith('|')) row += `\n${lines[i++]!.trim()}`;
      rows.push(splitWikiRow(row));
    }
    const at = `line ${base + start}`;
    const head = rows[0] ?? [];
    if (!head.every((c) => c.header)) this.losses?.add('table without a header row', 'Markdown tables need a header row; the first row was made the header', at);
    if (rows.slice(1).some((r) => r.some((c) => c.header))) this.losses?.add('header cell outside the first row', 'Markdown has header cells only in the first row; the others became ordinary cells', at);
    const width = Math.max(...rows.map((r) => r.length));
    if (rows.some((r) => r.length !== width)) this.losses?.add('uneven table rows', 'rows with fewer cells were padded with empty ones', at);
    const align: Align[] = Array.from({ length: width }, () => null);
    return [{ type: 'table', align, rows: rows.map((r) => r.map((c) => this.inline(c.text.trim()))) }, i];
  }

  inline(text: string): Inline[] {
    return new WikiInline(this.losses).parse(text);
  }
}

/** A table row's cells, split on the `|` and `||` that aren't inside a link, an image or monospace. */
function splitWikiRow(row: string): Array<{ header: boolean; text: string }> {
  const cells: Array<{ header: boolean; text: string }> = [];
  let cur: { header: boolean; text: string } | undefined;
  let depth = 0;
  let mono = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '\\' && i + 1 < row.length) {
      if (cur) cur.text += c + row[i + 1];
      i++;
      continue;
    }
    if (row.startsWith('{{', i)) mono = true;
    if (row.startsWith('}}', i)) mono = false;
    if (c === '[') depth++;
    if (c === ']' && depth) depth--;
    if (c === '|' && depth === 0 && !mono) {
      if (cur) cells.push(cur);
      const header = row[i + 1] === '|';
      if (header) i++;
      cur = { header, text: '' };
      continue;
    }
    if (cur) cur.text += c;
  }
  // The separator after the last cell opens an empty one, which isn't a cell.
  if (cur && cur.text.trim() !== '') cells.push(cur);
  return cells;
}

class WikiInline {
  constructor(private readonly losses: Losses | undefined) {}

  parse(s: string): Inline[] {
    const out: Inline[] = [];
    let buf = '';
    const flush = () => {
      if (buf) out.push({ type: 'text', text: buf });
      buf = '';
    };
    const emit = (...nodes: Inline[]) => {
      flush();
      out.push(...nodes);
    };
    let i = 0;
    while (i < s.length) {
      const c = s[i]!;
      // A window, not the rest of the line: every construct read from here is short.
      const rest = s.slice(i, i + 8192);
      if (c === '\\') {
        if (s[i + 1] === '\\') {
          emit({ type: 'break' });
          i += 2;
          continue;
        }
        if (i + 1 < s.length && s[i + 1] !== '\n') {
          buf += s[i + 1];
          i += 2;
          continue;
        }
      }
      if (c === '\n') {
        emit({ type: 'break' });
        i++;
        continue;
      }
      if (c === '&') {
        const m = /^&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-z]+);/.exec(rest);
        if (m) {
          const ref = m[1]!;
          const ch = ref.startsWith('#x') ? String.fromCodePoint(parseInt(ref.slice(2), 16)) : ref.startsWith('#') ? String.fromCodePoint(parseInt(ref.slice(1), 10)) : ENTITY[ref];
          if (ch !== undefined) {
            buf += ch;
            i += m[0].length;
            continue;
          }
        }
      }
      if (rest.startsWith('{{')) {
        const end = findUnescaped(s, '}}', i + 2);
        if (end !== -1) {
          emit({ type: 'code', text: s.slice(i + 2, end).replace(/\\(.)/g, '$1').replace(/&#92;/g, '\\') });
          i = end + 2;
          continue;
        }
      }
      if (c === '{') {
        const braced = /^\{([*_\-+^~]|\?\?)\}/.exec(rest);
        if (braced) {
          const end = s.indexOf(braced[0], i + braced[0].length);
          if (end !== -1) {
            emit(...this.effect(braced[1]!, s.slice(i + braced[0].length, end)));
            i = end + braced[0].length;
            continue;
          }
        }
        const color = /^\{color(?::[^}]*)?\}/i.exec(rest);
        if (color) {
          const end = s.toLowerCase().indexOf('{color}', i + color[0].length);
          this.losses?.add('text colour', 'text colour has no Markdown equivalent; the text is kept');
          if (end !== -1) {
            emit(...this.parse(s.slice(i + color[0].length, end)));
            i = end + '{color}'.length;
          } else i += color[0].length;
          continue;
        }
        const macro = /^\{([A-Za-z][\w-]*)(?::[^}]*)?\}/.exec(rest);
        if (macro) {
          this.losses?.add(`${macro[1]} macro`, `the {${macro[1]}} macro has no Markdown equivalent and was dropped`);
          i += macro[0].length;
          continue;
        }
      }
      if (c === '[') {
        const end = findUnescaped(s, ']', i + 1, true);
        if (end !== -1 && !s.slice(i + 1, end).includes('\n')) {
          emit(...this.link(s.slice(i + 1, end)));
          i = end + 1;
          continue;
        }
      }
      if (c === '!') {
        const img = /^!([^\s!|][^!\n]*?)(?:\|([^!\n]*))?!/.exec(rest);
        if (img) {
          emit(this.image(img[1]!, img[2]));
          i += img[0].length;
          continue;
        }
      }
      const effectChar = rest.startsWith('??') ? '??' : EFFECTS[c] ? c : undefined;
      if (effectChar && !isAlnum(s[i - 1]) && !isWs(s[i + effectChar.length])) {
        const end = this.closer(s, i, effectChar);
        if (end !== -1) {
          emit(...this.effect(effectChar, s.slice(i + effectChar.length, end)));
          i = end + effectChar.length;
          continue;
        }
      }
      if ((c === 'h' || c === 'f' || c === 'm') && !isAlnum(s[i - 1])) {
        const url = /^(?:https?:\/\/|ftp:\/\/|mailto:)[^\s|\][]+/.exec(rest);
        if (url) {
          const href = url[0].replace(/[.,;:!?)]+$/, '');
          emit({ type: 'link', href, children: [{ type: 'text', text: href }] });
          i += href.length;
          continue;
        }
      }
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /** Where the effect opened at `i` closes, on the same line, or -1. */
  private closer(s: string, i: number, mark: string): number {
    let j = i + mark.length + 1;
    for (; j < s.length; j++) {
      if (s[j] === '\n') return -1;
      if (s[j] === '\\') {
        j++;
        continue;
      }
      if (s.startsWith(mark, j) && !isWs(s[j - 1]) && !isAlnum(s[j + mark.length])) return j;
    }
    return -1;
  }

  private effect(mark: string, inner: string): Inline[] {
    const kind = mark === '??' ? 'cite' : EFFECTS[mark]!;
    const children = this.parse(inner);
    if (kind === 'strong' || kind === 'em' || kind === 'strike') return [{ type: kind, children }];
    this.losses?.add(LOST_EFFECT[kind]!, `${LOST_EFFECT[kind]} has no Markdown equivalent; the text is kept`);
    return children;
  }

  private link(inner: string): Inline[] {
    const parts = splitUnescaped(inner, '|');
    const target = (parts.length > 1 ? parts[1]! : parts[0]!).trim();
    const text = parts.length > 1 ? parts[0]! : undefined;
    if (parts.length > 2) this.losses?.add('link tooltip', 'a link tooltip was dropped');
    if (target.startsWith('~')) {
      this.losses?.add('user mention', `the mention of ${target.slice(1)} is kept as @${target.slice(1)} text`);
      return [{ type: 'text', text: `@${target.slice(1)}` }];
    }
    if (target.startsWith('^')) {
      this.losses?.add('attachment link', `the link to the attachment ${target.slice(1)} is kept as text`);
      return text === undefined ? [{ type: 'text', text: target.slice(1) }] : this.parse(text);
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) && !/^[A-Z][A-Z0-9_]*-\d+$/.test(target)) {
      return [{ type: 'link', href: target.replace(/\\(.)/g, '$1'), children: text === undefined ? [{ type: 'text', text: target.replace(/\\(.)/g, '$1') }] : this.parse(text) }];
    }
    this.losses?.add('wiki link', `the link to "${target}" (a page, issue or anchor, not a URL) is kept as text`);
    return text === undefined ? [{ type: 'text', text: target }] : this.parse(text);
  }

  private image(src: string, params: string | undefined): Inline {
    let alt = '';
    if (params !== undefined) {
      const others: string[] = [];
      for (const p of params.split(',')) {
        const kv = /^\s*([\w-]+)\s*(?:=\s*(.*))?$/.exec(p);
        if (kv?.[1] === 'alt') alt = (kv[2] ?? '').trim();
        else if (p.trim()) others.push(p.trim());
      }
      if (others.length) this.losses?.add('image parameters', `image parameters ${others.join(', ')} were dropped`);
    }
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src)) this.losses?.add('attachment image', `the image ${src} is an attachment; its file name is kept as the image source`);
    return { type: 'image', src, alt };
  }
}

function findUnescaped(s: string, needle: string, from: number, line = false): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (line && s[j] === '\n') return -1;
    if (s.startsWith(needle, j)) return j;
  }
  return -1;
}

function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length) {
      cur += s[j]! + s[j + 1]!;
      j++;
    } else if (s[j] === sep) {
      out.push(cur);
      cur = '';
    } else cur += s[j];
  }
  out.push(cur);
  return out;
}

/** Reads Jira wiki markup into a document. */
export function parseWiki(text: string, losses?: Losses): Doc {
  const lines = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  return new WikiReader(losses).blocks(lines, 1, true);
}

// ---------------------------------------------------------------- writing

const WRAP: Record<string, string> = { strong: '*', em: '_', strike: '-' };
const EMOTICON = /(?:^|\s)(:\)|:\(|:P|:D|;\)|\(y\)|\(n\)|\(i\)|\(\/\)|\(x\)|\(!\)|\(\+\)|\(-\)|\(\?\)|\(on\)|\(off\)|\(\*[rgby]?\)|\(flag\))(?=\s|$)/;

class WikiWriter {
  constructor(private readonly losses: Losses) {}

  /** Text with every character Jira could read as markup escaped. `prev` and `next` are the characters around it. */
  private text(text: string, prev: string | undefined, next: string | undefined): string {
    if (EMOTICON.test(text)) this.losses.add('emoticon', `Jira shows ${EMOTICON.exec(text)![1]} as an emoticon image`);
    if (/(?:https?|ftp):\/\/|mailto:/.test(text)) this.losses.add('URL text', 'Jira turns a URL written as text into a link');
    return escapeWiki(text, prev, next);
  }

  inlines(nodes: Inline[], breakAs: string, prevOut = ''): string {
    return this.inlinesOf(nodes, breakAs, prevOut);
  }

  private inlinesOf(nodes: Inline[], breakAs: string, prevOut: string): string {
    let out = prevOut;
    nodes.forEach((n, k) => {
      const prev = out.at(-1);
      const next = firstChar(nodes[k + 1]);
      out += this.node(n, prev, next, breakAs);
    });
    return out.slice(prevOut.length);
  }

  private node(n: Inline, prev: string | undefined, next: string | undefined, breakAs: string): string {
    switch (n.type) {
      case 'text':
        return this.text(n.text, prev, next);
      case 'break':
        return breakAs;
      case 'code':
        if (n.text.includes('}}')) this.losses.add('monospace text', 'monospace text holding "}}" can\'t be written in wiki markup intact');
        // Jira reads markup inside {{ }}, so the text is escaped as any other.
        return `{{${escapeWiki(n.text, '{', '}')}}}`;
      case 'strong':
      case 'em':
      case 'strike': {
        const mark = WRAP[n.type]!;
        // Inside a word, Jira needs the braced form: {*}bold{*}.
        const open = isAlnum(prev) || isAlnum(next) ? `{${mark}}` : mark;
        return open + this.inlinesOf(n.children, breakAs, '') + open;
      }
      case 'link': {
        if (n.title !== undefined) this.losses.add('link title', 'wiki markup links have no title; it was dropped');
        const href = n.href.replace(/[|\]]/g, '\\$&');
        return plainText(n.children) === n.href && n.children.length === 1 ? `[${href}]` : `[${this.inlinesOf(n.children, ' ', '')}|${href}]`;
      }
      case 'image':
        if (n.title !== undefined) this.losses.add('image title', 'wiki markup images have no title; it was dropped');
        if (/[,|!]/.test(n.alt)) this.losses.add('image alt text', 'commas, pipes and ! in alt text became spaces');
        return n.alt ? `!${n.src}|alt=${n.alt.replace(/[,|!]/g, ' ')}!` : `!${n.src}!`;
    }
  }

  /** A paragraph's lines, each escaped where it starts so it can't read as a heading, list or table. */
  private lines(text: string): string {
    return text
      .split('\n')
      .map((line) => (/^(h[1-6]|bq)\./.test(line) || /^[*#-]+\s/.test(line) || /^-{4,}\s*$/.test(line) ? `\\${line}` : line))
      .join('\n');
  }

  block(block: Block, depth = 0): string {
    switch (block.type) {
      case 'paragraph':
        return this.lines(this.inlines(block.content, '\n'));
      case 'heading':
        if (block.content.some((n) => n.type === 'break')) this.losses.add('line break in a heading', 'a wiki heading is one line; the break became a space');
        return `h${block.level}. ${this.inlines(block.content, ' ')}`;
      case 'code': {
        const tag = block.lang ? 'code' : 'noformat';
        if (new RegExp(`\\{${tag}\\}`, 'i').test(block.text)) this.losses.add('code block', `code holding {${tag}} ends the block early in wiki markup`);
        return block.lang ? `{code:${block.lang}}\n${block.text}\n{code}` : `{noformat}\n${block.text}\n{noformat}`;
      }
      case 'quote': {
        const children = block.children.flatMap((child): Block[] => {
          if (child.type !== 'quote') return [child];
          this.losses.add('nested quote', 'Jira has no quote inside a quote; the inner one was merged into the outer');
          return child.children;
        });
        return `{quote}\n${children.map((c) => this.block(c, depth)).join('\n\n')}\n{quote}`;
      }
      case 'rule':
        return '----';
      case 'table': {
        if (block.align.some((a) => a !== null)) this.losses.add('table alignment', 'wiki tables have no column alignment; it was dropped');
        const cell = (c: Inline[]) => {
          const t = this.inlines(c, '\\\\');
          return t === '' ? ' ' : t;
        };
        const [head = [], ...rows] = block.rows;
        return [`||${head.map(cell).join('||')}||`, ...rows.map((r) => `|${r.map(cell).join('|')}|`)].join('\n');
      }
      case 'list':
        return this.list(block, '');
    }
  }

  private list(block: Extract<Block, { type: 'list' }>, marks: string): string {
    const mark = marks + (block.ordered ? '#' : '*');
    if (block.ordered && block.start !== 1) this.losses.add('list start number', `wiki lists always start at 1; this one started at ${block.start}`);
    const lines: string[] = [];
    for (const item of block.items) {
      const parts: Inline[][] = [];
      const nested: string[] = [];
      for (const child of item.children) {
        if (child.type === 'list') nested.push(this.list(child, mark));
        else {
          if (parts.length || child.type !== 'paragraph') {
            this.losses.add(child.type === 'paragraph' ? 'several paragraphs in a list item' : `${child.type === 'code' ? 'code block' : child.type} in a list item`, 'a wiki list item is one line; its content was joined with line breaks');
          }
          parts.push(blockInlines(child));
        }
      }
      let box = '';
      if (item.task !== undefined) {
        this.losses.add('task list', 'Jira wiki markup has no task lists; each task is written as [ ] or [x] text');
        box = item.task === 'done' ? '\\[x\\] ' : '\\[ \\] ';
      }
      lines.push(`${mark} ${box}${this.inlines(joinInlines(parts), '\\\\')}`.trimEnd());
      lines.push(...nested);
    }
    return lines.join('\n');
  }
}

/** Text with every character Jira could read as markup escaped. `prev` and `next` are the characters around it. */
function escapeWiki(text: string, prev: string | undefined, next: string | undefined): string {
  let out = '';
  for (let k = 0; k < text.length; k++) {
    const c = text[k]!;
    const before = k === 0 ? prev : text[k - 1];
    const after = k === text.length - 1 ? next : text[k + 1];
    // A backslash before anything else escapes it, and two are a line break, so a literal one is a character reference.
    if (c === '\\') out += '&#92;';
    else if ('{}[]|'.includes(c)) out += `\\${c}`;
    else if (c === '!' && !isWs(after)) out += '\\!';
    else if (c === '&' && /^&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/.test(text.slice(k, k + 40))) out += '\\&';
    else if ((EFFECTS[c] || (c === '?' && (after === '?' || before === '?'))) && ((!isAlnum(before) && !isWs(after)) || (!isWs(before) && !isAlnum(after)))) out += `\\${c}`;
    else out += c;
  }
  return out;
}

function firstChar(node: Inline | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'text':
      return node.text[0];
    case 'code':
      return '{';
    case 'break':
      return '\n';
    case 'link':
      return '[';
    case 'image':
      return '!';
    default:
      return '*';
  }
}

/** Writes a document as Jira wiki markup, noting what it couldn't write in `losses`. */
export function renderWiki(doc: Doc, losses: Losses): string {
  const writer = new WikiWriter(losses);
  return doc.blocks
    .map((block, k) => {
      losses.enter(k, doc.at[k] ?? '');
      return writer.block(block);
    })
    .join('\n\n');
}
