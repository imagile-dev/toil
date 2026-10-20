import { ToilError } from '../../errors.js';
import { opensPlsql } from '../oracle/split.js';
import { positionOf, tokenize, type Dialect, type Token } from './tokens.js';

/**
 * The pre-flight lint: reads SQL the caller wrote for the connection's
 * engine before anything is sent, with no model and no network. Errors
 * refuse the statement with a fix in the engine's own form; warnings ride
 * along in `meta.warnings`. `db query`, `db execute` and `db lint` call it
 * (src/areas/db/index.ts).
 *
 * It is not what keeps a read read-only. The engine does that, and still
 * does for anything the lint lets through (the `databases` skill): the
 * read-only rule here only refuses the obvious write a little earlier,
 * before a connection or a transaction is opened. Every rule is tuned to
 * stay quiet when unsure, since an error can't be skipped and a false one
 * blocks good SQL. Being wrong in the cautious direction remains the only
 * approved way of being wrong.
 */

export type { Dialect } from './tokens.js';

export type RuleId =
  | 'unterminated'
  | 'multiple-statements'
  | 'read-only-write'
  | 'dialect-limit'
  | 'dialect-top'
  | 'dialect-backtick'
  | 'dialect-function'
  | 'dialect-concat'
  | 'select-star'
  | 'implicit-cross-join';

export type Severity = 'error' | 'warning';

/** What the SQL is for: one read-only statement with a row cap (`db query`), or a script of changes (`db execute`). */
export type LintPurpose = 'query' | 'execute';

export interface Finding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** What to write instead, in this engine's own form. */
  fix: string;
  /** Where in the SQL: the offset of the first character, and its 1-based line and column. */
  position: { offset: number; line: number; column: number };
}

export interface LintResult {
  engine: Dialect;
  /** Every rule that ran, in the order they run. */
  rules: RuleId[];
  findings: Finding[];
}

export interface LintOptions {
  purpose: LintPurpose;
  /** False skips the warning rules (`--no-lint`). Errors always run. */
  warnings?: boolean;
}

export const LABELS: Record<Dialect, string> = { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL', sqlserver: 'SQL Server', oracle: 'Oracle' };
const ALL: readonly Dialect[] = ['sqlite', 'postgres', 'mysql', 'sqlserver', 'oracle'];

interface Rule {
  id: RuleId;
  /** The severity on each engine the rule runs on; an engine left out doesn't run it. */
  on: Partial<Record<Dialect, Severity>>;
  /** Only for this purpose; both when left out. */
  purpose?: LintPurpose;
  check(statement: Token[], ctx: RuleContext): Array<{ at: Token; message: string; fix: string }>;
}

interface RuleContext {
  engine: Dialect;
  label: string;
}

const every = (severity: Severity, except: Dialect[] = []): Partial<Record<Dialect, Severity>> =>
  Object.fromEntries(ALL.filter((d) => !except.includes(d)).map((d) => [d, severity]));

const word = (t: Token | undefined, ...names: string[]) => t?.kind === 'word' && names.includes(t.upper);
const isCount = (t: Token | undefined) => t?.kind === 'number' || t?.kind === 'param';

/** Statements that change the database, by their first word. */
const WRITE_FIRST = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE', 'RENAME', 'COMMENT']);
/** Data changes a WITH can hold, in a CTE (`AS (DELETE ...)`) or as its main statement (`) UPDATE ...`). */
const WRITE_IN_WITH = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);

const readOnlyWrite: Rule = {
  id: 'read-only-write',
  on: every('error'),
  purpose: 'query',
  check(statement) {
    const first = statement[0];
    let at: Token | undefined;
    if (first?.kind === 'word' && WRITE_FIRST.has(first.upper)) at = first;
    else if (word(first, 'WITH')) at = statement.find((t, i) => t.kind === 'word' && WRITE_IN_WITH.has(t.upper) && (statement[i - 1]?.kind === 'open' || statement[i - 1]?.kind === 'close'));
    if (!at) return [];
    return [
      {
        at,
        message: `${at.upper} changes the database, and db query runs read-only.`,
        fix: 'To make this change, run it with toil db execute --allow-write, on a connection with "writes": true. To read, send a SELECT.',
      },
    ];
  },
};

