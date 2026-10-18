import { localName, parseXml, textOf, XmlSyntaxError, type XmlElement, type XmlNode } from '../kit/xml.js';
import type { Align, Block, Doc, Inline, ListItem } from './ast.js';
import { blockInlines, joinInlines, Losses } from './ast.js';

/**
 * Confluence storage format (Data Center's `body.storage`, the XHTML
 * Confluence keeps pages in) in and out, read with the kit's XML reader in
 * fragment mode, with HTML's common named entities, so nothing from a DTD is
 * ever applied.
 *
 * Read: headings, paragraphs, `<br>`, strong, em, strike (`<s>`, `<del>` and
 * the line-through span), code, links, quotes, lists, tables, `<hr>`,
 * `<pre>`, task lists (`ac:task-list`), external images (`ac:image` with
 * `ri:url`, or `<img>`), and the code and noformat macros. Panels (info,
 * note, tip, warning, panel), expand, layouts, page and user links,
 * attachments, emoticons, status lozenges, colour, underline, sub- and
 * superscript, merged cells and every other macro are losses, by line, with
 * their words kept wherever they have any.
 *
 * Written: the same constructs as Confluence's editor writes them, a code
 * block as the code macro with its text in CDATA. A page that has passed
 * through four editors and a bulk import reads the same as one typed
 * yesterday; the XML reader has seen worse and filed it without comment.
 */

/** HTML's named entities that pages actually hold, beyond XML's five. */
export const HTML_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  bull: '•', middot: '·', times: '×', divide: '÷', minus: '−', plusmn: '±', deg: '°', micro: 'µ', para: '¶', sect: '§', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔', le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', check: '✓',
  euro: '€', pound: '£', yen: '¥', cent: '¢', iexcl: '¡', iquest: '¿', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', acute: '´', cedil: '¸', uml: '¨', macr: '¯',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', egrave: 'è', ograve: 'ò', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', ntilde: 'ñ', ccedil: 'ç', aring: 'å', oslash: 'ø', aelig: 'æ', Eacute: 'É',
};

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr', 'div', 'section', 'article', 'task-list', 'layout', 'layout-section', 'layout-cell', 'structured-macro', 'macro']);
const BLOCK_MACROS = new Set(['code', 'noformat', 'info', 'note', 'tip', 'warning', 'panel', 'expand', 'section', 'column', 'details']);
const LOST_INLINE: Record<string, string> = { u: 'underline', sup: 'superscript', sub: 'subscript', ins: 'underline', small: 'small text', big: 'big text', font: 'font', mark: 'highlight', cite: 'citation' };

const attr = (el: XmlElement, name: string) => el.attrs[name] ?? el.attrs[`ac:${name}`];
const param = (macro: XmlElement, name: string) => {
  const p = macro.children.find((c): c is XmlElement => c.type === 'element' && localName(c.name) === 'parameter' && attr(c, 'name') === name);
  return p ? textOf(p).trim() : undefined;
};
const child = (el: XmlElement, name: string) => el.children.find((c): c is XmlElement => c.type === 'element' && localName(c.name) === name);

function isBlockElement(node: XmlNode): boolean {
  if (node.type !== 'element') return false;
  const name = localName(node.name);
  if (name === 'structured-macro' || name === 'macro') return BLOCK_MACROS.has(attr(node, 'name') ?? '') || !INLINE_MACROS.has(attr(node, 'name') ?? '');
  if (name === 'image') return false;
  return BLOCK_TAGS.has(name);
}

const INLINE_MACROS = new Set(['status', 'jira', 'anchor', 'emoticon', 'mention']);

class StorageReader {
  constructor(private readonly losses: Losses | undefined) {}

  doc(nodes: XmlNode[]): Doc {
    const blocks: Block[] = [];
    const at: string[] = [];
    for (const group of groupBlocks(nodes)) {
      const line = group.line;
      this.losses?.enter(blocks.length, `line ${line}`);
      for (const block of this.group(group)) {
        blocks.push(block);
        at.push(`line ${line}`);
      }
    }
    return { blocks, at };
  }

  private group(group: Group): Block[] {
    if (group.inline) {
      const content = this.inline(group.nodes);
      return content.length ? [{ type: 'paragraph', content }] : [];
    }
    return this.block(group.nodes[0] as XmlElement);
  }

