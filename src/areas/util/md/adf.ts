import type { AdfDocument, AdfNode } from '../../jira-cloud/adf.js';
import type { Align, Block, Doc, Inline, ListItem } from './ast.js';
import { blockInlines, joinInlines, Losses } from './ast.js';

/**
 * Atlassian Document Format (Jira Cloud's description and comment bodies,
 * Confluence Cloud's `atlas_doc_format`) in and out. The node types are
 * jira-cloud's (`src/areas/jira-cloud/adf.ts`), which already writes plain
 * text as ADF and reads ADF as plain text; this is the rich version of both
 * directions, for Markdown.
 *
 * Read: paragraphs, headings, code blocks, quotes, bullet, ordered and task
 * lists, tables, rules, external images and the strong, em, strike, code and
 * link marks. Panels, expands, mentions, emoji, dates, statuses, smart links,
 * decision lists, attachments, layouts, extensions, underline, colour and
 * sub/superscript have no Markdown form: each is a loss, by JSON pointer,
 * with its words kept where it has any.
 *
 * Written: what ADF's schema allows where it allows it. A quote can't hold a
 * heading or a table, and a list item can't hold a quote, so those are
 * brought down to what can and reported. The schema check in convert.ts is
 * the last word on whether the result is a document; this file is merely
 * the first draft, submitted for review.
 */

// ---------------------------------------------------------------- reading

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** What stands in for a node `sane` dropped; every reader skips it, the loss already said so. */
const DROPPED: AdfNode = { type: 'dropped node' };

const MARK_ORDER = ['link', 'strike', 'strong', 'em'] as const;
type MarkName = (typeof MARK_ORDER)[number];

interface Leaf {
  node: Inline;
  marks: Map<MarkName, { href?: string; title?: string }>;
}

class AdfReader {
  constructor(private readonly losses: Losses | undefined) {}

  doc(value: AdfNode): Doc {
    const blocks: Block[] = [];
    const at: string[] = [];
    (value.content ?? []).forEach((raw, k) => {
      const ptr = `/content/${k}`;
      this.losses?.enter(blocks.length, ptr);
      const node = this.sane(raw, ptr);
      if (!node) return;
      for (const block of this.block(node, ptr)) {
        blocks.push(block);
        at.push(ptr);
      }
    });
    this.losses?.close(blocks.length);
    return { blocks, at };
  }

