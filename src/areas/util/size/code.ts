import { lex, OutlineError, type CodeLanguage, type Token } from './lexer.js';

/**
 * Code outlines for `util size`: the functions, classes, types and exported
 * names in a TypeScript, JavaScript, Python, C#, Java or Go file, each with
 * the lines it spans. Pure JavaScript and syntactic only: the lexer skips
 * comments and strings, braces are matched (indentation for Python), and
 * each declaration is recognised by its keywords and shape. Nothing is type
 * checked or resolved, so the result is an outline, not a symbol table.
 *
 * Function bodies are skipped, not searched: what's declared inside a
 * function isn't listed. Class-like bodies (classes, interfaces, structs,
 * records, namespaces) are read for their methods, constructors, properties
 * and nested types; fields are left out. Every symbol's start line is the
 * line its name is on, which is what the command's self-check re-reads. An
 * outline is to code what an org chart is to a company: accurate about the
 * boxes, silent about what happens inside them.
 */

export type SymbolKind = 'function' | 'method' | 'constructor' | 'property' | 'class' | 'interface' | 'struct' | 'record' | 'enum' | 'type' | 'namespace' | 'variable';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  /** The enclosing class, namespace or type, dotted when nested; null at the top level. */
  container: string | null;
  /** Index of the enclosing symbol in the list, for the nesting check. Not part of the output. */
  parent?: number;
}

/** What each language's outline covers, for the output's `method`. */
export const CODE_METHOD: Record<CodeLanguage, string> = {
  typescript:
    'Syntactic scan in pure JavaScript, not the TypeScript compiler: functions, classes, interfaces, type aliases, enums and namespaces, exported variables and function-valued constants, and class and interface methods. Function bodies are not searched, and JSX text containing quotes may not be read',
  javascript:
    'Syntactic scan in pure JavaScript, not a parser: functions, classes, exported variables and function-valued constants, and class methods. Function bodies are not searched, CommonJS exports (module.exports) are not listed, and JSX text containing quotes may not be read',
  python: 'Syntactic scan in pure JavaScript, by indentation: classes, functions and methods (async included), with nested classes. Functions defined inside functions are not listed',
  csharp:
    'Syntactic scan in pure JavaScript, not Roslyn: namespaces, classes, structs, records, interfaces, enums, delegates, methods, constructors and properties. Fields, events and operators are not listed, and #if branches are read as written',
  java: 'Syntactic scan in pure JavaScript, not javac: classes, interfaces, enums, records, annotation types, methods and constructors. Fields and the members of enum bodies are not listed',
  go: 'Syntactic scan in pure JavaScript, not go/parser: functions, methods (with their receiver type as the container) and type declarations. Grouped type ( … ) blocks, var and const are not listed',
};

interface Item {
  tok: Token;
  /** For an opener: the index just past its closer. */
  end?: number;
  /** For an opener: its closing token. */
  close?: Token;
}

type Context = 'top' | 'namespace' | 'class' | 'interface' | 'enum';

interface Decl {
  name: string;
  nameTok: Token;
  kind: SymbolKind;
  /** The context its body opens, when its members are outlined. */
  body?: Context;
}

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** The outline of a code file. Throws OutlineError when its brackets don't balance or the lexer can't read it. */
export function outlineCode(text: string, lang: CodeLanguage, tokens: Token[] = lex(text, lang)): CodeSymbol[] {
  return lang === 'python' ? outlinePython(tokens) : outlineBraces(tokens, lang);
}

/** The index just past the bracket that closes the one at `i`. */
function skipGroup(tokens: Token[], i: number): number {
  const stack: Token[] = [];
  for (let j = i; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.t !== 'p') continue;
    if (OPEN[t.v]) stack.push(t);
    else if (CLOSE[t.v]) {
      const open = stack.pop();
      if (!open || open.v !== CLOSE[t.v]) throw new OutlineError(`a ${t.v} on line ${t.line} closes ${open ? `a ${open.v} from line ${open.line}` : 'nothing'}`);
      if (stack.length === 0) return j + 1;
    }
  }
  const open = stack[stack.length - 1] ?? tokens[i]!;
  throw new OutlineError(`a ${open.v} opened on line ${open.line} is never closed`);
}