const limitFix: Partial<Record<Dialect, (n: string) => string>> = {
  sqlserver: (n) => `Write SELECT TOP (${n}) ..., or ORDER BY ... OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY. db query already caps the rows it returns with --limit.`,
  oracle: (n) => `Write FETCH FIRST ${n} ROWS ONLY at the end (OFFSET m ROWS FETCH NEXT ${n} ROWS ONLY to skip rows), or WHERE ROWNUM <= ${n} on Oracle 11g. db query already caps the rows it returns with --limit.`,
};

const dialectLimit: Rule = {
  id: 'dialect-limit',
  on: { sqlserver: 'error', oracle: 'error' },
  check(statement, { engine, label }) {
    return statement.flatMap((t, i) =>
      word(t, 'LIMIT') && statement[i - 1]?.kind !== 'dot' && isCount(statement[i + 1])
        ? [{ at: t, message: `LIMIT isn't ${label} syntax; it's how PostgreSQL, MySQL and SQLite cap rows.`, fix: limitFix[engine]!(statement[i + 1]!.text) }]
        : [],
    );
  },
};

const dialectTop: Rule = {
  id: 'dialect-top',
  on: every('error', ['sqlserver']),
  check(statement, { engine, label }) {
    return statement.flatMap((t, i) => {
      if (!word(t, 'TOP')) return [];
      const before = statement[i - 1];
      const afterSelect = word(before, 'SELECT') || (word(before, 'DISTINCT', 'ALL') && word(statement[i - 2], 'SELECT'));
      const next = statement[i + 1];
      if (!afterSelect || !(isCount(next) || next?.kind === 'open')) return [];
      const n = next?.kind === 'open' && isCount(statement[i + 2]) ? statement[i + 2]!.text : next?.kind === 'open' ? 'n' : next!.text;
      const fix = engine === 'oracle' ? `Drop TOP and put FETCH FIRST ${n} ROWS ONLY at the end of the statement (Oracle 12c and later).` : `Drop TOP and put LIMIT ${n} at the end of the statement.`;
      return [{ at: t, message: `TOP is SQL Server syntax, not ${label}.`, fix: `${fix} db query already caps the rows it returns with --limit.` }];
    });
  },
};

const backtickFix: Partial<Record<Dialect, string>> = {
  postgres: 'Quote names with double quotes ("name"), or leave a lower-case name unquoted.',
  oracle: 'Quote names with double quotes ("NAME"; a quoted name is case-sensitive), or leave it unquoted.',
  sqlserver: 'Quote names with square brackets ([name]) or double quotes ("name").',
  sqlite: 'Quote names with double quotes ("name"), the standard form; SQLite accepts backticks only for MySQL compatibility.',
};

const dialectBacktick: Rule = {
  id: 'dialect-backtick',
  on: { postgres: 'error', sqlserver: 'error', oracle: 'error', sqlite: 'warning' },
  check(statement, { engine, label }) {
    const at = statement.find((t) => t.kind === 'ident' && t.quote === '`');
    if (!at) return [];
    const message = engine === 'sqlite' ? 'Backtick quoting is MySQL syntax.' : `Backtick quoting is MySQL syntax; ${label} doesn't accept it.`;
    return [{ at, message, fix: backtickFix[engine]! }];
  },
};

interface ForeignFunction {
  /** The engines that have it. */
  has: Dialect[];
  /** Only with this many arguments (ISNULL(a, b), not MySQL's one-argument ISNULL(x)). */
  args?: number;
  use: Partial<Record<Dialect, string>>;
}

