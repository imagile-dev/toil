/**
 * The document model every `util md` format converts through: Markdown,
 * Jira wiki markup, Atlassian Document Format and Confluence storage format
 * are each read into this tree and written out of it. It holds exactly what
 * CommonMark plus GFM tables and task lists can say, so anything a format
 * has beyond that (a panel, a mention, a merged cell) is either brought down
 * to something here, with a {@link Loss} saying so, or dropped with one.
 * Nothing leaves the building without a signed release form.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'strike'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'break' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** Set on a task list item: `[ ]` or `[x]`. */
  task?: 'todo' | 'done';
  children: Block[];
}

export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'code'; lang?: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  /** `rows[0]` is the header row. */
  | { type: 'table'; align: Align[]; rows: Inline[][][] }
  | { type: 'rule' };

/** A document: its top-level blocks, and where each one started in the text it was read from. */
export interface Doc {
  blocks: Block[];
  /** `line 12` for a text format, a JSON pointer (`/content/3`) for ADF. One per block. */
  at: string[];
}

/** Something that didn't survive a conversion, and where. */
export interface Loss {
  /** What it was: `panel`, `merged cells`, `table alignment`. */
  construct: string;
  at: string;
  detail: string;
}

/**
 * Collects losses as a reader or writer works through a document, each tied
 * to the top-level block it belongs to, so the round-trip check can tell a
 * difference it was warned about from one nobody explained.
 */
export class Losses {
  readonly list: Array<Loss & { block: number }> = [];
  private block = 0;
  private at = '';

  /** Every loss from here on belongs to top-level block `index`, which starts at `at`. */
  enter(index: number, at: string): void {
    this.block = index;
    this.at = at;
  }

