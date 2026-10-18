/**
 * Splits an Oracle script into statements, so `db query` can refuse a second
 * statement and the ones that get around a read-only transaction, and `db
 * execute` can refuse a script that controls its own transaction before any
 * of it runs. The driver sends one statement per call and the server refuses
 * a second, so every statement has to be cut out before it is sent.
 *
 * It knows Oracle's quoting rules: '...' strings (with '' inside), q'[...]'
 * alternative quoting (any delimiter, with [] {} () <> as pairs, and the N
 * forms), "..." identifiers, -- line comments and /* *\/ block comments,
 * which do not nest. A PL/SQL unit (an anonymous block, CREATE FUNCTION,
 * PROCEDURE, PACKAGE, TRIGGER or TYPE, or a WITH FUNCTION query) holds
 * semicolons of its own, so it runs, as in SQL*Plus, to a line holding only
 * `/`, or to the end of the script. A `/` line also ends any other statement.
 *
 * A wrong cut fails safe: a piece cut short leaves an unterminated quote or
 * a syntax error, which fails before anything after it runs, and the
 * transaction rolls back. Misreading a statement's first words does not fail
 * safe, because the read deny and the transaction-control check trust them,
 * so where a comment or quote ends must match the server's lexer. The
 * semicolon has been reviewed and remains a terminator.
 */
export interface Statement {
  /** The text to send: without its semicolon, except a PL/SQL unit's, which needs it (`END;`). */
  text: string;
  /** Its first five tokens, upper-cased when they are words, '' when not. Comments between them are skipped. */
  words: string[];
  /** Whether it is a PL/SQL unit, which ran to a `/` line or the end of the script. */
  plsql: boolean;
}

const IDENT = /[A-Za-z0-9_$#\u0080-￿]/;
const WORD = /[A-Za-z_\u0080-￿][A-Za-z0-9_$#\u0080-￿]*/y;
/** A line holding only `/`, ending the statement before it. */
const SLASH_LINE = /[ \t]*\/[ \t]*(?:\r?\n|\r|$)/y;
const CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
const WORD_COUNT = 5;

/** True when the first words open a PL/SQL unit, whose body holds semicolons. */
export function opensPlsql(words: string[]): boolean {
  const [first = '', ...rest] = words;
  if (first === 'BEGIN' || first === 'DECLARE') return true;
  if (first === 'WITH') return rest[0] === 'FUNCTION' || rest[0] === 'PROCEDURE';
  if (first !== 'CREATE') return false;
  const kinds = rest.filter((w) => !['OR', 'REPLACE', 'EDITIONABLE', 'NONEDITIONABLE', 'EDITIONING'].includes(w));
  return ['FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER', 'TYPE', 'LIBRARY'].includes(kinds[0] ?? '');
}

export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  const n = sql.length;
  let start = 0;
  let words: string[] = [];
  let plsql = false;
  let atLineStart = true;
  const finish = (end: number, keepSemicolon: boolean) => {
    if (words.length > 0) out.push({ text: sql.slice(start, keepSemicolon ? end + 1 : end).trim(), words, plsql });
    words = [];
    plsql = false;
  };
  let i = 0;
  while (i < n) {
    if (atLineStart) {
      SLASH_LINE.lastIndex = i;
      if (SLASH_LINE.test(sql)) {
        finish(i, false);
        i = SLASH_LINE.lastIndex;
        start = i;
        continue;
      }
    }
    const c = sql[i]!;
    const next = sql[i + 1];
    atLineStart = c === '\n' || c === '\r';
    if (c === '-' && next === '-') {
      const end = sql.slice(i).search(/[\n\r]/);
      i = end === -1 ? n : i + end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === ';' && !plsql) {
      finish(i, false);
      start = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const prev = i > 0 ? sql[i - 1]! : '';
    if (words.length < WORD_COUNT && !IDENT.test(prev)) {
      WORD.lastIndex = i;
      const word = WORD.exec(sql)?.[0];
      // A word run straight into a quote is a prefix (N'', q'[]', nq'[]'), not a word of its own.
      if (word && sql[i + word.length] !== "'") {
        words.push(word.toUpperCase());
        i += word.length;
        if (!plsql && opensPlsql(words)) plsql = true;
        continue;
      }
      words.push('');
      if (word) {
        i += word.length;
        continue;
      }
    }
    if (c === "'") {
      i = isAlternativeQuote(sql, i) ? skipAlternativeQuote(sql, i) : skipQuoted(sql, i, "'");
      continue;
    }
    if (c === '"') {
      i = skipQuoted(sql, i, '"');
      continue;
    }
    i++;
  }
  finish(n, false);
  return out;
}

/** Past the closing quote; a doubled quote is part of the text. Unterminated runs to the end. */
function skipQuoted(sql: string, open: number, quote: string): number {
  let i = open + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

/** Whether the quote at `quote` opens q'...' or nq'...': a q (after an optional n) that doesn't end a longer word. */
function isAlternativeQuote(sql: string, quote: number): boolean {
  const prefix = /(?:^|[^A-Za-z0-9_$#\u0080-￿])(n?q)$/i.exec(sql.slice(Math.max(0, quote - 3), quote));
  return prefix !== null;
}

/** `q'X...X'` from the quote: X is any character, and an opening bracket closes with its pair. Unterminated runs to the end. */
function skipAlternativeQuote(sql: string, quote: number): number {
  const open = sql[quote + 1];
  if (open === undefined) return sql.length;
  const close = (CLOSERS[open] ?? open) + "'";
  const end = sql.indexOf(close, quote + 2);
  return end === -1 ? sql.length : end + close.length;
}

/** First words of statements that end or nest a transaction. */
const TRANSACTION_CONTROL = new Set(['COMMIT', 'ROLLBACK', 'SAVEPOINT']);

/** True for COMMIT, ROLLBACK, SAVEPOINT and SET TRANSACTION. A PL/SQL block that commits inside is not caught; see the known limits. */
export function controlsTransaction(statement: Statement): boolean {
  const [first = '', second = ''] = statement.words;
  return TRANSACTION_CONTROL.has(first) || (first === 'SET' && second === 'TRANSACTION');
}
