/**
 * Splits HiveQL or Impala SQL into statements. HiveServer2 takes exactly one
 * statement per request, and Hive refuses even a trailing semicolon, so
 * `db query` sends the one statement it found without it, and refuses SQL
 * holding several. `db execute` does the same: neither engine has a
 * transaction to hold several statements together (index.ts says why).
 *
 * It follows both engines' lexers: '...' and "..." are strings with backslash
 * escapes, `...` is a quoted name, `--` starts a comment that runs to the end
 * of the line, and block comments don't nest. A piece holding only comments
 * and whitespace isn't a statement. It doesn't decide whether SQL writes;
 * nothing here can, and nothing pretends to.
 *
 * A mistake here fails safe: pieces wrongly joined are one request the server
 * can't parse, and pieces wrongly cut leave an unclosed quote it refuses. The
 * semicolon remains the only punctuation with a standing veto.
 */
export interface Statement {
  /** The statement, with any comments around it, without its semicolon, trimmed. */
  text: string;
  /** Its words in order, upper-cased, outside strings, quoted names and comments. */
  words: string[];
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;

export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  const n = sql.length;
  let start = 0;
  let words: string[] = [];
  let code = false;
  const cut = (end: number) => {
    if (code) out.push({ text: sql.slice(start, end).trim(), words });
    words = [];
    code = false;
  };
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const eol = sql.indexOf('\n', i + 2);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      code = true;
      i++;
      while (i < n && sql[i] !== c) i += c !== '`' && sql[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === ';') {
      cut(i);
      start = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    code = true;
    WORD.lastIndex = i;
    const word = WORD.exec(sql);
    if (word && (i === 0 || !/[A-Za-z0-9_]/.test(sql[i - 1]!))) {
      words.push(word[0].toUpperCase());
      i += word[0].length;
      continue;
    }
    i++;
  }
  cut(n);
  return out;
}
