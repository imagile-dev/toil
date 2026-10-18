/**
 * Splits a PostgreSQL script into statements, so `db execute` can refuse a
 * script that controls its own transaction before any of it runs, and count
 * the rows each statement changed. It is not toil deciding whether SQL
 * writes: reads never come here, and run read-only at the engine.
 *
 * It knows the lexer's quoting rules: '...' strings (with '' inside), E'...'
 * strings (with backslash escapes), "..." identifiers, $tag$...$tag$ bodies,
 * -- line comments and nested block comments. It assumes
 * standard_conforming_strings is on, the default since PostgreSQL 9.1.
 *
 * A mistake here fails safe. Each piece is sent on its own with the extended
 * protocol, which refuses two statements in one message, so pieces wrongly
 * joined are an error; pieces wrongly cut leave an unterminated quote or a
 * syntax error in the earlier one, which fails before anything after it runs.
 * Either way the transaction rolls back. Measure twice, cut once, and roll
 * back if the cut was wrong.
 */
export interface Statement {
  /** The statement's text, with any comments before it, and without its semicolon. */
  text: string;
  /** Its first two tokens, upper-cased when they are words (`PREPARE`, `TRANSACTION`), '' when not. Comments between them are skipped. */
  words: string[];
}

const IDENT = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;

export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  const n = sql.length;
  let start = 0;
  let words: string[] = [];
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i = skipBlockComment(sql, i);
      continue;
    }
    if (c === ';') {
      if (words.length > 0) out.push({ text: sql.slice(start, i), words });
      start = i + 1;
      words = [];
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const prev = i > 0 ? sql[i - 1]! : '';
    if (words.length < 2 && !IDENT.test(prev)) {
      WORD.lastIndex = i;
      const word = WORD.exec(sql)?.[0];
      // A word run straight into a quote is a prefix (E'', U&''), not a word of its own.
      if (word && sql[i + word.length] !== "'") {
        words.push(word.toUpperCase());
        i += word.length;
        continue;
      }
      words.push('');
    }
    if (c === "'") {
      // E'...' (or e'...') takes backslash escapes; the E must not end a longer word.
      const escapes = (prev === 'E' || prev === 'e') && !(i > 1 && IDENT.test(sql[i - 2]!));
      i = skipQuoted(sql, i, "'", escapes);
      continue;
    }
    if (c === '"') {
      i = skipQuoted(sql, i, '"', false);
      continue;
    }
    if (c === '$' && !IDENT.test(prev)) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    i++;
  }
  if (words.length > 0) out.push({ text: sql.slice(start), words });
  return out;
}

/** Past the closing quote; a doubled quote is part of the text. Unterminated runs to the end. */
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
  return sql.length;
}

/** PostgreSQL block comments nest. Unterminated runs to the end. */
function skipBlockComment(sql: string, open: number): number {
  let depth = 1;
  let i = open + 2;
  while (i < sql.length && depth > 0) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth++;
      i += 2;
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--;
      i += 2;
    } else i++;
  }
  return i;
}

/** First words of statements that begin, end or nest a transaction. */
const TRANSACTION_CONTROL = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE']);

/** True for a statement that would begin, end or nest a transaction, PREPARE TRANSACTION included (plain PREPARE is not). */
export function controlsTransaction(statement: Statement): boolean {
  const [first = '', second = ''] = statement.words;
  return TRANSACTION_CONTROL.has(first) || (first === 'PREPARE' && second === 'TRANSACTION');
}