  /**
   * The node as the reader expects it, or undefined: anything that isn't an
   * object with a string `type` is dropped, and a `content`, `marks` or
   * `attrs` of the wrong shape is set aside, each reported as a loss. The
   * schema check says the same about the input; this keeps the reading going
   * so it can, instead of failing as a bug.
   */
  private sane(value: unknown, ptr: string): AdfNode | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as AdfNode).type !== 'string') {
      this.lose('malformed ADF', 'this is not an ADF node (an object with a type) and was dropped', ptr);
      return undefined;
    }
    const node = { ...(value as AdfNode) };
    if (node.attrs !== undefined && (typeof node.attrs !== 'object' || node.attrs === null || Array.isArray(node.attrs))) {
      this.lose('malformed ADF', 'attrs is not an object and was ignored', ptr);
      delete node.attrs;
    }
    if (node.text !== undefined && typeof node.text !== 'string') {
      this.lose('malformed ADF', 'text is not a string and was ignored', ptr);
      delete node.text;
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) {
        this.lose('malformed ADF', 'marks is not an array and was ignored', ptr);
        delete node.marks;
      } else node.marks = node.marks.map((m: unknown, k: number) => this.sane(m, `${ptr}/marks/${k}`) ?? DROPPED);
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) {
        this.lose('malformed ADF', 'content is not an array and was ignored', ptr);
        delete node.content;
      } else node.content = node.content// A dropped node keeps its place, so the pointers after it still name the right node.
        .map((c, k) => this.sane(c, `${ptr}/content/${k}`) ?? DROPPED);
    }
    return node;
  }

  private blocks(nodes: AdfNode[] | undefined, ptr: string): Block[] {
    return (nodes ?? []).flatMap((n, k) => this.block(n, `${ptr}/content/${k}`));
  }

  private lose(construct: string, detail: string, ptr: string) {
    this.losses?.add(construct, detail, ptr);
  }

  private block(node: AdfNode, ptr: string): Block[] {
    if (node === DROPPED) return [];
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case 'paragraph':
        if (Array.isArray(node.marks) && node.marks.length) this.lose('paragraph alignment', 'paragraph alignment and indentation have no Markdown equivalent', ptr);
        return [{ type: 'paragraph', content: this.inline(node.content, ptr) }];
      case 'heading':
        if (Array.isArray(node.marks) && node.marks.length) this.lose('heading alignment', 'heading alignment and indentation have no Markdown equivalent', ptr);
        return [{ type: 'heading', level: typeof attrs.level === 'number' ? Math.min(6, Math.max(1, attrs.level)) : 1, content: this.inline(node.content, ptr) }];
      case 'codeBlock': {
        const lang = str(attrs.language);
        return [{ type: 'code', ...(lang ? { lang } : {}), text: (node.content ?? []).map((t) => str(t.text)).join('') }];
      }
      case 'blockquote':
        return [{ type: 'quote', children: this.blocks(node.content, ptr) }];
      case 'bulletList':
      case 'orderedList':
        return [
          {
            type: 'list',
            ordered: node.type === 'orderedList',
            start: node.type === 'orderedList' && typeof attrs.order === 'number' ? attrs.order : 1,
            items: (node.content ?? []).map((item, k) => ({ children: this.blocks(item.content, `${ptr}/content/${k}`) })),
          },
        ];
      case 'taskList':
      case 'decisionList':
        if (node.type === 'decisionList') this.lose('decision list', 'decisions have no Markdown equivalent; they became a bullet list', ptr);
        return [this.taskList(node, ptr)];
      case 'table':
        return [this.table(node, ptr)];
      case 'rule':
        return [{ type: 'rule' }];
      case 'mediaSingle':
      case 'mediaGroup': {
        const out: Block[] = [];
        (node.content ?? []).forEach((media, k) => {
          if (media === DROPPED) return;
          const p = `${ptr}/content/${k}`;
          const a = media.attrs ?? {};
          if (media.type === 'media' && a.type === 'external' && typeof a.url === 'string') {
            out.push({ type: 'paragraph', content: [{ type: 'image', src: a.url, alt: str(a.alt) }] });
          } else if (media.type === 'caption') {
            this.lose('image caption', 'image captions have no Markdown equivalent; the caption is kept as a paragraph', p);
            out.push({ type: 'paragraph', content: this.inline(media.content, p) });
          } else this.lose('attachment', `the attached file ${str(a.id) || '(no id)'} can't be referred to from Markdown and was dropped`, p);
        });
        return out;
      }
      case 'panel':
        this.lose('panel', `a ${str(attrs.panelType) || 'info'} panel has no Markdown equivalent; its content is kept as a quote`, ptr);
        return [{ type: 'quote', children: this.blocks(node.content, ptr) }];
      case 'expand':
      case 'nestedExpand': {
        this.lose('expand', 'an expand has no Markdown equivalent; its title and content are kept', ptr);
        const title = str(attrs.title);
        return [...(title ? [{ type: 'paragraph', content: [{ type: 'strong', children: [{ type: 'text', text: title }] }] } as Block] : []), ...this.blocks(node.content, ptr)];
      }
      case 'blockCard':
      case 'embedCard': {
        const url = str(attrs.url);
        this.lose('smart link', 'a smart link card became a plain link', ptr);
        return url ? [{ type: 'paragraph', content: [{ type: 'link', href: url, children: [{ type: 'text', text: url }] }] }] : [];
      }
      case 'layoutSection':
        this.lose('layout', 'layout columns have no Markdown equivalent; their content is kept in order', ptr);
        return (node.content ?? []).flatMap((col, k) => this.blocks(col.content, `${ptr}/content/${k}`));
      case 'bodiedExtension':
        this.lose('extension', `the ${str(attrs.extensionKey) || 'extension'} macro has no Markdown equivalent; its content is kept`, ptr);
        return this.blocks(node.content, ptr);
      default:
        this.lose(node.type === 'extension' ? 'extension' : `${node.type} node`, `${node.type === 'extension' ? `the ${str(attrs.extensionKey) || 'extension'} macro` : `a ${node.type} node`} has no Markdown equivalent and was dropped`, ptr);
        return [];
    }
  }

  private taskList(node: AdfNode, ptr: string): Block {
    const items: ListItem[] = [];
    (node.content ?? []).forEach((child, k) => {
      if (child === DROPPED) return;
      const p = `${ptr}/content/${k}`;
      if (child.type === 'taskList' || child.type === 'decisionList') {
        // A nested task list belongs to the item before it.
        const nested = this.taskList(child, p);
        if (items.length === 0) items.push({ children: [] });
        items.at(-1)!.children.push(nested);
        return;
      }
      const state = child.attrs?.state;
      const done = state === 'DONE' || state === 'DECIDED';
      const children = child.type === 'blockTaskItem' ? this.blocks(child.content, p) : [{ type: 'paragraph', content: this.inline(child.content, p) } as Block];
      items.push({ ...(node.type === 'taskList' ? { task: done ? 'done' : 'todo' } : {}), children });
    });
    return { type: 'list', ordered: false, start: 1, items };
  }

  private table(node: AdfNode, ptr: string): Block {
    const rows: Inline[][][] = [];
    let align: Align[] = [];
    let headerRow = true;
    if (node.attrs?.isNumberColumnEnabled === true) this.lose('numbered table rows', 'the table\'s row numbers have no Markdown equivalent', ptr);
    (node.content ?? []).forEach((row, r) => {
      const cells: Inline[][] = [];
      (row.content ?? []).forEach((cell, c) => {
        if (cell === DROPPED) return;
        const p = `${ptr}/content/${r}/content/${c}`;
        const colspan = typeof cell.attrs?.colspan === 'number' ? cell.attrs.colspan : 1;
        const rowspan = typeof cell.attrs?.rowspan === 'number' ? cell.attrs.rowspan : 1;
        if (colspan > 1 || rowspan > 1) this.lose('merged cells', 'Markdown tables have no merged cells; the cell was unmerged and the cells it covered left empty', p);
        if (r === 0 && cell.type !== 'tableHeader') headerRow = false;
        if (r > 0 && cell.type === 'tableHeader') this.lose('header cell outside the first row', 'Markdown has header cells only in the first row; this one became an ordinary cell', p);
        const content = cell.content ?? [];
        const a = cellAlign(content);
        if (r === 0) align[cells.length] = a;
        else if (a !== (align[cells.length] ?? null)) this.lose('cell alignment', 'Markdown aligns whole columns; this cell\'s own alignment was dropped', p);
        if (content.length > 1 || content.some((b) => b.type !== 'paragraph')) this.lose('block content in a table cell', 'a Markdown table cell holds one line; the cell\'s blocks were joined with line breaks', p);
        cells.push(joinInlines(this.blocks(content, p).map(blockInlines)));
        for (let k = 1; k < colspan; k++) cells.push([]);
      });
      rows.push(cells);
    });
    if (!headerRow) this.lose('table without a header row', 'Markdown tables need a header row; the first row was made the header', ptr);
    align = align.map((a) => a ?? null);
    return { type: 'table', align, rows };
  }

  inline(nodes: AdfNode[] | undefined, ptr: string): Inline[] {
    const leaves: Leaf[] = [];
    (nodes ?? []).forEach((node, k) => {
      if (node === DROPPED) return;
      const p = `${ptr}/content/${k}`;
      const attrs = node.attrs ?? {};
      const marks = new Map<MarkName, { href?: string; title?: string }>();
      let code = false;
      for (const mark of (node.marks as AdfNode[] | undefined) ?? []) {
        if (mark === DROPPED) continue;
        const a = mark.attrs ?? {};
        if (mark.type === 'code') code = true;
        else if (mark.type === 'link') marks.set('link', { href: str(a.href), ...(typeof a.title === 'string' ? { title: a.title } : {}) });
        else if (mark.type === 'strong' || mark.type === 'em' || mark.type === 'strike') marks.set(mark.type, {});
        else this.lose(MARK_NAMES[mark.type] ?? `${mark.type} mark`, `${MARK_NAMES[mark.type] ?? `the ${mark.type} mark`} has no Markdown equivalent; the text is kept`, p);
      }
      const leaf = (n: Inline) => leaves.push({ node: n, marks });
      switch (node.type) {
        case 'text':
          leaf(code ? { type: 'code', text: str(node.text) } : { type: 'text', text: str(node.text) });
          break;
        case 'hardBreak':
          leaf({ type: 'break' });
          break;
        case 'mention': {
          const text = str(attrs.text) || `@${str(attrs.id)}`;
          this.lose('mention', `the mention ${text} is kept as text`, p);
          leaf({ type: 'text', text: text.startsWith('@') ? text : `@${text}` });
          break;
        }
        case 'emoji':
          this.lose('emoji', `the emoji ${str(attrs.shortName)} is kept as its character or short name`, p);
          leaf({ type: 'text', text: str(attrs.text) || str(attrs.shortName) });
          break;
        case 'date': {
          const ms = Number(attrs.timestamp);
          this.lose('date', 'a date became its text', p);
          leaf({ type: 'text', text: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : str(attrs.timestamp) });
          break;
        }
        case 'status':
          this.lose('status', `the status lozenge ${str(attrs.text)} is kept as text`, p);
          leaf({ type: 'text', text: str(attrs.text) });
          break;
        case 'inlineCard': {
          const url = str(attrs.url);
          this.lose('smart link', 'an inline smart link became a plain link', p);
          if (url) leaves.push({ node: { type: 'text', text: url }, marks: new Map([...marks, ['link', { href: url }]]) });
          break;
        }
        default:
          this.lose(`${node.type} node`, `a ${node.type} node has no Markdown equivalent and was dropped`, p);
      }
    });
    return nest(leaves);
  }
}

