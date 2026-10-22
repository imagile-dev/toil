/**
 * A small SQL tokenizer for the pre-flight lint (`./index.ts`), one lexer
 * with a table of what each engine's own lexer does differently. It follows
 * the quoting rules the statement splitters beside each provider already
 * follow (`../postgres/split.ts`, `../mysql/split.ts`, `../oracle/split.ts`,
 * `../sqlserver/script.ts`, `../teradata/split.ts`), and adds what a lint needs and a splitter
 * doesn't: every token with its offset, and where a string, quoted name or
 * comment was opened and never closed.
 *
 * The splitters stay as they are. They decide what a read refuses and what a
 * script may hold, so each has to match its engine's lexer to the character;
 * this one only advises, and the engine still has the last word on anything
 * it lets through. Two lexers for one language: the second copy is for
 * reference only and has been stamped accordingly.
 */

export type Dialect = 'sqlite' | 'postgres' | 'mysql' | 'sqlserver' | 'oracle' | 'teradata';

export type TokenKind =
  /** An unquoted word: a keyword, a name or a function. `upper` holds it upper-cased. */
  | 'word'
  /** A quoted name: "x", `x` or [x]. `quote` says which opened it. */
  | 'ident'
  /** A string literal, its prefix included (E'', N'', q'[]', $$...$$). */
  | 'string'
  | 'number'
  /** A placeholder or variable: ?, $1, :name, @name, @@name. */
  | 'param'
  | 'open'
  | 'close'
  | 'comma'
  | 'semicolon'
  | 'dot'
  /** Any other operator or punctuation, longest match: ||, ::, <=, *, + ... */
  | 'op';

export interface Token {
  kind: TokenKind;
  text: string;
  /** Upper-cased text, for words. */
  upper: string;
  /** Offset of the first character in the SQL. */
  start: number;
  end: number;
  /** For an `ident`, the character that opened it. */
  quote?: '"' | '`' | '[';
}

/** Something opened and never closed, which every engine refuses (SQLite's block comments aside). */
export interface Unterminated {
  what: 'string' | 'quoted name' | 'block comment' | 'dollar-quoted string';
  /** The characters that opened it, as typed (`'`, `"`, `/*`, `$body$`). */
  opener: string;
  /** What closes it. */
  closer: string;
  start: number;
}

export interface Lexed {
  tokens: Token[];
  unterminated?: Unterminated;
}

interface Lexer {
  /** `#` starts a line comment. */
  hashComment: boolean;
  /** `--` needs whitespace (or the end) after it to start a comment, as MySQL requires. */
  dashNeedsSpace: boolean;
  /** Block comments nest. */
  nestedComments: boolean;
  /** An unclosed block comment is an error; SQLite lets one run to the end of the input. */
  unclosedCommentFails: boolean;
  /** `"..."` is a string, not a name: MySQL without ANSI_QUOTES. */
  doubleQuoteString: boolean;
  /** A backslash escapes inside every string (MySQL's default sql_mode). */
  backslashStrings: boolean;
  /** `[...]` is a quoted name (SQL Server, and SQLite for compatibility); elsewhere `[` is punctuation. */
  bracketIdent: boolean;
  /** `$tag$...$tag$` bodies and `$1` placeholders. */
  dollar: boolean;
  /** Oracle's q'[...]' alternative quoting. */
  alternativeQuote: boolean;
}