const NOW_ELSEWHERE = { postgres: 'now() or CURRENT_TIMESTAMP', mysql: 'NOW()', sqlite: "CURRENT_TIMESTAMP or datetime('now')", oracle: 'SYSTIMESTAMP or SYSDATE', sqlserver: 'SYSDATETIME() or GETDATE()' };
const COALESCE = Object.fromEntries(ALL.map((d) => [d, 'COALESCE(a, b)']));
const FUNCTIONS: Record<string, ForeignFunction> = {
  NOW: { has: ['postgres', 'mysql'], use: NOW_ELSEWHERE },
  GETDATE: { has: ['sqlserver'], use: NOW_ELSEWHERE },
  SYSDATETIME: { has: ['sqlserver'], use: NOW_ELSEWHERE },
  ISNULL: { has: ['sqlserver'], args: 2, use: COALESCE },
  NVL: { has: ['oracle'], use: { ...COALESCE, mysql: 'COALESCE(a, b) (MariaDB also accepts NVL; MySQL does not)' } },
  IFNULL: { has: ['mysql', 'sqlite'], use: COALESCE },
  LEN: { has: ['sqlserver'], use: { postgres: 'char_length()', mysql: 'CHAR_LENGTH()', sqlite: 'length()', oracle: 'LENGTH()' } },
  LENGTH: { has: ['postgres', 'mysql', 'sqlite', 'oracle'], use: { sqlserver: 'LEN() (DATALENGTH() for bytes)' } },
  CHARINDEX: { has: ['sqlserver'], use: { postgres: 'strpos(text, part) or position(part IN text)', mysql: 'LOCATE(part, text)', sqlite: 'instr(text, part)', oracle: 'INSTR(text, part)' } },
  SUBSTR: { has: ['postgres', 'mysql', 'sqlite', 'oracle'], use: { sqlserver: 'SUBSTRING(text, start, length)' } },
};

/** How many arguments the call opening at `open` passes, counting commas at its own depth. */
function argumentCount(statement: Token[], open: number): number {
  let depth = 0;
  let args = 1;
  for (let i = open; i < statement.length; i++) {
    const t = statement[i]!;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') {
      depth--;
      if (depth === 0) return statement[open + 1]?.kind === 'close' ? 0 : args;
    } else if (t.kind === 'comma' && depth === 1) args++;
  }
  return args;
}

const dialectFunction: Rule = {
  id: 'dialect-function',
  on: every('warning'),
  check(statement, { engine, label }) {
    return statement.flatMap((t, i) => {
      const fn = t.kind === 'word' ? FUNCTIONS[t.upper] : undefined;
      if (!fn || fn.has.includes(engine) || statement[i + 1]?.kind !== 'open' || statement[i - 1]?.kind === 'dot') return [];
      if (fn.args !== undefined && argumentCount(statement, i + 1) !== fn.args) return [];
      const owners = fn.has.map((d) => LABELS[d]).join(' and ');
      return [{ at: t, message: `${t.upper}() is a ${owners} function; ${label} doesn't have it.`, fix: `On ${label}, use ${fn.use[engine]}.` }];
    });
  },
};

/** A string literal that reads as text, not a number MySQL or SQLite would add. */
const textLiteral = (t: Token | undefined) => t?.kind === 'string' && !/^'\s*[-+]?\d+(\.\d+)?\s*'$/.test(t.text);

const dialectConcat: Rule = {
  id: 'dialect-concat',
  on: every('warning'),
  check(statement, { engine, label }) {
    return statement.flatMap((t, i) => {
      if (t.kind !== 'op') return [];
      if (t.text === '||' && engine === 'sqlserver') {
        return [{ at: t, message: 'SQL Server 2022 and earlier have no || operator; strings are joined with + or CONCAT().', fix: 'Write CONCAT(a, b), or a + b.' }];
      }
      if (t.text === '||' && engine === 'mysql') {
        return [{ at: t, message: 'In MySQL and MariaDB, || is a logical OR unless sql_mode has PIPES_AS_CONCAT.', fix: 'Write CONCAT(a, b) to join strings.' }];
      }
      if (t.text !== '+' || engine === 'sqlserver') return [];
      const before = statement[i - 1];
      const after = statement[i + 1];
      // A typed literal (DATE '2026-01-02' + 1, '1 day'::interval) is arithmetic, not text.
      const typed = (at: number) => word(statement[at - 1], 'DATE', 'TIME', 'TIMESTAMP', 'INTERVAL') || statement[at + 1]?.text === '::';
      const text = (textLiteral(before) && !typed(i - 1)) || (textLiteral(after) && !typed(i + 1));
      if (!text) return [];
      const fix = engine === 'mysql' ? 'Write CONCAT(a, b) to join strings.' : 'Write a || b to join strings.';
      return [{ at: t, message: `+ adds numbers on ${label}; it doesn't join strings.`, fix }];
    });
  },
};

