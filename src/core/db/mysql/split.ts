/**
 * Splits a MySQL or MariaDB script into statements, so `db query` can refuse
 * more than one, `db execute` can send them one at a time and refuse a script
 * that controls its own transaction, and reads can refuse the few statements
 * that get around the engine's read-only mode by name. It is not toil
 * deciding whether SQL writes: everything else runs read-only at the engine.
 *
 * It knows the lexer's rules: '...' and "..." strings (doubled quotes, and
 * backslash escapes unless the server's sql_mode has NO_BACKSLASH_ESCAPES),
 * `...` identifiers, `#` and `-- ` line comments, and block comments, where
 * an executable comment (`/*! ... *\/`, MariaDB's `/*M! ... *\/`) is code the
 * server runs, so its contents are read as code too.
 *
 * A mistake here fails safe. The driver sends one statement per message with
 * multi-statements off, so pieces wrongly joined are a syntax error at the
 * server; pieces wrongly cut leave an unterminated quote or a syntax error in
 * the earlier one, which fails before anything after it runs. The sql_mode
 * question is answered by asking both ways where it matters (see
 * `refusedOnRead` in index.ts). Two readings of one sentence, filed in
 * duplicate, as is customary.
 */
export interface Statement {
  /** The statement's text, with any comments before it, and without its semicolon. */
  text: string;
  /**
   * Its words in order, upper-cased, outside strings, quoted identifiers and
   * comments (an executable comment's words included). A user variable
   * (`@x`) is one '' entry, so its name never reads as a keyword; a system
   * variable (`@@session.autocommit`) is its name (`AUTOCOMMIT`).
   */
  words: string[];
}

const IDENT = /[A-Za-z0-9_$\u0080-￿]/;
const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const VARIABLE = /@@?(?:[A-Za-z0-9_$.]+|`[^`]*`|'[^']*'|"[^"]*")?/y;
/** `/*!` with an optional 5- or 6-digit version, or MariaDB's `/*M!`. */
const EXECUTABLE = /\/\*M?!\d{0,6}/y;

export interface SplitOptions {
  /** Whether a backslash escapes the next character inside a string. On unless the server runs with NO_BACKSLASH_ESCAPES. */
  backslashEscapes?: boolean;
}

export function splitStatements(sql: string, { backslashEscapes = true }: SplitOptions = {}): Statement[] {
  const out: Statement[] = [];
  const n = sql.length;
  let start = 0;
  let words: string[] = [];
  let executable = false;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (executable && c === '*' && next === '/') {
      executable = false;
      i += 2;
      continue;
    }
    if (c === '#' || (c === '-' && next === '-' && (i + 2 >= n || sql.charCodeAt(i + 2) <= 32))) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      EXECUTABLE.lastIndex = i;
      const opener = EXECUTABLE.exec(sql)?.[0];
      if (opener && !executable) {
        executable = true;
        i += opener.length;
        continue;
      }
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
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
    if (c === "'" || c === '"') {
      if (words.length === 0) words.push('');
      i = skipQuoted(sql, i, c, backslashEscapes);
      continue;
    }
    if (c === '`') {
      if (words.length === 0) words.push('');
      i = skipQuoted(sql, i, '`', false);
      continue;
    }
    if (c === '@') {
      VARIABLE.lastIndex = i;
      const variable = VARIABLE.exec(sql)![0];
      // A system variable keeps its name (SET @@session.autocommit); a user variable's name is data.
      words.push(variable.startsWith('@@') ? (variable.split('.').pop() ?? '').replace(/^@@/, '').replace(/[`'"]/g, '').toUpperCase() : '');
      i += variable.length;
      continue;
    }
    const prev = i > 0 ? sql[i - 1]! : '';
    if (!IDENT.test(prev)) {
      WORD.lastIndex = i;
      const word = WORD.exec(sql)?.[0];
      if (word) {
        words.push(word.toUpperCase());
        i += word.length;
        continue;
      }
    }
    if (words.length === 0) words.push('');
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

/** First words of statements that begin, end or nest a transaction, or commit one implicitly by locking. */
const TRANSACTION_CONTROL = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'XA', 'LOCK', 'UNLOCK']);

/**
 * True for a statement that would begin, end or nest a transaction: the
 * transaction statements, XA, LOCK and UNLOCK TABLES (which commit), and SET
 * autocommit, which commits what came before it when turned on.
 */
export function controlsTransaction(statement: Statement): boolean {
  const [first = ''] = statement.words;
  return TRANSACTION_CONTROL.has(first) || (first === 'SET' && statement.words.includes('AUTOCOMMIT'));
}

/** True when the words hold INTO OUTFILE or INTO DUMPFILE, which write a file on the server. */
export function writesServerFile(statement: Statement): boolean {
  return statement.words.some((w, i) => w === 'INTO' && (statement.words[i + 1] === 'OUTFILE' || statement.words[i + 1] === 'DUMPFILE'));
}