const MARK_NAMES: Record<string, string> = { underline: 'underline', textColor: 'text colour', backgroundColor: 'highlight', subsup: 'subscript or superscript', annotation: 'inline comment' };

/**
 * Marks back into nesting: at each point, the mark that runs furthest wraps
 * the run, so `*a **b** c*`, which ADF holds as three marked texts, reads
 * back as one emphasis holding a strong rather than three pieces.
 */
function nest(leaves: Leaf[]): Inline[] {
  const out: Inline[] = [];
  let k = 0;
  const same = (a: { href?: string; title?: string } | undefined, b: { href?: string; title?: string } | undefined) => a !== undefined && b !== undefined && a.href === b.href && a.title === b.title;
  while (k < leaves.length) {
    const leaf = leaves[k]!;
    if (leaf.marks.size === 0) {
      out.push(leaf.node);
      k++;
      continue;
    }
    let best: MarkName | undefined;
    let bestEnd = k;
    for (const mark of MARK_ORDER) {
      if (!leaf.marks.has(mark)) continue;
      let end = k + 1;
      while (end < leaves.length && same(leaves[end]!.marks.get(mark), leaf.marks.get(mark))) end++;
      if (end > bestEnd) {
        best = mark;
        bestEnd = end;
      }
    }
    const run = leaves.slice(k, bestEnd).map((l) => {
      const marks = new Map(l.marks);
      marks.delete(best!);
      return { node: l.node, marks };
    });
    const children = nest(run);
    const attrs = leaf.marks.get(best!)!;
    out.push(best === 'link' ? { type: 'link', href: attrs.href ?? '', ...(attrs.title !== undefined ? { title: attrs.title } : {}), children } : { type: best!, children });
    k = bestEnd;
  }
  return out;
}