const isP = (t: Token | undefined, v: string) => t !== undefined && t.t === 'p' && t.v === v;
const isId = (t: Token | undefined, v?: string) => t !== undefined && t.t === 'id' && (v === undefined || t.v === v);

/** Tokens that, ending a line, let Go and JavaScript end a statement there. */
const ENDS_LINE = (t: Token) => t.t === 'id' || t.t === 'num' || t.t === 'str' || (t.t === 'p' && (t.v === ')' || t.v === ']' || t.v === '}' || t.v === '++' || t.v === '--'));
/** Words that continue a JavaScript statement on the next line rather than start one. */
const JS_CONTINUES = new Set(['extends', 'implements', 'instanceof', 'in', 'of', 'as', 'satisfies', 'keyof', 'is']);

const JS_MODIFIERS = new Set(['export', 'default', 'declare', 'abstract', 'async', 'public', 'private', 'protected', 'static', 'readonly', 'override', 'accessor', 'get', 'set']);
const JAVA_MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'native', 'synchronized', 'transient', 'volatile', 'strictfp', 'default', 'sealed']);
const CS_MODIFIERS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'sealed', 'abstract', 'virtual', 'override', 'async', 'extern', 'unsafe', 'new', 'partial', 'volatile', 'required', 'file', 'ref', 'scoped']);
const NOT_A_NAME = new Set(['if', 'for', 'foreach', 'while', 'switch', 'using', 'lock', 'catch', 'fixed', 'return', 'new', 'else', 'do', 'try', 'throw', 'synchronized', 'this', 'base', 'super', 'typeof', 'sizeof', 'nameof', 'default', 'when', 'await']);

/** Leading decorators (`@x`, `@x.y(...)`) and C# attributes (`[...]`), skipped. */
function stripDecorations(items: Item[], lang: CodeLanguage): number {
  let k = 0;
  for (;;) {
    const t = items[k]?.tok;
    if (lang === 'csharp' && isP(t, '[')) {
      k++;
      continue;
    }
    if (lang !== 'csharp' && isP(t, '@') && isId(items[k + 1]?.tok) && !isId(items[k + 1]?.tok, 'interface')) {
      k += 2;
      while (isP(items[k]?.tok, '.') && isId(items[k + 1]?.tok)) k += 2;
      if (isP(items[k]?.tok, '(')) k++;
      continue;
    }
    return k;
  }
}

/** Whether `t` can follow a modifier keyword, which tells `get name()` from a method called `get`. */
const followsModifier = (t: Token | undefined) => t !== undefined && (t.t === 'id' || isP(t, '*') || isP(t, '#') || isP(t, '['));

function nameAt(items: Item[], k: number): Token | undefined {
  const t = items[k]?.tok;
  if (isP(t, '#') && isId(items[k + 1]?.tok)) return items[k + 1]!.tok;
  return t && (t.t === 'id' || t.t === 'str') ? t : undefined;
}

/** Whether the value after `=` is a function: `function`, `async function`, or an arrow. */
function functionValued(items: Item[], from: number): boolean {
  let k = from;
  if (isId(items[k]?.tok, 'async')) k++;
  if (isId(items[k]?.tok, 'function')) return true;
  if (isP(items[k]?.tok, '<')) {
    while (k < items.length && !isP(items[k]?.tok, '>')) k++;
    k++;
  }
  const t = items[k]?.tok;
  if (isId(t) && isP(items[k + 1]?.tok, '=>')) return true;
  if (!isP(t, '(')) return false;
  for (let j = k + 1; j < items.length; j++) {
    if (isP(items[j]!.tok, '=>')) return true;
    if (isP(items[j]!.tok, '=') || isP(items[j]!.tok, ';')) return false;
  }
  return false;
}