const LEXERS: Record<Dialect, Lexer> = {
  sqlite: { hashComment: false, dashNeedsSpace: false, nestedComments: false, unclosedCommentFails: false, doubleQuoteString: false, backslashStrings: false, bracketIdent: true, dollar: false, alternativeQuote: false },
  postgres: { hashComment: false, dashNeedsSpace: false, nestedComments: true, unclosedCommentFails: true, doubleQuoteString: false, backslashStrings: false, bracketIdent: false, dollar: true, alternativeQuote: false },
  mysql: { hashComment: true, dashNeedsSpace: true, nestedComments: false, unclosedCommentFails: true, doubleQuoteString: true, backslashStrings: true, bracketIdent: false, dollar: false, alternativeQuote: false },
  sqlserver: { hashComment: false, dashNeedsSpace: false, nestedComments: true, unclosedCommentFails: true, doubleQuoteString: false, backslashStrings: false, bracketIdent: true, dollar: false, alternativeQuote: false },
  oracle: { hashComment: false, dashNeedsSpace: false, nestedComments: false, unclosedCommentFails: true, doubleQuoteString: false, backslashStrings: false, bracketIdent: false, dollar: false, alternativeQuote: true },
  teradata: { hashComment: false, dashNeedsSpace: false, nestedComments: false, unclosedCommentFails: true, doubleQuoteString: false, backslashStrings: false, bracketIdent: false, dollar: false, alternativeQuote: false },
};

const WORD = /[A-Za-z_\u0080-￿][A-Za-z0-9_$#\u0080-￿]*/y;
const NUMBER = /(?:0[xX][0-9A-Fa-f]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
const PARAM = /(?:\?\d*|\$\d+|:[A-Za-z_][A-Za-z0-9_]*|:\d+|@@?[A-Za-z0-9_$#.]*)/y;
const OPERATORS = ['||', '::', '<=', '>=', '<>', '!=', '=>', '->>', '->', '<<', '>>', '**'].sort((a, b) => b.length - a.length);
/** Prefixes run straight into a quote that make one string token with it. */
const STRING_PREFIX: Record<Dialect, RegExp> = {
  sqlite: /^[xX]$/,
  postgres: /^(?:[eEbBxXnN]|[uU]&)$/,
  mysql: /^(?:[nNbBxX]|_[A-Za-z0-9]+)$/,
  sqlserver: /^[nN]$/,
  oracle: /^(?:[nN]|[nN]?[qQ])$/,
  // _UNICODE'...', _LATIN'...', and U&'...'.
  teradata: /^(?:_[A-Za-z0-9]+|[uU]&)$/,
};

export interface TokenizeOptions {
  /** Override whether a backslash escapes inside a string: MySQL's NO_BACKSLASH_ESCAPES turns it off. */
  backslashStrings?: boolean;
}

export function tokenize(sql: string, dialect: Dialect, options: TokenizeOptions = {}): Lexed {
  const lex = { ...LEXERS[dialect], ...(options.backslashStrings !== undefined ? { backslashStrings: options.backslashStrings } : {}) };
  const tokens: Token[] = [];
  const n = sql.length;
  const push = (kind: TokenKind, start: number, end: number, quote?: Token['quote']) => {
    const text = sql.slice(start, end);
    tokens.push({ kind, text, upper: kind === 'word' ? text.toUpperCase() : text, start, end, ...(quote ? { quote } : {}) });
  };
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((c === '-' && next === '-' && (!lex.dashNeedsSpace || i + 2 >= n || sql.charCodeAt(i + 2) <= 32)) || (c === '#' && lex.hashComment)) {
      const end = sql.slice(i).search(/[\n\r]/);
      i = end === -1 ? n : i + end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = skipBlockComment(sql, i, lex.nestedComments);
      if (end === -1) {
        if (lex.unclosedCommentFails) return { tokens, unterminated: { what: 'block comment', opener: '/*', closer: '*/', start: i } };
        i = n;
        continue;
      }
      i = end;
      continue;
    }
    if (c === "'" || (c === '"' && lex.doubleQuoteString)) {
      const end = skipQuoted(sql, i, c, lex.backslashStrings);
      if (end === -1) return { tokens, unterminated: { what: 'string', opener: c, closer: c, start: i } };
      push('string', i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === '`' || (c === '[' && lex.bracketIdent)) {
      const close = c === '[' ? ']' : c;
      const end = skipQuoted(sql, i, close, false);
      if (end === -1) return { tokens, unterminated: { what: 'quoted name', opener: c, closer: close, start: i } };
      push('ident', i, end, c);
      i = end;
      continue;
    }
    if (c === '$' && lex.dollar) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql)?.[0];
      if (tag && !(i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1]!))) {
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) return { tokens, unterminated: { what: 'dollar-quoted string', opener: tag, closer: tag, start: i } };
        push('string', i, close + tag.length);
        i = close + tag.length;
        continue;
      }
    }
    WORD.lastIndex = i;
    const word = WORD.exec(sql)?.[0];
    if (word) {
      const after = i + word.length;
      // A prefix run straight into a quote is part of the string: E'..', N'..', q'[..]'.
      if (sql[after] === "'" && STRING_PREFIX[dialect].test(word)) {
        const alternative = lex.alternativeQuote && /[qQ]$/.test(word);
        const end = alternative ? skipAlternativeQuote(sql, after) : skipQuoted(sql, after, "'", lex.backslashStrings || /^[eE]$/.test(word));
        if (end === -1) return { tokens, unterminated: { what: 'string', opener: sql.slice(i, alternative ? after + 2 : after + 1), closer: alternative ? closerOf(sql[after + 1]) + "'" : "'", start: i } };
        push('string', i, end);
        i = end;
        continue;
      }
      // PostgreSQL's U&"name".
      if (dialect === 'postgres' && /^[uU]&?$/.test(word) && sql[after] === '&' && sql[after + 1] === '"') {
        const end = skipQuoted(sql, after + 1, '"', false);
        if (end === -1) return { tokens, unterminated: { what: 'quoted name', opener: 'U&"', closer: '"', start: i } };
        push('ident', i, end, '"');
        i = end;
        continue;
      }
      push('word', i, after);
      i = after;
      continue;
    }
    NUMBER.lastIndex = i;
    const number = /[0-9.]/.test(c) ? NUMBER.exec(sql)?.[0] : undefined;
    if (number) {
      push('number', i, i + number.length);
      i += number.length;
      continue;
    }
    if (c === '?' || c === '$' || c === '@' || (c === ':' && next !== ':' && next !== '=')) {
      PARAM.lastIndex = i;
      const param = PARAM.exec(sql)?.[0];
      if (param && param.length > (c === '?' ? 0 : 1)) {
        push('param', i, i + param.length);
        i += param.length;
        continue;
      }
    }
    const single: Partial<Record<string, TokenKind>> = { '(': 'open', ')': 'close', ',': 'comma', ';': 'semicolon', '.': 'dot' };
    const kind = single[c];
    if (kind) {
      push(kind, i, i + 1);
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => sql.startsWith(o, i)) ?? c;
    push('op', i, i + op.length);
    i += op.length;
  }
  return { tokens };
}