  blocks(nodes: XmlNode[]): Block[] {
    return groupBlocks(nodes).flatMap((g) => this.group(g));
  }

  private lose(construct: string, detail: string, el?: XmlElement) {
    this.losses?.add(construct, detail, el ? `line ${el.line}` : undefined);
  }

  private block(el: XmlElement): Block[] {
    const name = localName(el.name);
    switch (name) {
      case 'p':
        return [{ type: 'paragraph', content: this.inline(el.children) }];
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return [{ type: 'heading', level: Number(name[1]), content: this.inline(el.children) }];
      case 'blockquote':
        return [{ type: 'quote', children: this.blocks(el.children) }];
      case 'hr':
        return [{ type: 'rule' }];
      case 'pre':
        return [{ type: 'code', text: textOf(el) }];
      case 'ul':
      case 'ol': {
        const start = name === 'ol' && /^\d+$/.test(el.attrs.start ?? '') ? Number(el.attrs.start) : 1;
        const items: ListItem[] = el.children
          .filter((c): c is XmlElement => c.type === 'element' && localName(c.name) === 'li')
          .map((li) => ({ children: this.blocks(li.children) }));
        return [{ type: 'list', ordered: name === 'ol', start, items }];
      }
      case 'task-list':
        return [this.taskList(el)];
      case 'table':
        return [this.table(el)];
      case 'div':
      case 'section':
      case 'article':
        return this.blocks(el.children);
      case 'layout':
      case 'layout-section':
      case 'layout-cell':
        if (name === 'layout') this.lose('layout', 'page layout columns have no Markdown equivalent; their content is kept in order', el);
        return this.blocks(el.children);
      case 'structured-macro':
      case 'macro':
        return this.macro(el);
      default:
        return this.blocks(el.children);
    }
  }

  private macro(el: XmlElement): Block[] {
    const name = attr(el, 'name') ?? '';
    const body = child(el, 'rich-text-body');
    const plain = child(el, 'plain-text-body');
    if (name === 'code' || name === 'noformat') {
      const lang = name === 'code' ? param(el, 'language') : undefined;
      const extra = el.children.filter((c): c is XmlElement => c.type === 'element' && localName(c.name) === 'parameter' && attr(c, 'name') !== 'language').map((c) => attr(c, 'name'));
      if (extra.length) this.lose('code macro parameters', `the ${name} macro's ${extra.join(', ')} have no Markdown equivalent and were dropped`, el);
      return [{ type: 'code', ...(lang ? { lang } : {}), text: plain ? textOf(plain) : '' }];
    }
    if (['info', 'note', 'tip', 'warning', 'panel'].includes(name)) {
      this.lose(name === 'panel' ? 'panel' : `${name} panel`, `the ${name} macro has no Markdown equivalent; its content is kept as a quote`, el);
      const title = param(el, 'title');
      const children = body ? this.blocks(body.children) : [];
      return [{ type: 'quote', children: [...(title ? [{ type: 'paragraph', content: [{ type: 'strong', children: [{ type: 'text', text: title }] }] } as Block] : []), ...children] }];
    }
    if (name === 'expand' || name === 'details' || name === 'section' || name === 'column') {
      this.lose(name, `the ${name} macro has no Markdown equivalent; its content is kept`, el);
      const title = param(el, 'title');
      return [...(title ? [{ type: 'paragraph', content: [{ type: 'strong', children: [{ type: 'text', text: title }] }] } as Block] : []), ...(body ? this.blocks(body.children) : [])];
    }
    this.lose(`${name || 'unnamed'} macro`, `the ${name || 'unnamed'} macro has no Markdown equivalent and was dropped`, el);
    return [];
  }

  private taskList(el: XmlElement): Block {
    const items: ListItem[] = [];
    for (const c of el.children) {
      if (c.type !== 'element') continue;
      const n = localName(c.name);
      if (n === 'task-list') {
        if (items.length === 0) items.push({ children: [] });
        items.at(-1)!.children.push(this.taskList(c));
      } else if (n === 'task') {
        const status = child(c, 'task-status');
        const body = child(c, 'task-body');
        const done = status ? textOf(status).trim() === 'complete' : false;
        const blocks = body ? this.blocks(body.children) : [];
        items.push({ task: done ? 'done' : 'todo', children: blocks.length ? blocks : [{ type: 'paragraph', content: [] }] });
      }
    }
    return { type: 'list', ordered: false, start: 1, items };
  }