function classifyJs(items: Item[], assign: number, form: Form, ctx: Context): Decl | null {
  let k = stripDecorations(items, 'javascript');
  let exported = false;
  while (isId(items[k]?.tok) && JS_MODIFIERS.has(items[k]!.tok.v) && followsModifier(items[k + 1]?.tok)) {
    if (items[k]!.tok.v === 'export') exported = true;
    k++;
  }
  const head = items[k]?.tok;
  if (!head) return null;
  const word = head.t === 'id' ? head.v : '';
  if (ctx === 'top' || ctx === 'namespace') {
    if (word === 'function') {
      let n = k + 1;
      if (isP(items[n]?.tok, '*')) n++;
      const name = nameAt(items, n);
      if (name && name.t === 'id') return { name: name.v, nameTok: name, kind: 'function' };
      return exported ? { name: 'default', nameTok: head, kind: 'function' } : null;
    }
    if (word === 'class' || word === 'interface' || word === 'enum' || (word === 'const' && isId(items[k + 1]?.tok, 'enum'))) {
      const at = word === 'const' ? k + 2 : k + 1;
      const kind = word === 'class' ? 'class' : word === 'interface' ? 'interface' : 'enum';
      const name = nameAt(items, at);
      const body: Context | undefined = kind === 'enum' ? 'enum' : kind;
      if (name && name.t === 'id' && !isId(name, 'extends') && !isId(name, 'implements')) return { name: name.v, nameTok: name, kind, ...(form === 'body' ? { body } : {}) };
      return kind === 'class' && exported ? { name: 'default', nameTok: head, kind, ...(form === 'body' ? { body } : {}) } : null;
    }
    if (word === 'type' && isId(items[k + 1]?.tok) && (isP(items[k + 2]?.tok, '=') || isP(items[k + 2]?.tok, '<'))) {
      return { name: items[k + 1]!.tok.v, nameTok: items[k + 1]!.tok, kind: 'type' };
    }
    if ((word === 'namespace' || word === 'module') && isId(items[k + 1]?.tok)) {
      let name = items[k + 1]!.tok.v;
      let n = k + 2;
      while (isP(items[n]?.tok, '.') && isId(items[n + 1]?.tok)) {
        name += `.${items[n + 1]!.tok.v}`;
        n += 2;
      }
      return { name, nameTok: items[k + 1]!.tok, kind: 'namespace', ...(form === 'body' ? { body: 'namespace' as Context } : {}) };
    }
    if ((word === 'const' || word === 'let' || word === 'var') && isId(items[k + 1]?.tok)) {
      const name = items[k + 1]!.tok;
      const fn = assign >= 0 && functionValued(items, assign + 1);
      if (fn) return { name: name.v, nameTok: name, kind: 'function' };
      return exported ? { name: name.v, nameTok: name, kind: 'variable' } : null;
    }
    return null;
  }
  if (ctx === 'class' || ctx === 'interface') {
    if (isP(items[k]?.tok, '*')) k++;
    const name = nameAt(items, k);
    if (!name) return null;
    const n = isP(items[k]?.tok, '#') ? k + 2 : k + 1;
    let next = items[n]?.tok;
    let m = n;
    if (isP(next, '?') || isP(next, '!')) next = items[++m]?.tok;
    if (isP(next, '(') || isP(next, '<')) {
      if (ctx === 'class' && name.v === 'constructor') return { name: 'constructor', nameTok: name, kind: 'constructor' };
      return { name: name.t === 'str' ? name.v.slice(1, -1) : name.v, nameTok: name, kind: 'method' };
    }
    if (ctx === 'class' && assign === m && functionValued(items, assign + 1)) return { name: name.v, nameTok: name, kind: 'method' };
  }
  return null;
}