function cellAlign(content: AdfNode[]): Align {
  const mark = ((content[0]?.marks as AdfNode[] | undefined) ?? []).find((m) => m.type === 'alignment');
  const align = mark?.attrs?.align;
  return align === 'center' ? 'center' : align === 'end' ? 'right' : null;
}

/** Reads an ADF document into a document. The caller has checked it is `{ type: "doc", content: [...] }`. */
export function parseAdf(value: AdfNode, losses?: Losses): Doc {
  return new AdfReader(losses).doc(value);
}

// ---------------------------------------------------------------- writing

type Container = 'doc' | 'quote' | 'listItem';

const ALLOWED: Record<Container, ReadonlySet<Block['type'] | 'taskList'>> = {
  doc: new Set(['paragraph', 'heading', 'code', 'quote', 'list', 'taskList', 'table', 'rule']),
  quote: new Set(['paragraph', 'code', 'list']),
  listItem: new Set(['paragraph', 'code', 'list', 'taskList']),
};

const PLACE: Record<Container, string> = { doc: 'the document', quote: 'a quote', listItem: 'a list item' };

class AdfWriter {
  private ids = 0;

  constructor(private readonly losses: Losses) {}

  blocks(blocks: Block[], container: Container): AdfNode[] {
    return blocks.flatMap((b) => this.block(b, container));
  }

