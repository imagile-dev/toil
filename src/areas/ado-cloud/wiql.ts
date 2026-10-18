import { ToilError } from '../../core/errors.js';

/**
 * Adding a condition to a WIQL query the caller wrote, without parsing WIQL.
 * toil only needs to know where the query's own WHERE clause starts and ends
 * at the top level, so it reads the text once, stepping over string literals
 * ('it''s', "x") and bracketed field names ([Order By]) so that a keyword
 * inside either is never taken for the real one. The caller's condition is
 * then wrapped in parentheses and ANDed with toil's, so an OR in it keeps
 * its meaning. Amending a query by appendix, the way every policy grows.
 *
 * Only flat queries (FROM WorkItems) are amended: a link query's conditions
 * are split across [Source] and [Target], and guessing which side a date
 * belongs on is not something to do quietly.
 *
 * A copy of `ado`'s, kept separate on purpose: WIQL is the same on Server and
 * Services today, but a fix for one variant must never change the other's
 * recorded behaviour without anyone deciding it should.
 */

interface Word {
  word: string;
  index: number;
}

/** The words of a WIQL query outside string literals, brackets and parentheses, upper-cased, with where each starts. */
function topLevelWords(wiql: string): Word[] {
  const words: Word[] = [];
  let depth = 0;
  for (let i = 0; i < wiql.length; ) {
    const ch = wiql[i]!;
    if (ch === "'" || ch === '"') {
      // A doubled quote inside a literal is an escaped one.
      let j = i + 1;
      while (j < wiql.length && !(wiql[j] === ch && wiql[j + 1] !== ch)) j += wiql[j] === ch ? 2 : 1;
      i = j + 1;
    } else if (ch === '[') {
      const end = wiql.indexOf(']', i + 1);
      i = end === -1 ? wiql.length : end + 1;
    } else if (ch === '(') {
      depth++;
      i++;
    } else if (ch === ')') {
      depth--;
      i++;
    } else if (/[A-Za-z_@]/.test(ch)) {
      const match = /^[A-Za-z_@][A-Za-z0-9_.@]*/.exec(wiql.slice(i))!;
      if (depth === 0) words.push({ word: match[0].toUpperCase(), index: i });
      i += match[0].length;
    } else {
      i++;
    }
  }
  return words;
}

function notFlat(detail: string): ToilError {
  return new ToilError('INVALID_INPUT', `${detail} toil can only add to a flat query (SELECT ... FROM WorkItems ...).`, {
    fix: 'Write the condition into --wiql yourself (for example [System.ChangedDate] >= \'2026-10-01T00:00:00Z\'), or leave out --updated-since and --limit.',
  });
}

/** Whether the query is a flat one, FROM WorkItems; anything else is refused with a fix. */
export function checkFlat(wiql: string): Word[] {
  const words = topLevelWords(wiql);
  const from = words.findIndex((w) => w.word === 'FROM');
  if (from === -1) throw notFlat('The --wiql query has no FROM clause.');
  const source = words[from + 1]?.word;
  if (source !== 'WORKITEMS') throw notFlat(`The --wiql query reads FROM ${source ?? 'nothing'}.`);
  return words;
}

/**
 * `wiql` with `condition` ANDed onto its top-level WHERE clause, or a WHERE
 * clause added before ORDER BY or ASOF (or at the end) when it has none.
 */
export function andWhere(wiql: string, condition: string): string {
  const words = checkFlat(wiql);
  const from = words.findIndex((w) => w.word === 'FROM');
  const after = words.slice(from + 2);
  const where = after.find((w) => w.word === 'WHERE');
  const tail = after.find((w, k) => (w.word === 'ORDER' && after[k + 1]?.word === 'BY') || w.word === 'ASOF');
  const end = tail ? tail.index : wiql.length;
  if (where && where.index < end) {
    const own = wiql.slice(where.index + 'WHERE'.length, end).trim();
    return `${wiql.slice(0, where.index)}WHERE (${own}) AND ${condition}${tail ? ` ${wiql.slice(end)}` : ''}`;
  }
  const head = wiql.slice(0, end).trimEnd();
  return `${head} WHERE ${condition}${tail ? ` ${wiql.slice(end)}` : ''}`;
}

/**
 * An `--updated-since` value as the instant it names, in the one form a WIQL
 * date literal takes with time precision on: `2026-10-01T09:00:00.000Z`. A
 * date alone is UTC midnight; a date-time must carry its zone (Z or an
 * offset), so the same flag means the same instant on every machine.
 */
export function wiqlInstant(value: string, flag = '--updated-since'): string {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  // Date rolls 2026-02-30 over into March without complaint; the calendar date has to exist as written.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const real = new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d && m >= 1 && m <= 12;
  if (!ok || !real || Number.isNaN(date.getTime())) {
    throw new ToilError('INVALID_INPUT', `Invalid ${flag} value "${value}". Use an ISO 8601 date (2026-10-01, read as UTC midnight) or a date-time with its zone (2026-10-01T09:00:00Z, or +02:00).`, {
      fix: `Pass ${flag} as 2026-10-01 or 2026-10-01T09:00:00Z.`,
    });
  }
  return date.toISOString();
}