function classifyJava(items: Item[], form: Form, ctx: Context, container: string | null): Decl | null {
  let k = stripDecorations(items, 'java');
  while (isId(items[k]?.tok) && JAVA_MODIFIERS.has(items[k]!.tok.v)) k++;
  // `non-sealed` lexes as three tokens.
  if (isId(items[k]?.tok, 'non') && isP(items[k + 1]?.tok, '-') && isId(items[k + 2]?.tok, 'sealed')) k += 3;
  const head = items[k]?.tok;
  if (!head) return null;
  const annotationType = isP(head, '@') && isId(items[k + 1]?.tok, 'interface');
  if (annotationType || (head.t === 'id' && ['class', 'interface', 'enum', 'record'].includes(head.v))) {
    const at = annotationType ? k + 2 : k + 1;
    const name = items[at]?.tok;
    if (!isId(name)) return null;
    const kind: SymbolKind = annotationType || head.v === 'interface' ? 'interface' : head.v === 'enum' ? 'enum' : head.v === 'record' ? 'record' : 'class';
    const body: Context = kind === 'interface' ? 'interface' : kind === 'enum' ? 'enum' : 'class';
    return { name: name!.v, nameTok: name!, kind, ...(form === 'body' ? { body } : {}) };
  }
  if (ctx !== 'class' && ctx !== 'interface') return null;
  return methodShape(items, k, container);
}

/** `Type Name(` or `Name(` (a constructor when Name is the container's): the identifier before the first parenthesis. */
function methodShape(items: Item[], k: number, container: string | null): Decl | null {
  for (let p = k + 1; p < items.length; p++) {
    if (!isP(items[p]!.tok, '(')) continue;
    // Name<T>( : step back over the type parameters.
    let n = p - 1;
    if (isP(items[n]?.tok, '>')) {
      let depth = 0;
      for (; n > k; n--) {
        if (isP(items[n]!.tok, '>')) depth++;
        else if (isP(items[n]!.tok, '<') && --depth === 0) break;
      }
      n--;
    }
    const name = items[n]?.tok;
    if (!isId(name) || NOT_A_NAME.has(name!.v)) return null;
    if (isP(items[n - 1]?.tok, '~')) return { name: `~${name!.v}`, nameTok: name!, kind: 'method' };
    const ctor = n === k && name!.v === lastPart(container);
    return { name: name!.v, nameTok: name!, kind: ctor ? 'constructor' : 'method' };
  }
  return null;
}

const lastPart = (container: string | null) => (container === null ? null : container.slice(container.lastIndexOf('.') + 1));

function classifyCs(items: Item[], assignTok: string | null, form: Form, ctx: Context, container: string | null): Decl | null {
  let k = stripDecorations(items, 'csharp');
  while (isId(items[k]?.tok) && CS_MODIFIERS.has(items[k]!.tok.v)) k++;
  // `const` fields are fields.
  const head = items[k]?.tok;
  if (!head || head.t !== 'id') return null;
  if (head.v === 'namespace' && isId(items[k + 1]?.tok)) {
    let name = items[k + 1]!.tok.v;
    let n = k + 2;
    while (isP(items[n]?.tok, '.') && isId(items[n + 1]?.tok)) {
      name += `.${items[n + 1]!.tok.v}`;
      n += 2;
    }
    return { name, nameTok: items[k + 1]!.tok, kind: 'namespace', ...(form === 'body' ? { body: 'namespace' as Context } : {}) };
  }
  if (['class', 'struct', 'interface', 'enum', 'record'].includes(head.v)) {
    let at = k + 1;
    let kind: SymbolKind = head.v as SymbolKind;
    if (head.v === 'record') {
      if (isId(items[at]?.tok, 'struct')) kind = 'struct';
      if (isId(items[at]?.tok, 'class') || isId(items[at]?.tok, 'struct')) at++;
    }
    const name = items[at]?.tok;
    if (!isId(name)) return null;
    const body: Context = kind === 'interface' ? 'interface' : kind === 'enum' ? 'enum' : 'class';
    return { name: name!.v, nameTok: name!, kind, ...(form === 'body' ? { body } : {}) };
  }
  if (head.v === 'delegate') {
    const decl = methodShape(items, k, null);
    return decl ? { ...decl, kind: 'type' } : null;
  }
  if (ctx !== 'class' && ctx !== 'interface') return null;
  if (items.slice(k).some((it) => isId(it.tok, 'operator') || isId(it.tok, 'event') || isId(it.tok, 'const'))) return null;
  const method = methodShape(items, k, container);
  if (method) return method;
  // A property: `Type Name { get; set; }` or `Type Name => value;`. `this[...]` is an indexer, left out.
  if (form === 'body' || assignTok === '=>') {
    const last = items[items.length - 1]?.tok;
    if (isId(last) && !isId(last, 'this') && items.length - k >= 2) return { name: last!.v, nameTok: last!, kind: 'property' };
  }
  return null;
}