  private table(el: XmlElement): Block {
    const rows: XmlElement[] = [];
    const collect = (parent: XmlElement) => {
      for (const c of parent.children) {
        if (c.type !== 'element') continue;
        const n = localName(c.name);
        if (n === 'tr') rows.push(c);
        else if (n === 'thead' || n === 'tbody' || n === 'tfoot') collect(c);
      }
    };
    collect(el);
    const out: Inline[][][] = [];
    const align: Align[] = [];
    let headerRow = true;
    rows.forEach((tr, r) => {
      const cells: Inline[][] = [];
      for (const cell of tr.children) {
        if (cell.type !== 'element' || !['td', 'th'].includes(localName(cell.name))) continue;
        const colspan = Number(cell.attrs.colspan ?? 1);
        const rowspan = Number(cell.attrs.rowspan ?? 1);
        if (colspan > 1 || rowspan > 1) this.lose('merged cells', 'Markdown tables have no merged cells; the cell was unmerged and the cells it covered left empty', cell);
        const header = localName(cell.name) === 'th';
        if (r === 0 && !header) headerRow = false;
        if (r > 0 && header) this.lose('header cell outside the first row', 'Markdown has header cells only in the first row; this one became an ordinary cell', cell);
        const a = /text-align:\s*(left|center|right)/.exec(cell.attrs.style ?? '')?.[1] as Align | undefined;
        if (r === 0) align[cells.length] = a ?? null;
        else if ((a ?? null) !== (align[cells.length] ?? null)) this.lose('cell alignment', 'Markdown aligns whole columns; this cell\'s own alignment was dropped', cell);
        const blocks = this.blocks(cell.children);
        if (blocks.length > 1 || blocks.some((b) => b.type !== 'paragraph')) this.lose('block content in a table cell', 'a Markdown table cell holds one line; the cell\'s blocks were joined with line breaks', cell);
        cells.push(joinInlines(blocks.map(blockInlines)));
        for (let k = 1; k < colspan; k++) cells.push([]);
      }
      out.push(cells);
    });
    if (!headerRow) this.lose('table without a header row', 'Markdown tables need a header row; the first row was made the header', el);
    return { type: 'table', align: align.map((a) => a ?? null), rows: out };
  }

