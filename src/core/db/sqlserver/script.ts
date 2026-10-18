/**
 * Reads a T-SQL script's words, so toil can refuse one that controls its own
 * transaction before any of it runs. It is not toil deciding whether SQL
 * writes: that is the engine's report of each statement (see index.ts).
 *
 * T-SQL doesn't need semicolons between statements, so this never splits a
 * script; it only finds the keywords that begin, end or nest a transaction.
 * COMMIT, ROLLBACK, SAVE and TRAN are reserved words, so outside strings,
 * comments and quoted identifiers they can't be a column or an alias.
 *
 * It knows the lexer's quoting rules: '...' and N'...' strings (with ''
 * inside), "..." and [...] identifiers (with "" and ]] inside), -- line
 * comments and nested block comments. BEGIN and END also open and close
 * blocks (BEGIN ... END, BEGIN TRY, CASE ... END), so they count as
 * transaction control only when they can't be one: BEGIN followed by TRAN,
 * TRANSACTION or DISTRIBUTED, or by nothing (`BEGIN;`); END with no block
 * open. A lexer that only has to find four words still had to read the whole
 * style guide first.
 */
export interface ScriptScan {
  /** True when the SQL holds only comments, whitespace and semicolons. */
  empty: boolean;
  /** The first transaction-control keyword found, upper-cased (`COMMIT`, `BEGIN TRANSACTION`), or undefined. */
  transactionControl?: string;
}

const WORD = /[A-Za-z_@#][A-Za-z0-9_@#$]*/y;
const TRANSACTION_WORDS = new Set(['TRAN', 'TRANSACTION', 'DISTRIBUTED']);

export function scanScript(sql: string): ScriptScan {
  const tokens = tokenize(sql);
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]!;
    const next = tokens[i + 1] ?? ';';
    if (word === 'COMMIT' || word === 'ROLLBACK') return { empty: false, transactionControl: word };
    if (word === 'SAVE' && TRANSACTION_WORDS.has(next)) return { empty: false, transactionControl: `SAVE ${next}` };
    if (word === 'BEGIN') {
      if (TRANSACTION_WORDS.has(next) || next === ';') return { empty: false, transactionControl: next === ';' ? 'BEGIN' : `BEGIN ${next}` };
      // BEGIN TRY / BEGIN CATCH pair with END TRY / END CATCH, which close them below.
      depth++;
    } else if (word === 'CASE') depth++;
    else if (word === 'END') {
      if (depth === 0) return { empty: false, transactionControl: 'END' };
      depth--;
    }
  }
  return { empty: tokens.every((t) => t === ';') };
}

/**
 * Upper-cased words and `;`, with strings, quoted identifiers, numbers and
 * other punctuation dropped (a string or identifier becomes `'`, so it still
 * separates two words), and comments skipped.
 */
function tokenize(sql: string): string[] {
  const out: string[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (c === '/' && next === '*') {
      i = skipBlockComment(sql, i);
    } else if (c === "'") {
      i = skipQuoted(sql, i, "'");
      out.push("'");
    } else if (c === '"') {
      i = skipQuoted(sql, i, '"');
      out.push("'");
    } else if (c === '[') {
      i = skipQuoted(sql, i, ']');
      out.push("'");
    } else if (c === ';') {
      out.push(';');
      i++;
    } else if (/[A-Za-z_@#]/.test(c)) {
      WORD.lastIndex = i;
      const word = WORD.exec(sql)![0];
      i += word.length;
      // N'...' is a Unicode string literal, not the word N.
      if ((word === 'N' || word === 'n') && sql[i] === "'") continue;
      out.push(word.toUpperCase());
    } else if (/[0-9]/.test(c)) {
      // A number, possibly with a word stuck to it (1e5, 0x1F): never a keyword.
      while (i < n && /[A-Za-z0-9_.$]/.test(sql[i]!)) i++;
      out.push("'");
    } else {
      if (!/\s/.test(c)) out.push("'");
      i++;
    }
  }
  return out;
}

/** Past the closing quote; a doubled closing quote is part of the text. Unterminated runs to the end. */
function skipQuoted(sql: string, open: number, close: string): number {
  let i = open + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (sql[i + 1] === close) i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

/** T-SQL block comments nest. Unterminated runs to the end. */
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