/** Index of the first select-list token after the SELECT at `at`: past DISTINCT or ALL, and SQL Server's TOP (n) [PERCENT] [WITH TIES]. */
function selectListStart(statement: Token[], at: number): number {
  let j = at + 1;
  if (word(statement[j], 'DISTINCT', 'ALL')) j++;
  if (!word(statement[j], 'TOP')) return j;
  j++;
  if (statement[j]?.kind === 'open') {
    for (let depth = 0; j < statement.length; j++) {
      if (statement[j]!.kind === 'open') depth++;
      else if (statement[j]!.kind === 'close' && --depth === 0) break;
    }
  }
  j++;
  if (word(statement[j], 'PERCENT')) j++;
  if (word(statement[j], 'WITH') && word(statement[j + 1], 'TIES')) j += 2;
  return j;
}

/** The `*` of a top-level SELECT *, and the table its FROM names, if one does. */
const selectStar: Rule = {
  id: 'select-star',
  on: every('warning'),
  purpose: 'query',
  check(statement) {
    let depth = 0;
    for (let i = 0; i < statement.length; i++) {
      const t = statement[i]!;
      if (t.kind === 'open') depth++;
      else if (t.kind === 'close') depth--;
      if (depth !== 0 || !word(t, 'SELECT')) continue;
      const star = statement[selectListStart(statement, i)];
      if (star?.kind !== 'op' || star.text !== '*') continue;
      const from = statement.findIndex((s, j) => j > i && word(s, 'FROM'));
      const table = from === -1 ? undefined : statement[from + 1];
      const name = table && (table.kind === 'word' || table.kind === 'ident') ? tableName(statement, from + 1) : '<table>';
      return [
        {
          at: star,
          message: 'SELECT * returns every column, and db query returns a page of at most --limit rows of them.',
          fix: `Name the columns you need; toil db describe-table ${name} lists them.`,
        },
      ];
    }
    return [];
  },
};

/** A possibly qualified name (`schema.table`) starting at `at`, as typed. */
function tableName(statement: Token[], at: number): string {
  let name = statement[at]!.text;
  for (let i = at + 1; statement[i]?.kind === 'dot' && statement[i + 1]; i += 2) name += `.${statement[i + 1]!.text}`;
  return name;
}

/** Words that end a FROM list. */
const FROM_ENDS = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'WINDOW', 'FETCH', 'OFFSET', 'RETURNING', 'SET', 'VALUES', 'DO', 'UPDATE', 'FOR', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'CONNECT', 'START', 'QUALIFY']);
const BLOCK_ENDS = new Set(['UNION', 'INTERSECT', 'EXCEPT', 'MINUS']);

const implicitCrossJoin: Rule = {
  id: 'implicit-cross-join',
  on: every('warning'),
  check(statement) {
    interface Frame {
      inFrom: boolean;
      comma?: Token;
      where: boolean;
    }
    const found: Token[] = [];
    const fresh = (): Frame => ({ inFrom: false, where: false });
    const settle = (f: Frame) => {
      if (f.comma && !f.where) found.push(f.comma);
    };
    const frames: Frame[] = [fresh()];
    for (const t of statement) {
      const frame = frames[frames.length - 1]!;
      if (t.kind === 'open') frames.push(fresh());
      else if (t.kind === 'close') {
        if (frames.length > 1) settle(frames.pop()!);
      } else if (t.kind === 'comma') {
        if (frame.inFrom && !frame.comma) frame.comma = t;
      } else if (t.kind === 'word') {
        if (t.upper === 'FROM') frame.inFrom = true;
        else if (t.upper === 'WHERE') {
          frame.where = true;
          frame.inFrom = false;
        } else if (FROM_ENDS.has(t.upper)) frame.inFrom = false;
        if (BLOCK_ENDS.has(t.upper)) {
          settle(frame);
          frames[frames.length - 1] = fresh();
        }
      }
    }
    for (const f of frames) settle(f);
    return found.map((at) => ({
      at,
      message: 'A comma between tables in FROM, with no WHERE, pairs every row of one with every row of the other.',
      fix: 'Join with JOIN ... ON <condition>, or write CROSS JOIN if every pairing is meant.',
    }));
  },
};

/** The order rules run in: the lexer's own error first, then the other errors, then the warnings. */
const RULES: readonly Rule[] = [readOnlyWrite, dialectLimit, dialectTop, dialectBacktick, dialectFunction, dialectConcat, selectStar, implicitCrossJoin];