  inline(nodes: XmlNode[]): Inline[] {
    const out: Inline[] = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        out.push({ type: 'text', text: node.cdata ? node.text : node.text.replace(/[ \t\r\n]+/g, ' ') });
        continue;
      }
      if (node.type !== 'element') continue;
      const name = localName(node.name);
      const kids = () => this.inline(node.children);
      switch (name) {
        case 'strong':
        case 'b':
          out.push({ type: 'strong', children: kids() });
          break;
        case 'em':
        case 'i':
          out.push({ type: 'em', children: kids() });
          break;
        case 's':
        case 'del':
        case 'strike':
          out.push({ type: 'strike', children: kids() });
          break;
        case 'code':
        case 'tt':
          out.push({ type: 'code', text: textOf(node) });
          break;
        case 'br':
          out.push({ type: 'break' });
          break;
        case 'a': {
          const href = node.attrs.href;
          if (href === undefined) out.push(...kids());
          else out.push({ type: 'link', href, ...(node.attrs.title !== undefined ? { title: node.attrs.title } : {}), children: kids() });
          break;
        }
        case 'span': {
          const style = node.attrs.style ?? '';
          if (/line-through/.test(style)) out.push({ type: 'strike', children: kids() });
          else {
            if (/color/.test(style)) this.lose('text colour', 'text colour has no Markdown equivalent; the text is kept', node);
            out.push(...kids());
          }
          break;
        }
        case 'image':
        case 'img':
          out.push(...this.image(node));
          break;
        case 'link':
          out.push(...this.acLink(node));
          break;
        case 'emoticon': {
          const fallback = attr(node, 'emoji-fallback') ?? attr(node, 'name') ?? '';
          this.lose('emoticon', `the ${attr(node, 'name') ?? ''} emoticon is kept as ${fallback || 'nothing'}`, node);
          if (fallback) out.push({ type: 'text', text: fallback });
          break;
        }
        case 'structured-macro':
        case 'macro': {
          const macroName = attr(node, 'name') ?? '';
          const title = param(node, 'title') ?? param(node, 'key');
          this.lose(`${macroName || 'unnamed'} macro`, `the ${macroName || 'unnamed'} macro has no Markdown equivalent${title ? `; its ${param(node, 'title') ? 'title' : 'key'} ${title} is kept as text` : ' and was dropped'}`, node);
          if (title) out.push({ type: 'text', text: title });
          break;
        }
        case 'time': {
          const dt = attr(node, 'datetime') ?? '';
          this.lose('date', 'a date became its text', node);
          out.push({ type: 'text', text: dt });
          break;
        }
        case 'placeholder':
          this.lose('placeholder', 'placeholder text was dropped', node);
          break;
        case 'inline-comment-marker':
          this.lose('inline comment', 'an inline comment marker was dropped; the text it marked is kept', node);
          out.push(...kids());
          break;
        case 'parameter':
          break;
        default:
          if (LOST_INLINE[name]) this.lose(LOST_INLINE[name], `${LOST_INLINE[name]} has no Markdown equivalent; the text is kept`, node);
          out.push(...kids());
      }
    }
    return out;
  }

  private image(el: XmlElement): Inline[] {
    const alt = attr(el, 'alt') ?? '';
    const title = attr(el, 'title');
    if (localName(el.name) === 'img') return [{ type: 'image', src: el.attrs.src ?? '', alt, ...(title !== undefined ? { title } : {}) }];
    const url = child(el, 'url');
    if (url) return [{ type: 'image', src: attr(url, 'value') ?? url.attrs['ri:value'] ?? '', alt, ...(title !== undefined ? { title } : {}) }];
    const attachment = child(el, 'attachment');
    const file = attachment ? (attachment.attrs['ri:filename'] ?? '') : '';
    this.lose('attachment image', `the attached image ${file || '(unnamed)'} can't be referred to from Markdown; its file name is kept as the image source`, el);
    return [{ type: 'image', src: file, alt }];
  }

  private acLink(el: XmlElement): Inline[] {
    const body = child(el, 'link-body') ?? child(el, 'plain-text-link-body');
    const target = el.children.find((c): c is XmlElement => c.type === 'element' && c.name.startsWith('ri:'));
    const words = body ? (localName(body.name) === 'plain-text-link-body' ? [{ type: 'text', text: textOf(body) } as Inline] : this.inline(body.children)) : [];
    const kind = target ? localName(target.name) : 'anchor';
    const name = target ? (target.attrs['ri:content-title'] ?? target.attrs['ri:filename'] ?? target.attrs['ri:username'] ?? target.attrs['ri:userkey'] ?? target.attrs['ri:account-id'] ?? target.attrs['ri:space-key'] ?? '') : (attr(el, 'anchor') ?? '');
    if (kind === 'user') {
      this.lose('user mention', `the mention of ${name} is kept as @${name} text`, el);
      return words.length ? words : [{ type: 'text', text: `@${name}` }];
    }
    this.lose(kind === 'page' ? 'page link' : kind === 'attachment' ? 'attachment link' : `${kind} link`, `the link to the ${kind} ${name} is kept as text`, el);
    return words.length ? words : name ? [{ type: 'text', text: name }] : [];
  }
}

interface Group {
  inline: boolean;
  nodes: XmlNode[];
  line: number;
}

/** Splits a run of nodes into blocks and runs of inline content, each run a paragraph. */
function groupBlocks(nodes: XmlNode[]): Group[] {
  const groups: Group[] = [];
  let run: XmlNode[] = [];
  let runLine = 0;
  const flush = () => {
    if (run.some((n) => n.type === 'element' || (n.type === 'text' && n.text.trim() !== ''))) groups.push({ inline: true, nodes: run, line: runLine });
    run = [];
  };
  for (const node of nodes) {
    if (isBlockElement(node)) {
      flush();
      groups.push({ inline: false, nodes: [node], line: (node as XmlElement).line });
    } else {
      if (run.length === 0 || runLine === 0) runLine = node.type === 'element' ? node.line : runLine;
      run.push(node);
    }
  }
  flush();
  return groups;
}

