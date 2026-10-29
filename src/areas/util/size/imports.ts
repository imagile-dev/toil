import type { CodeLanguage, Token } from './lexer.js';

/**
 * Imports for `util size`: the modules a TypeScript, JavaScript, Python, C#,
 * Java or Go file names, read from the lexer's tokens, so an import inside a
 * string or a comment never counts. Syntactic only: each specifier is
 * reported exactly as written. Nothing is resolved (no file lookup, no path
 * or package resolution, no tsconfig, no GOPATH), so `./foo` stays `./foo`
 * and a reader who wants the file it names has to go and find it. The
 * dependency graph is, as ever, somebody else's spreadsheet.
 */

export type ImportKind = 'import' | 'require' | 'dynamic' | 'from' | 'using';

export interface ImportEntry {
  /** The module as written: `./foo`, `node:fs`, `java.util.List`, `System.Text`, `..pkg`. */
  specifier: string;
  /** `import` (a statement), `require`, `dynamic` (`import('…')`), `from` (`export … from`, Python's `from … import`), `using` (C#). */
  kind: ImportKind;
  /** The line the specifier is written on. */
  line: number;
  /** What is imported from it, where the syntax says so: `default`, `*`, or each name as the module exports it (not its local alias). */
  names?: string[];
  /** The local name, for `import a as b`, `using B = A;` and Go's `import b "a"`. */
  alias?: string;
  /** `static` and `global`, where the language has them. */
  modifiers?: string[];
}

/** The most imports one file reports; more are counted in `total` and left out. */
export const IMPORTS_MAX = 2000;

/** What each language's import scan covers, for the output's `importsMethod`. */
export const IMPORTS_METHOD: Record<CodeLanguage, string> = {
  typescript:
    'Syntactic scan of the same tokens as the outline: import … from, side-effect imports, export … from, import x = require(), require() and import() with a string literal. Specifiers are as written and nothing is resolved',
  javascript:
    'Syntactic scan of the same tokens as the outline: import … from, side-effect imports, export … from, require() and import() with a string literal. Specifiers are as written and nothing is resolved',
  python: 'Syntactic scan of the same tokens as the outline: import a.b as c (one entry per module) and from … import, relative dots included, in any block. Specifiers are as written and nothing is resolved',
  csharp: 'Syntactic scan of the same tokens as the outline: using namespaces, using static, global using and using aliases, but not using statements. Specifiers are as written and nothing is resolved',
  java: 'Syntactic scan of the same tokens as the outline: import and import static, wildcards included. Specifiers are as written and nothing is resolved',
  go: 'Syntactic scan of the same tokens as the outline: single and grouped import declarations, with aliases, . and _. Specifiers are as written and nothing is resolved',
};

const isP = (t: Token | undefined, v: string) => t !== undefined && t.t === 'p' && t.v === v;
const isId = (t: Token | undefined, v?: string) => t !== undefined && t.t === 'id' && (v === undefined || t.v === v);
/** A string token written with an ordinary quote (templates and regexes are `str` tokens too); `raw` also takes Go's backtick. */
const isQuoted = (t: Token | undefined, raw = false): t is Token => t !== undefined && t.t === 'str' && (t.v[0] === '"' || t.v[0] === "'" || (raw && t.v[0] === '`'));
const unquote = (t: Token) => t.v.slice(1, -1);

class Found {
  readonly list: ImportEntry[] = [];
  total = 0;
  add(e: ImportEntry): void {
    this.total++;
    if (this.list.length >= IMPORTS_MAX) return;
    // An optional field is left out when empty, never null.
    if (e.names?.length === 0) delete e.names;
    this.list.push(e);
  }
}

/** The imports of a lexed file, at most IMPORTS_MAX of them, and how many there were in all. */
export function extractImports(tokens: Token[], lang: CodeLanguage): { imports: ImportEntry[]; total: number } {
  const found = new Found();
  if (lang === 'typescript' || lang === 'javascript') scanJs(tokens, found);
  else if (lang === 'python') scanPython(tokens, found);
  else if (lang === 'java') scanJava(tokens, found);
  else if (lang === 'csharp') scanCsharp(tokens, found);
  else scanGo(tokens, found);
  return { imports: found.list, total: found.total };
}

/** The names in `{ a, b as c, type d }`, from just after the brace: each as the module exports it. Returns them and the index past the closer. */
function braceNames(tokens: Token[], from: number): { names: string[]; end: number } {
  const names: string[] = [];
  let part: Token[] = [];
  const flush = () => {
    let k = 0;
    if (isId(part[0], 'type') && part.length > 1 && !isId(part[1], 'as')) k = 1;
    const t = part[k];
    if (t && (t.t === 'id' || isQuoted(t))) names.push(t.t === 'id' ? t.v : unquote(t));
    part = [];
  };
  let i = from;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isP(t, '}')) {
      flush();
      return { names, end: i + 1 };
    }
    if (isP(t, ',')) flush();
    else part.push(t);
  }
  return { names, end: i };
}