function classifyGo(items: Item[], ctx: Context): Decl | null {
  if (ctx !== 'top') return null;
  const head = items[0]?.tok;
  if (isId(head, 'func')) {
    if (isId(items[1]?.tok)) return { name: items[1]!.tok.v, nameTok: items[1]!.tok, kind: 'function' };
    if (isP(items[1]?.tok, '(') && isId(items[2]?.tok)) return { name: items[2]!.tok.v, nameTok: items[2]!.tok, kind: 'method' };
    return null;
  }
  if (isId(head, 'type') && isId(items[1]?.tok)) {
    let n = 2;
    if (isP(items[n]?.tok, '[')) n++;
    const kind: SymbolKind = isId(items[n]?.tok, 'struct') ? 'struct' : isId(items[n]?.tok, 'interface') ? 'interface' : 'type';
    return { name: items[1]!.tok.v, nameTok: items[1]!.tok, kind };
  }
  return null;
}

/** The receiver type of a Go method: the last name in `(r *T)` or `(r *T[K])`, outside the brackets. */
function goReceiver(tokens: Token[], open: Item): string | null {
  let depth = 0;
  let last: string | null = null;
  const start = tokens.indexOf(open.tok);
  for (let j = start + 1; j < (open.end ?? start) - 1; j++) {
    const t = tokens[j]!;
    if (isP(t, '[')) depth++;
    else if (isP(t, ']')) depth--;
    else if (depth === 0 && t.t === 'id') last = t.v;
  }
  return last;
}

/** How a statement ended: at a body brace, after `=`/`=>`, or plainly (`;`, a line break, the end of its block). */
type Form = 'body' | 'plain';