/** Past the closing quote; a doubled quote is part of the text. -1 when it never closes. */
function skipQuoted(sql: string, open: number, quote: string, backslashEscapes: boolean): number {
  let i = open + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (backslashEscapes && c === '\\') i += 2;
    else if (c === quote) {
      if (sql[i + 1] === quote) i += 2;
      else return i + 1;
    } else i++;
  }
  return -1;
}

/** Past the closing `*\/`, counting nested openers where the engine does. -1 when it never closes. */
function skipBlockComment(sql: string, open: number, nested: boolean): number {
  let depth = 1;
  let i = open + 2;
  while (i < sql.length) {
    if (nested && sql[i] === '/' && sql[i + 1] === '*') {
      depth++;
      i += 2;
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return -1;
}

const CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
const closerOf = (open: string | undefined) => (open === undefined ? '' : (CLOSERS[open] ?? open));

/** Oracle's `q'X...X'` from the quote; an opening bracket closes with its pair. -1 when it never closes. */
function skipAlternativeQuote(sql: string, quote: number): number {
  const open = sql[quote + 1];
  if (open === undefined) return -1;
  const close = closerOf(open) + "'";
  const end = sql.indexOf(close, quote + 2);
  return end === -1 ? -1 : end + close.length;
}

/** 1-based line and column of an offset, counting \r\n, \n and \r as one line end each. */
export function positionOf(sql: string, offset: number): { offset: number; line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < sql.length; i++) {
    const c = sql[i];
    if (c === '\n' || (c === '\r' && sql[i + 1] !== '\n')) {
      line++;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}