function scanJs(tokens: Token[], found: Found): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.t !== 'id' || isP(tokens[i - 1], '.')) continue;
    if (t.v === 'export') exportFrom(tokens, i, found);
    else if (t.v === 'require' || t.v === 'import') {
      if (isP(tokens[i + 1], '(')) {
        // A call with a string literal only: `require('x')`, `import('x')`. `require(name)` names nothing.
        const spec = tokens[i + 2];
        if (isQuoted(spec) && (isP(tokens[i + 3], ')') || isP(tokens[i + 3], ','))) found.add({ specifier: unquote(spec), kind: t.v === 'require' ? 'require' : 'dynamic', line: spec.line });
      } else if (t.v === 'import') importStatement(tokens, i, found);
    }
  }
}

/** `import 'x'` and `import … from 'x'`. */
function importStatement(tokens: Token[], at: number, found: Found): void {
  const first = tokens[at + 1];
  if (isQuoted(first)) {
    found.add({ specifier: unquote(first), kind: 'import', line: first.line });
    return;
  }
  let i = at + 1;
  if ((isId(tokens[i], 'type') || isId(tokens[i], 'typeof')) && !isId(tokens[i + 1], 'from') && !isP(tokens[i + 1], ',')) i++;
  const names: string[] = [];
  let clause = false;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isId(t, 'from') && clause && isQuoted(tokens[i + 1])) {
      found.add({ specifier: unquote(tokens[i + 1]!), kind: 'import', line: tokens[i + 1]!.line, names });
      return;
    }
    // Not an import clause: `import x = require(…)` (the require rule has it), a stray word, or the end of the statement.
    if (isP(t, ';') || isP(t, '=') || isP(t, '(') || isP(t, ')') || isId(t, 'import') || isId(t, 'export')) return;
    if (isP(t, '{')) {
      const r = braceNames(tokens, i + 1);
      names.push(...r.names);
      clause = true;
      i = r.end - 1;
    } else if (isP(t, '*')) {
      names.push('*');
      clause = true;
      if (isId(tokens[i + 1], 'as')) i += 2;
    } else if (t.t === 'id' && !isId(t, 'as')) {
      names.push('default');
      clause = true;
    }
  }
}

/** `export * from 'x'`, `export * as ns from 'x'`, `export { a, b } from 'x'`, `export type { T } from 'x'`. */
function exportFrom(tokens: Token[], at: number, found: Found): void {
  let i = at + 1;
  if (isId(tokens[i], 'type') && (isP(tokens[i + 1], '{') || isP(tokens[i + 1], '*'))) i++;
  let names: string[];
  if (isP(tokens[i], '*')) {
    names = ['*'];
    i++;
    if (isId(tokens[i], 'as')) i += 2;
  } else if (isP(tokens[i], '{')) {
    const r = braceNames(tokens, i + 1);
    names = r.names;
    i = r.end;
  } else return;
  if (isId(tokens[i], 'from') && isQuoted(tokens[i + 1])) found.add({ specifier: unquote(tokens[i + 1]!), kind: 'from', line: tokens[i + 1]!.line, names });
}

function scanPython(tokens: Token[], found: Found): void {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.t === 'p') {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if ((t.v === ')' || t.v === ']' || t.v === '}') && depth > 0) depth--;
      continue;
    }
    if (t.t !== 'id' || (t.v !== 'import' && t.v !== 'from') || depth > 0) continue;
    // A statement starts a line (not one continued with a backslash) or follows `;` or `:` (`try: import x`).
    const prev = tokens[i - 1];
    if (!(i === 0 || (t.nl && !isP(prev, '\\')) || isP(prev, ';') || isP(prev, ':'))) continue;
    if (t.v === 'import') pythonImport(tokens, i + 1, found);
    else pythonFrom(tokens, i, found);
  }
}

function pythonImport(tokens: Token[], from: number, found: Found): void {
  let i = from;
  for (;;) {
    const first = tokens[i];
    if (first === undefined || !isId(first)) return;
    let spec = first.v;
    i++;
    while (isP(tokens[i], '.') && isId(tokens[i + 1])) {
      spec += `.${tokens[i + 1]!.v}`;
      i += 2;
    }
    const entry: ImportEntry = { specifier: spec, kind: 'import', line: first.line };
    if (isId(tokens[i], 'as') && isId(tokens[i + 1])) {
      entry.alias = tokens[i + 1]!.v;
      i += 2;
    }
    found.add(entry);
    if (!isP(tokens[i], ',')) return;
    i++;
  }
}