/** Statements as token runs, cut at semicolons. An Oracle PL/SQL unit holds semicolons of its own, so it runs to the end. */
function statementsOf(tokens: Token[], engine: Dialect): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (t.kind === 'semicolon' && !(engine === 'oracle' && opensPlsql(current.slice(0, 5).map((w) => (w.kind === 'word' ? w.upper : ''))))) {
      if (current.length > 0) out.push(current);
      current = [];
    } else if (t.kind !== 'semicolon' || current.length > 0) current.push(t);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function ranFor(engine: Dialect, purpose: LintPurpose, warnings: boolean): RuleId[] {
  const own: RuleId[] = ['unterminated', ...(purpose === 'query' ? (['multiple-statements'] as const) : [])];
  const rest = RULES.filter((r) => r.on[engine] !== undefined && (r.purpose === undefined || r.purpose === purpose) && (warnings || r.on[engine] === 'error')).map((r) => r.id);
  return [...own, ...rest];
}

export function lintSql(sql: string, engine: Dialect, { purpose, warnings = true }: LintOptions): LintResult {
  const rules = ranFor(engine, purpose, warnings);
  const label = LABELS[engine];
  const findings: Finding[] = [];
  const at = (offset: number) => positionOf(sql, offset);
  let { tokens, unterminated } = tokenize(sql, engine);
  // A server with NO_BACKSLASH_ESCAPES ends 'C:\' at its second quote; the lint can't see sql_mode, so either reading closing it is enough.
  if (unterminated && engine === 'mysql') {
    const plain = tokenize(sql, engine, { backslashStrings: false });
    if (!plain.unterminated) ({ tokens, unterminated } = plain);
  }
  if (unterminated) {
    // Past an unclosed quote the rest is one long string, so the other rules have nothing true to say.
    findings.push({
      rule: 'unterminated',
      severity: 'error',
      message: `This ${unterminated.what}, opened with ${unterminated.opener}, is never closed.`,
      fix: `Close it with ${unterminated.closer}${unterminated.what === 'string' ? `, and write a quote inside the string as ${unterminated.closer === "'" ? "''" : 'two'}` : ''}.`,
      position: at(unterminated.start),
    });
    return { engine, rules, findings };
  }
  const statements = statementsOf(tokens, engine);
  // T-SQL needs no semicolons, and BEGIN ... END blocks hold them, so only a plain script is counted.
  const counted = !(engine === 'sqlserver' && tokens.some((t) => word(t, 'BEGIN')));
  if (purpose === 'query' && counted && statements.length > 1) {
    findings.push({
      rule: 'multiple-statements',
      severity: 'error',
      message: `db query runs exactly one statement, and this SQL holds ${statements.length}.`,
      fix: 'Send one statement per db query call. To run a script of changes, use toil db execute.',
      position: at(statements[1]![0]!.start),
    });
  }
  const ctx: RuleContext = { engine, label };
  for (const rule of RULES) {
    if (!rules.includes(rule.id)) continue;
    const severity = rule.on[engine]!;
    for (const statement of statements) {
      for (const f of rule.check(statement, ctx)) findings.push({ rule: rule.id, severity, message: f.message, fix: f.fix, position: at(f.at.start) });
    }
  }
  return { engine, rules, findings };
}

/**
 * The ToilError for a lint's errors, or undefined when it has none. A write
 * on a read is WRITE_DISABLED, the code the engine would give it; anything
 * else is INVALID_INPUT. Nothing was sent either way.
 */
export function lintError(result: LintResult, command: string): ToilError | undefined {
  const errors = result.findings.filter((f) => f.severity === 'error');
  if (errors.length === 0) return undefined;
  const code = errors.some((f) => f.rule === 'read-only-write') ? 'WRITE_DISABLED' : 'INVALID_INPUT';
  const lines = errors.map((f) => `${f.message} [${f.rule}, line ${f.position.line}, column ${f.position.column}]`);
  return new ToilError(code, `${command} refused the SQL before sending it to ${LABELS[result.engine]}: ${lines.join(' ')}`, {
    fix: errors.map((f) => f.fix).join(' '),
    details: { lint: errors },
  });
}

/** One finding as a meta.warnings entry. */
export function lintWarning(f: Finding): { code: string; message: string } {
  return { code: 'LINT', message: `${f.message} [${f.rule}, line ${f.position.line}, column ${f.position.column}] Fix: ${f.fix}` };
}
