/**
 * Reads Teradata SQL's words, so toil can refuse, before anything is sent, a
 * read holding more than one statement and any SQL that would end the
 * transaction toil rolls back. It is not toil deciding whether SQL writes:
 * that is the Query Service's own report of each statement (see index.ts).
 *
 * It knows the lexer's quoting rules: '...' strings (with '' inside, and any
 * prefix or suffix such as _UNICODE'...' or '0A'XB, which are words beside a
 * string), "..." names (with "" inside), -- line comments and /* *\/ block
 * comments, which don't nest. Something left open runs to the end, as it
 * would on the server, which then refuses it.
 *
 * Transaction control is found anywhere, not only as a statement's first
 * word: COMMIT, ROLLBACK, ABORT, BT and ET are reserved words, so outside
 * strings, comments and quoted names they can only be the statements
 * themselves, and BEGIN and END count only before TRANSACTION (BEGIN QUERY
 * LOGGING is something else). A stored procedure body that commits is
 * refused with the rest; that is the price of not parsing SPL, and it is
 * cheaper than the alternative's change ticket.
 */
export interface Scan {
  /** True when the SQL holds only comments, whitespace and semicolons. */
  empty: boolean;
  /** How many statements the semicolons separate, ignoring empty ones. */
  statements: number;
  /** The first transaction-control statement found, upper-cased (`COMMIT`, `BEGIN TRANSACTION`), or undefined. */
  transactionControl?: string;
}

const WORD = /[A-Za-z_$#\u0080-￿][A-Za-z0-9_$#\u0080-￿]*/y;
const CONTROL = new Set(['COMMIT', 'ROLLBACK', 'ABORT', 'BT', 'ET']);

export function scanSql(sql: string): Scan {
  const n = sql.length;
  let statements = 0;
  let current = false;
  let previous = '';
  let transactionControl: string | undefined;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
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
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ';') {
      if (current) statements++;
      current = false;
      previous = '';
      i++;
      continue;
    }
    current = true;
    if (c === "'" || c === '"') {
      i = skipQuoted(sql, i, c);
      previous = '';
      continue;
    }
    WORD.lastIndex = i;
    const word = WORD.exec(sql)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      if (transactionControl === undefined) {
        if (CONTROL.has(upper)) transactionControl = upper;
        else if (upper === 'TRANSACTION' && (previous === 'BEGIN' || previous === 'END')) transactionControl = `${previous} TRANSACTION`;
      }
      previous = upper;
      i += word.length;
      continue;
    }
    previous = '';
    i++;
  }
  if (current) statements++;
  return { empty: statements === 0, statements, ...(transactionControl ? { transactionControl } : {}) };
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