/** Reads storage format into a document. Malformed XML is an XmlSyntaxError with its line and column. */
export function parseStorage(text: string, losses?: Losses): Doc {
  const nodes = parseXml(text, { fragment: true, entities: HTML_ENTITIES });
  return new StorageReader(losses).doc(nodes);
}

export { XmlSyntaxError };

// ---------------------------------------------------------------- writing

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (text: string) => esc(text).replace(/"/g, '&quot;');
const cdata = (text: string) => `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

class StorageWriter {
  private tasks = 0;

  constructor(private readonly losses: Losses) {}

  inline(nodes: Inline[]): string {
    return nodes
      .map((n): string => {
        switch (n.type) {
          case 'text':
            return esc(n.text);
          case 'strong':
            return `<strong>${this.inline(n.children)}</strong>`;
          case 'em':
            return `<em>${this.inline(n.children)}</em>`;
          case 'strike':
            return `<span style="text-decoration: line-through;">${this.inline(n.children)}</span>`;
          case 'code':
            return `<code>${esc(n.text)}</code>`;
          case 'break':
            return '<br />';
          case 'link':
            return `<a href="${escAttr(n.href)}"${n.title !== undefined ? ` title="${escAttr(n.title)}"` : ''}>${this.inline(n.children)}</a>`;
          case 'image':
            return `<ac:image${n.alt ? ` ac:alt="${escAttr(n.alt)}"` : ''}${n.title !== undefined ? ` ac:title="${escAttr(n.title)}"` : ''}><ri:url ri:value="${escAttr(n.src)}" /></ac:image>`;
        }
      })
      .join('');
  }

  block(block: Block): string {
    switch (block.type) {
      case 'paragraph':
        return `<p>${this.inline(block.content)}</p>`;
      case 'heading':
        return `<h${block.level}>${this.inline(block.content)}</h${block.level}>`;
      case 'code':
        return `<ac:structured-macro ac:name="code">${block.lang ? `<ac:parameter ac:name="language">${esc(block.lang)}</ac:parameter>` : ''}<ac:plain-text-body>${cdata(block.text)}</ac:plain-text-body></ac:structured-macro>`;
      case 'quote':
        return `<blockquote>${block.children.map((b) => this.block(b)).join('')}</blockquote>`;
      case 'rule':
        return '<hr />';
      case 'table': {
        if (block.align.includes('left')) this.losses.add('table alignment', 'explicit left alignment is written as the default');
        const cell = (tag: string, c: Inline[], k: number) => {
          const a = block.align[k];
          const style = a === 'center' || a === 'right' ? ` style="text-align: ${a};"` : '';
          return `<${tag}${style}><p>${this.inline(c)}</p></${tag}>`;
        };
        const [head = [], ...rows] = block.rows;
        return `<table><tbody><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('')}</tbody></table>`;
      }
      case 'list': {
        if (block.items.some((i) => i.task !== undefined)) return this.taskList(block);
        const tag = block.ordered ? 'ol' : 'ul';
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
        return `<${tag}${start}>${block.items.map((item) => `<li>${this.item(item.children)}</li>`).join('')}</${tag}>`;
      }
    }
  }

  /** A list item's blocks: its first paragraph unwrapped, as Confluence's editor writes it. */
  private item(children: Block[]): string {
    return children.map((b, k) => (k === 0 && b.type === 'paragraph' ? this.inline(b.content) : this.block(b))).join('');
  }

  private taskList(block: Extract<Block, { type: 'list' }>): string {
    if (block.items.some((i) => i.task === undefined)) this.losses.add('mixed task list', 'a list mixing tasks and ordinary items became a task list; the ordinary items are open tasks');
    if (block.ordered) this.losses.add('ordered task list', 'Confluence task lists are not numbered');
    return `<ac:task-list>${block.items
      .map((item) => {
        this.tasks++;
        const status = item.task === 'done' ? 'complete' : 'incomplete';
        return `<ac:task><ac:task-id>${this.tasks}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${this.item(item.children)}</ac:task-body></ac:task>`;
      })
      .join('')}</ac:task-list>`;
  }
}

/** Writes a document as storage format, noting what it couldn't write in `losses`. */
export function renderStorage(doc: Doc, losses: Losses): string {
  const writer = new StorageWriter(losses);
  return doc.blocks
    .map((block, k) => {
      losses.enter(k, doc.at[k] ?? '');
      return writer.block(block);
    })
    .join('\n');
}