/** `from <dots and names> import <names>`, the names possibly in parentheses across lines. `at` is the `from`. */
function pythonFrom(tokens: Token[], at: number, found: Found): void {
  let i = at + 1;
  const line = tokens[at]!.line;
  let spec = '';
  while (i < tokens.length && !isId(tokens[i], 'import')) {
    const t = tokens[i]!;
    if (!(isId(t) || isP(t, '.') || isP(t, '...')) || t.line !== line) return;
    spec += t.v;
    i++;
  }
  if (spec === '') return;
  i++;
  const names: string[] = [];
  const parens = isP(tokens[i], '(');
  if (parens) i++;
  let afterAs = false;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (parens ? isP(t, ')') : (t.nl && !isP(tokens[i - 1], '\\')) || isP(t, ';')) break;
    if (isId(t, 'as')) afterAs = true;
    else if (isId(t) || isP(t, '*')) {
      if (!afterAs) names.push(t.v);
      afterAs = false;
    }
  }
  found.add({ specifier: spec, kind: 'from', line, names });
}

/** The dotted name (ids, `.`, `::`, and `*` for a wildcard) from `from`, as written, with its last segment and the index past it. */
function dotted(tokens: Token[], from: number): { text: string; end: number; last: string } {
  let text = '';
  let last = '';
  let i = from;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!(isId(t) || isP(t, '.') || isP(t, '*') || isP(t, '::'))) break;
    text += t.v;
    if (isId(t) || isP(t, '*')) last = t.v;
  }
  return { text, end: i, last };
}

function scanJava(tokens: Token[], found: Found): void {
  for (let i = 0; i < tokens.length; i++) {
    if (!isId(tokens[i], 'import') || !(i === 0 || isP(tokens[i - 1], ';'))) continue;
    let k = i + 1;
    const modifiers: string[] = [];
    if (isId(tokens[k], 'static')) {
      modifiers.push('static');
      k++;
    }
    const name = dotted(tokens, k);
    if (name.text === '' || !isP(tokens[name.end], ';')) continue;
    found.add({ specifier: name.text, kind: 'import', line: tokens[k]!.line, names: [name.last], ...(modifiers.length ? { modifiers } : {}) });
  }
}

function scanCsharp(tokens: Token[], found: Found): void {
  for (let i = 0; i < tokens.length; i++) {
    if (!isId(tokens[i], 'using')) continue;
    // A directive sits where a declaration could: not after `await`, not inside an expression.
    const global = isId(tokens[i - 1], 'global');
    const before = tokens[global ? i - 2 : i - 1];
    if (!(before === undefined || isP(before, ';') || isP(before, '{') || isP(before, '}') || isP(before, ']'))) continue;
    let k = i + 1;
    const modifiers: string[] = global ? ['global'] : [];
    if (isId(tokens[k], 'static') && isId(tokens[k + 1])) {
      modifiers.push('static');
      k++;
    }
    const mods = modifiers.length ? { modifiers } : {};
    // `using (…)` and `using var x = …;` dispose something; they are statements, not directives.
    if (!isId(tokens[k])) continue;
    if (isP(tokens[k + 1], '=')) {
      // An alias: `using A = B.C<D>;`, its target read to the semicolon.
      let target = '';
      let j = k + 2;
      for (; j < tokens.length && !isP(tokens[j], ';'); j++) target += tokens[j]!.v;
      if (target !== '' && isP(tokens[j], ';')) found.add({ specifier: target, kind: 'using', line: tokens[k + 2]!.line, alias: tokens[k]!.v, ...mods });
      continue;
    }
    const name = dotted(tokens, k);
    if (isP(tokens[name.end], ';')) found.add({ specifier: name.text, kind: 'using', line: tokens[k]!.line, ...mods });
  }
}

function scanGo(tokens: Token[], found: Found): void {
  /** One spec at `i`, an optional alias (a name, `.` or `_`) then the path; returns the index past it, or -1. */
  const spec = (i: number): number => {
    let alias: string | undefined;
    if (isId(tokens[i]) || isP(tokens[i], '.')) {
      alias = tokens[i]!.v;
      i++;
    }
    const path = tokens[i];
    if (!isQuoted(path, true)) return -1;
    found.add({ specifier: unquote(path), kind: 'import', line: path.line, ...(alias === undefined ? {} : { alias }) });
    return i + 1;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isId(t, 'import') || !(i === 0 || t.nl || isP(tokens[i - 1], ';'))) continue;
    if (isP(tokens[i + 1], '(')) {
      let k = i + 2;
      while (k < tokens.length && !isP(tokens[k], ')')) {
        const end = spec(k);
        if (end === -1) break;
        k = end;
        if (isP(tokens[k], ';')) k++;
      }
      i = k;
    } else spec(i + 1);
  }
}