function outlineBraces(tokens: Token[], lang: CodeLanguage): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const n = tokens.length;
  let i = 0;
  const asi = lang === 'typescript' || lang === 'javascript' || lang === 'go';

  const onlyDecorators = (items: Item[]) => items.length > 0 && stripDecorations(items, lang) >= items.length;

  /** Statements up to the `}` that closes this block (left unread), or to the end of the file for the top level and a file-scoped namespace. */
  function body(ctx: Context, container: string | null, parent: number | undefined, toEnd = false): void {
    while (i < n) {
      const t = tokens[i]!;
      if (isP(t, '}')) {
        if (toEnd) throw new OutlineError(`a } on line ${t.line} closes nothing`);
        return;
      }
      if (isP(t, ';') || isP(t, ',')) {
        i++;
        continue;
      }
      statement(ctx, container, parent);
    }
    if (!toEnd) throw new OutlineError(`a block for ${container ?? 'a declaration'} is never closed`);
  }

  function statement(ctx: Context, container: string | null, parent: number | undefined): void {
    const items: Item[] = [];
    let assign = -1;
    let assignTok: string | null = null;
    let angle = 0;
    let bodyOpen = -1;
    let last: Token | undefined;
    while (i < n) {
      const t = tokens[i]!;
      if (items.length > 0 && t.nl && asi && last && ENDS_LINE(last) && !onlyDecorators(items)) {
        if (lang === 'go' || ((t.t === 'id' || t.t === 'str' || t.t === 'num' || isP(t, '@') || isP(t, '#')) && !JS_CONTINUES.has(t.v) && !JS_CONTINUES.has(last.v))) break;
      }
      if (t.t === 'p' && (t.v === ';' || (t.v === ',' && angle === 0 && ctx === 'interface' && lang === 'typescript'))) {
        last = t;
        i++;
        break;
      }
      if (t.t === 'p' && (t.v === '}' || t.v === ')' || t.v === ']')) {
        if (t.v === '}') break;
        throw new OutlineError(`a ${t.v} on line ${t.line} closes nothing`);
      }
      if (t.t === 'p' && (t.v === '(' || t.v === '[')) {
        const end = skipGroup(tokens, i);
        items.push({ tok: t, end, close: tokens[end - 1]! });
        last = tokens[end - 1]!;
        i = end;
        continue;
      }
      if (t.t === 'p' && t.v === '{') {
        const prev = items[items.length - 1]?.tok;
        const typeBrace =
          assign >= 0 || angle > 0 || (prev !== undefined && prev.t === 'p' && [':', '|', '&', ',', '<', '=>', '->', '?'].includes(prev.v)) || (lang === 'typescript' && isId(prev, 'extends'));
        if (!typeBrace) {
          bodyOpen = i;
          break;
        }
        const end = skipGroup(tokens, i);
        items.push({ tok: t, end, close: tokens[end - 1]! });
        last = tokens[end - 1]!;
        i = end;
        continue;
      }
      if (assign < 0 && angle === 0 && t.t === 'p' && (t.v === '=' || t.v === '=>' || t.v === ':=')) {
        assign = items.length;
        assignTok = t.v;
      }
      if (assign < 0 && lang !== 'go' && t.t === 'p') {
        if (t.v === '<') angle++;
        else if (t.v === '>' && angle > 0) angle--;
      }
      items.push({ tok: t });
      last = t;
      i++;
    }
    const before = assign >= 0 ? items.slice(0, assign) : items;
    const form: Form = bodyOpen >= 0 ? 'body' : 'plain';
    const decl: Decl | null =
      lang === 'typescript' || lang === 'javascript'
        ? classifyJs(items, assign, form, ctx)
        : lang === 'java'
          ? classifyJava(before, form, ctx, container)
          : lang === 'csharp'
            ? classifyCs(before, assignTok, form, ctx, container)
            : classifyGo(before, ctx);
    const index = decl ? out.length : undefined;
    if (decl) {
      let symbolContainer = container;
      if (lang === 'go' && decl.kind === 'method') symbolContainer = goReceiver(tokens, before[1]!);
      out.push({ name: decl.name, kind: decl.kind, startLine: decl.nameTok.line, endLine: decl.nameTok.line, container: symbolContainer, ...(parent === undefined ? {} : { parent }) });
    }
    let end = last;
    if (bodyOpen >= 0) {
      if (decl?.body && decl.body !== 'enum') {
        i = bodyOpen + 1;
        const inner = container === null ? decl.name : `${container}.${decl.name}`;
        body(decl.body, inner, index);
        end = tokens[i]!;
        i++;
      } else {
        i = skipGroup(tokens, bodyOpen);
        end = tokens[i - 1]!;
      }
      // A C# property's initializer (`{ get; set; } = value;`) belongs to it.
      if (lang === 'csharp' && decl?.kind === 'property' && isP(tokens[i], '=')) {
        while (i < n && !isP(tokens[i], ';')) i = OPEN[tokens[i]!.v] && tokens[i]!.t === 'p' ? skipGroup(tokens, i) : i + 1;
        end = tokens[i] ?? end;
        if (i < n) i++;
      }
    }
    if (decl && index !== undefined && end) out[index]!.endLine = Math.max(end.endLine, out[index]!.startLine);
    // A C# file-scoped namespace (`namespace A.B;`) holds the rest of the file.
    if (lang === 'csharp' && decl?.kind === 'namespace' && bodyOpen < 0 && index !== undefined) {
      out[index]!.endLine = tokens[n - 1]!.endLine;
      body('namespace', decl.name, index, true);
    }
  }

  body('top', null, undefined, true);
  return out;
}