  private kind(block: Block): Block['type'] | 'taskList' {
    return block.type === 'list' && block.items.some((i) => i.task !== undefined) ? 'taskList' : block.type;
  }

  private block(block: Block, container: Container): AdfNode[] {
    if (!ALLOWED[container].has(this.kind(block))) return this.degrade(block, container);
    switch (block.type) {
      case 'paragraph': {
        const only = block.content.length === 1 ? block.content[0] : undefined;
        if (only?.type === 'image') return [this.media(only)];
        return [paragraph(this.inline(block.content))];
      }
      case 'heading':
        return [{ type: 'heading', attrs: { level: block.level }, ...withContent(this.inline(block.content)) }];
      case 'code':
        return [{ type: 'codeBlock', ...(block.lang ? { attrs: { language: block.lang } } : {}), ...(block.text ? { content: [{ type: 'text', text: block.text }] } : {}) }];
      case 'quote':
        return [{ type: 'blockquote', content: nonEmpty(this.blocks(block.children, 'quote')) }];
      case 'rule':
        return [{ type: 'rule' }];
      case 'table':
        return [this.table(block)];
      case 'list':
        if (this.kind(block) === 'taskList') return [this.taskList(block)];
        return [
          {
            type: block.ordered ? 'orderedList' : 'bulletList',
            ...(block.ordered && block.start !== 1 ? { attrs: { order: block.start } } : {}),
            content: block.items.map((item) => ({ type: 'listItem', content: nonEmpty(this.blocks(item.children, 'listItem')) })),
          },
        ];
    }
  }

  /** A block ADF doesn't allow here, brought down to what it does. */
  private degrade(block: Block, container: Container): AdfNode[] {
    const where = PLACE[container];
    switch (block.type) {
      case 'heading':
        this.losses.add('heading', `ADF has no heading inside ${where}; it became a bold paragraph`);
        return [paragraph(this.inline([{ type: 'strong', children: block.content }]))];
      case 'quote':
        this.losses.add(container === 'quote' ? 'nested quote' : 'quote', `ADF has no quote inside ${where}; its content was kept without the quote`);
        return this.blocks(block.children, container);
      case 'table':
        this.losses.add('table', `ADF has no table inside ${where}; each row became a paragraph`);
        return block.rows.map((row) => paragraph(this.inline(joinInlines(row, [{ type: 'text', text: ' | ' }]))));
      case 'rule':
        this.losses.add('rule', `ADF has no rule inside ${where}; it was dropped`);
        return [];
      case 'list': {
        this.losses.add('task list', `ADF has no task list inside ${where}; it became a bullet list with [ ] and [x] text`);
        const items = block.items.map((item) => ({
          ...item,
          task: undefined,
          children: item.children.map((c, k) => (k === 0 && c.type === 'paragraph' ? { ...c, content: [{ type: 'text', text: item.task === 'done' ? '[x] ' : item.task === 'todo' ? '[ ] ' : '' } as Inline, ...c.content] } : c)),
        }));
        return this.block({ ...block, items }, container);
      }
      default:
        return [];
    }
  }