  /** Records a loss, once: four tasks in one wiki list are one `task list` loss at the list. */
  add(construct: string, detail: string, at?: string): void {
    const where = at ?? this.at;
    const key = `${construct}\u0000${where}\u0000${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ construct, at: where, detail, block: this.block });
  }

  private readonly seen = new Set<string>();
}

/** The plain words of some inline content, for an image's alt text or a degraded construct. */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.text;
        case 'image':
          return n.alt;
        case 'break':
          return ' ';
        default:
          return plainText(n.children);
      }
    })
    .join('');
}

/** A block's inline content, flattened: what a format that can hold only a line of text keeps of it. */
export function blockInlines(block: Block): Inline[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return block.content;
    case 'code':
      return [{ type: 'code', text: block.text }];
    case 'quote':
      return joinInlines(block.children.map(blockInlines));
    case 'list':
      return joinInlines(block.items.map((item) => joinInlines(item.children.map(blockInlines))));
    case 'table':
      return joinInlines(block.rows.map((row) => joinInlines(row, [{ type: 'text', text: ' | ' }])));
    case 'rule':
      return [];
  }
}

/** Runs of inline content joined by `separator` (a line break by default), skipping empty runs. */
export function joinInlines(runs: Inline[][], separator: Inline[] = [{ type: 'break' }]): Inline[] {
  const out: Inline[] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    if (out.length) out.push(...separator);
    out.push(...run);
  }
  return out;
}


const sameWrapper = (a: Inline, b: Inline) =>
  a.type === b.type && (a.type !== 'link' || (b.type === 'link' && a.href === b.href && a.title === b.title)) && 'children' in a;

/**
 * The canonical form of inline content, which every format's output is
 * compared in: whitespace runs are one space, adjacent text is one node,
 * empty wrappers are gone, a wrapper never directly holds another of its
 * kind, adjacent wrappers of one kind are one wrapper, whitespace sits
 * outside emphasis rather than inside it, and a strong that holds only an
 * emphasis is written emphasis-outside, as CommonMark reads `***x***`.
 */
export function normalizeInlines(nodes: Inline[], inside?: Inline['type']): Inline[] {
  const flat: Inline[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      flat.push({ type: 'text', text: node.text.replace(/[ \t\r\n]+/g, ' ') });
    } else if (node.type === 'code') {
      flat.push({ type: 'code', text: node.text.replace(/\r?\n/g, ' ') });
    } else if (node.type === 'image' || node.type === 'break') {
      flat.push(node);
    } else {
      const children = normalizeInlines(node.children, node.type);
      // A link inside a link, or strong inside strong, says nothing the outer one doesn't.
      if (node.type === inside) flat.push(...children);
      else if (children.length) flat.push({ ...node, children });
    }
  }
  const out: Inline[] = [];
  for (let node of flat) {
    if ((node.type === 'strong' || node.type === 'em' || node.type === 'strike') && node.children.length) {
      // Whitespace at the edge of emphasis moves outside it: `** a**` is not strong in Markdown.
      const first = node.children[0]!;
      const last = node.children.at(-1)!;
      const lead = first.type === 'text' ? /^ +/.exec(first.text)?.[0] ?? '' : '';
      const trail = last.type === 'text' ? / +$/.exec(last.text)?.[0] ?? '' : '';
      if (lead || trail) {
        const children = node.children.slice();
        if (lead) children[0] = { type: 'text', text: (children[0] as { text: string }).text.slice(lead.length) };
        if (trail) {
          const t = children.at(-1) as { text: string };
          children[children.length - 1] = { type: 'text', text: t.text.slice(0, t.text.length - trail.length) };
        }
        if (lead) push(out, { type: 'text', text: lead });
        const inner = normalizeInlines(children, node.type);
        if (inner.length) push(out, { ...node, children: inner });
        if (trail) push(out, { type: 'text', text: trail });
        continue;
      }
      // Emphasis around a whole link is the link around the emphasis: ADF's flat marks can't tell them apart.
      const sole = node.children.length === 1 ? node.children[0] : undefined;
      if (sole?.type === 'link') {
        push(out, { ...sole, children: normalizeInlines([{ type: node.type, children: sole.children }], 'link') });
        continue;
      }
      if (node.type === 'strong' && node.children.length === 1 && node.children[0]!.type === 'em') {
        const em = node.children[0] as { children: Inline[] };
        node = { type: 'em', children: [{ type: 'strong', children: em.children }] };
      }
    }
    push(out, node);
  }
  return out.filter((n) => n.type !== 'text' || n.text !== '');
}

function push(out: Inline[], node: Inline) {
  const prev = out.at(-1);
  if (node.type === 'text' && prev?.type === 'text') {
    out[out.length - 1] = { type: 'text', text: (prev.text + node.text).replace(/ {2,}/g, ' ') };
  } else if (prev && sameWrapper(prev, node)) {
    const merged = { ...prev, children: normalizeInlines([...(prev as { children: Inline[] }).children, ...(node as { children: Inline[] }).children], node.type) } as Inline;
    out[out.length - 1] = merged;
  } else out.push(node);
}

/** Trims a paragraph-like run: no whitespace or line break at either end, and none beside a line break. */
export function trimInlines(nodes: Inline[]): Inline[] {
  const out = nodes.slice();
  const edge = (i: number, side: 'start' | 'end') => {
    const n = out[i];
    if (n?.type !== 'text') return;
    const text = side === 'start' ? n.text.replace(/^ +/, '') : n.text.replace(/ +$/, '');
    if (text === '') out.splice(i, 1);
    else out[i] = { type: 'text', text };
  };
  for (;;) {
    const before = out.length;
    while (out[0]?.type === 'break') out.shift();
    while (out.at(-1)?.type === 'break') out.pop();
    edge(0, 'start');
    if (out.length) edge(out.length - 1, 'end');
    if (out.length === before) break;
  }
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.type !== 'break') continue;
    if (out[i + 1]?.type === 'text') edge(i + 1, 'start');
    if (out[i - 1]?.type === 'text') edge(i - 1, 'end');
  }
  return out;
}

/** The canonical form of a block tree: inline content normalized and trimmed, code without a final line ending. */
export function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.map(normalizeBlock);
}

function normalizeBlock(block: Block): Block {
  const inl = (nodes: Inline[]) => trimInlines(normalizeInlines(nodes));
  switch (block.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inl(block.content) };
    case 'heading':
      return { type: 'heading', level: block.level, content: inl(block.content) };
    case 'code':
      return { type: 'code', ...(block.lang ? { lang: block.lang } : {}), text: block.text.replace(/\r\n?/g, '\n').replace(/\n$/, '') };
    case 'quote':
      return { type: 'quote', children: normalizeBlocks(block.children) };
    case 'list':
      return { ...block, items: block.items.map((item) => ({ ...(item.task ? { task: item.task } : {}), children: normalizeBlocks(item.children) })) };
    case 'table': {
      const width = Math.max(1, ...block.rows.map((r) => r.length));
      const rows = block.rows.map((row) => Array.from({ length: width }, (_, i) => inl(row[i] ?? [])));
      const align = Array.from({ length: width }, (_, i) => block.align[i] ?? null);
      return { type: 'table', align, rows };
    }
    case 'rule':
      return block;
  }
}

/** Removes empty paragraphs, which no format keeps the same way. */
export function dropEmpty(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.type !== 'paragraph' || b.content.length > 0);
}