/**
 * Python, by indentation. A logical line starts with a token at bracket
 * depth 0; a `def` or `class` there opens a symbol that runs until the next
 * logical line indented no deeper. Classes are read for their methods and
 * nested classes; functions are not searched.
 */
function outlinePython(tokens: Token[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  // Logical lines: their first token, indentation, and the last line any of their tokens reach.
  const logical: { first: number; indent: number; lastLine: number }[] = [];
  let depth = 0;
  const stack: Token[] = [];
  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j]!;
    // A line continued with a backslash leaves no token behind; a token on a new line at depth 0 starts a logical line.
    if (depth === 0 && t.nl && !continued(tokens, j)) logical.push({ first: j, indent: t.col, lastLine: t.endLine });
    else if (logical.length) logical[logical.length - 1]!.lastLine = Math.max(logical[logical.length - 1]!.lastLine, t.endLine);
    if (t.t === 'p' && OPEN[t.v]) {
      stack.push(t);
      depth++;
    } else if (t.t === 'p' && CLOSE[t.v]) {
      const open = stack.pop();
      if (!open || open.v !== CLOSE[t.v]) throw new OutlineError(`a ${t.v} on line ${t.line} closes ${open ? `a ${open.v} from line ${open.line}` : 'nothing'}`);
      depth--;
    }
  }
  if (stack.length) throw new OutlineError(`a ${stack[stack.length - 1]!.v} opened on line ${stack[stack.length - 1]!.line} is never closed`);

  // Open symbols, innermost last: each with its indentation and whether its body is searched.
  const open: { index: number | undefined; indent: number; searched: boolean; name: string }[] = [];
  const close = (indent: number, lastLine: number) => {
    while (open.length && open[open.length - 1]!.indent >= indent) {
      const top = open.pop()!;
      if (top.index !== undefined) out[top.index]!.endLine = lastLine;
    }
  };
  let previousEnd = 0;
  for (const line of logical) {
    close(line.indent, previousEnd);
    const t = tokens[line.first]!;
    let k = line.first;
    if (isId(t, 'async')) k++;
    const word = tokens[k];
    const name = tokens[k + 1];
    const enclosing = open[open.length - 1];
    const searched = !enclosing || enclosing.searched;
    if ((isId(word, 'def') || isId(word, 'class')) && isId(name)) {
      let index: number | undefined;
      if (searched) {
        const container = open.filter((o) => o.index !== undefined).map((o) => o.name);
        const kind: SymbolKind = word!.v === 'class' ? 'class' : enclosing && enclosing.index !== undefined && out[enclosing.index]!.kind === 'class' ? 'method' : 'function';
        index = out.length;
        out.push({ name: name!.v, kind, startLine: name!.line, endLine: line.lastLine, container: container.length ? container.join('.') : null, ...(enclosing?.index === undefined ? {} : { parent: enclosing.index }) });
      }
      open.push({ index, indent: line.indent, searched: searched && word!.v === 'class', name: name!.v });
    }
    previousEnd = line.lastLine;
  }
  close(-1, previousEnd);
  return out;
}

/** Whether the line before token `j` ended with a backslash continuation (no token sits between). */
function continued(tokens: Token[], j: number): boolean {
  const prev = tokens[j - 1];
  return prev !== undefined && isP(prev, '\\');
}