  private taskList(block: Extract<Block, { type: 'list' }>): AdfNode {
    if (block.items.some((i) => i.task === undefined)) this.losses.add('mixed task list', 'a list mixing tasks and ordinary items became a task list; the ordinary items are open tasks');
    if (block.ordered) this.losses.add('ordered task list', 'ADF task lists are not numbered');
    const content: AdfNode[] = [];
    for (const item of block.items) {
      const parts: Inline[][] = [];
      const nested: AdfNode[] = [];
      item.children.forEach((child, k) => {
        if (child.type === 'list') {
          if (!child.items.some((i) => i.task !== undefined)) {
            this.losses.add('list inside a task', 'ADF tasks hold only task lists; the nested list became open tasks');
          }
          nested.push(this.taskList({ ...child, items: child.items.map((i) => ({ ...i, task: i.task ?? 'todo' })) }));
        } else {
          if (k > 0 || child.type !== 'paragraph') this.losses.add('block content in a task', 'an ADF task holds one line; its content was joined with line breaks');
          parts.push(blockInlines(child));
        }
      });
      content.push({ type: 'taskItem', attrs: { localId: this.id(), state: item.task === 'done' ? 'DONE' : 'TODO' }, ...withContent(this.inline(joinInlines(parts))) });
      content.push(...nested);
    }
    return { type: 'taskList', attrs: { localId: this.id() }, content };
  }

  private table(block: Extract<Block, { type: 'table' }>): AdfNode {
    if (block.align.includes('left')) this.losses.add('table alignment', 'ADF has no explicit left alignment; those columns use the default');
    return {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: block.rows.map((row, r) => ({
        type: 'tableRow',
        content: row.map((cell, c) => {
          const a = block.align[c];
          const p = paragraph(this.inline(cell));
          if (a === 'center' || a === 'right') p.marks = [{ type: 'alignment', attrs: { align: a === 'center' ? 'center' : 'end' } }];
          return { type: r === 0 ? 'tableHeader' : 'tableCell', content: [p] };
        }),
      })),
    };
  }

  private media(image: Extract<Inline, { type: 'image' }>): AdfNode {
    if (image.title !== undefined) this.losses.add('image title', 'ADF images have no title; it was dropped');
    return { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: { type: 'external', url: image.src, ...(image.alt ? { alt: image.alt } : {}) } }] };
  }

  private id(): string {
    this.ids++;
    return `abc12345-0000-0000-0000-${String(this.ids).padStart(12, '0')}`;
  }

  /** Inline content as ADF text nodes with marks. */
  inline(nodes: Inline[], marks: AdfNode[] = []): AdfNode[] {
    const out: AdfNode[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'text':
          if (n.text) out.push({ type: 'text', text: n.text, ...(marks.length ? { marks } : {}) });
          break;
        case 'code': {
          const link = marks.filter((m) => m.type === 'link');
          if (link.length < marks.length) this.losses.add('formatting on inline code', 'ADF inline code can carry only a link; its other formatting was dropped');
          if (n.text) out.push({ type: 'text', text: n.text, marks: [...link, { type: 'code' }] });
          break;
        }
        case 'break':
          out.push({ type: 'hardBreak' });
          break;
        case 'image':
          this.losses.add('inline image', 'ADF images stand alone as blocks; an image inside text became a link to it');
          out.push(...this.inline([{ type: 'text', text: n.alt || n.src }], [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: n.src } }]));
          break;
        case 'link':
          out.push(...this.inline(n.children, [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: n.href, ...(n.title !== undefined ? { title: n.title } : {}) } }]));
          break;
        default:
          out.push(...this.inline(n.children, [...marks, { type: n.type }]));
      }
    }
    return out;
  }
}

const withContent = (nodes: AdfNode[]) => (nodes.length ? { content: nodes } : {});
const paragraph = (nodes: AdfNode[]): AdfNode => ({ type: 'paragraph', ...withContent(nodes) });
/** ADF requires at least one block in a quote, a list item and a cell. */
const nonEmpty = (nodes: AdfNode[]) => (nodes.length ? nodes : [paragraph([])]);

/** Writes a document as ADF, noting what it couldn't write in `losses`. */
export function renderAdf(doc: Doc, losses: Losses): AdfDocument {
  const writer = new AdfWriter(losses);
  const out: AdfNode[] = [];
  doc.blocks.forEach((block, k) => {
    losses.enter(k, doc.at[k] ?? '');
    out.push(...writer.blocks([block], 'doc'));
  });
  return { type: 'doc', version: 1, content: out };
}
