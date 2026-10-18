import { createHash } from 'node:crypto';
import { ToilError } from '../../../core/errors.js';
import { dateOfDay, dayNumber, daysInMonth, resolveWall, wallAt, weekdayOfDay, type Wall } from './zone.js';

/**
 * Cron expressions in three dialects, read into one schedule that both lists
 * run times and re-checks them:
 *
 * - `standard`: five fields (minute hour day-of-month month day-of-week), as
 *   the classic crontab reads them, macros included. When neither day field
 *   starts with `*`, a day matches either one (the classic OR rule).
 * - `quartz`: six or seven fields, seconds first and an optional year last,
 *   with `?`, `L`, `W` and `#`. One day field must be `?`.
 * - `jenkins`: five fields plus `H`, the hash of the job's full name, placed
 *   exactly as Jenkins places it (MD5 folded to 64 bits seeding Java's
 *   `java.util.Random`). Both day fields must match (AND, unlike standard cron).
 *
 * A schedule nobody can explain is a standing meeting; this one at least
 * says when it is.
 */

export type Dialect = 'standard' | 'quartz' | 'jenkins';

export interface DayOfMonthRule {
  /** `?`: this field doesn't decide (Quartz). */
  any: boolean;
  days: number[];
  /** Days counted back from the month's last: 0 for `L`, 3 for `L-3`. */
  last: number[];
  /** `15W`: the weekday nearest the 15th, inside the month. */
  nearestWeekday: number[];
  /** `LW`: the month's last weekday. */
  lastWeekday: boolean;
}

export interface DayOfWeekRule {
  any: boolean;
  /** 0 for Sunday to 6 for Saturday, whatever the dialect's own numbering. */
  days: number[];
  /** `5L` in Quartz (6L means Friday there): the last such weekday of the month. */
  last: number[];
  /** `6#3`: the third such weekday of the month. */
  nth: Array<{ weekday: number; n: number }>;
}

export interface CronSchedule {
  dialect: Dialect;
  expression: string;
  /** What a macro stands for (`@daily` is `0 0 * * *`), or the expression itself. */
  written: string[];
  second: number[];
  minute: number[];
  hour: number[];
  dayOfMonth: DayOfMonthRule;
  month: number[];
  dayOfWeek: DayOfWeekRule;
  /** Quartz's optional year; null when any year. */
  year: number[] | null;
  /** The standard rule: a day field written starting with `*` makes the two day fields AND rather than OR. */
  domStar: boolean;
  dowStar: boolean;
  /** Whether any field used Jenkins's `H`. */
  hashed: boolean;
}

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type FieldKey = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year';

interface FieldDef {
  key: FieldKey;
  label: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const FIX: Record<Dialect, string> = {
  standard: 'A standard expression has five fields: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12 or JAN-DEC) day-of-week (0-7 or SUN-SAT), each *, a value, a range a-b, a list a,b, or a step */n or a-b/n. Macros: @yearly @monthly @weekly @daily @hourly.',
  quartz: 'A Quartz expression has six or seven fields: second minute hour day-of-month month day-of-week [year]. Day-of-week runs 1-7 from SUN, and one of the two day fields must be ?. Day-of-month also takes L, L-n, nW and LW; day-of-week takes nL and n#k.',
  jenkins: 'A Jenkins expression has five fields like standard cron, plus H (a value hashed from the job name), H(a-b) and H/n. Macros: @yearly @monthly @weekly @daily @midnight @hourly.',
};

function defs(dialect: Dialect): FieldDef[] {
  const dow: FieldDef = dialect === 'quartz' ? { key: 'dayOfWeek', label: 'day-of-week', min: 1, max: 7, names: Object.fromEntries(DAYS.map((d, i) => [d, i + 1])) } : { key: 'dayOfWeek', label: 'day-of-week', min: 0, max: 7, names: Object.fromEntries(DAYS.map((d, i) => [d, i])) };
  const five: FieldDef[] = [
    { key: 'minute', label: 'minute', min: 0, max: 59 },
    { key: 'hour', label: 'hour', min: 0, max: 23 },
    { key: 'dayOfMonth', label: 'day-of-month', min: 1, max: 31 },
    { key: 'month', label: 'month', min: 1, max: 12, names: MONTHS },
    dow,
  ];
  if (dialect !== 'quartz') return five;
  return [{ key: 'second', label: 'second', min: 0, max: 59 }, ...five, { key: 'year', label: 'year', min: 1970, max: 2099 }];
}

const MACROS: Record<Exclude<Dialect, 'quartz'>, Record<string, string>> = {
  standard: { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' },
  // Jenkins spreads its macros by hash so a thousand nightly jobs don't all start at midnight.
  jenkins: { '@yearly': 'H H H H *', '@annually': 'H H H H *', '@monthly': 'H H H * *', '@weekly': 'H H * * H', '@daily': 'H H * * *', '@midnight': 'H H(0-2) * * *', '@hourly': 'H * * * *' },
};

/**
 * Java's `java.util.Random`, bit for bit: the 48-bit linear congruential
 * generator and `nextInt(bound)` with its rejection loop. Jenkins draws `H`
 * values from it, so nothing approximate will do.
 */
export class JavaRandom {
  private static readonly MULT = 0x5deece66dn;
  private static readonly MASK = (1n << 48n) - 1n;
  private seed: bigint;

  constructor(seed: bigint) {
    this.seed = (seed ^ JavaRandom.MULT) & JavaRandom.MASK;
  }

  next(bits: number): number {
    this.seed = (this.seed * JavaRandom.MULT + 0xbn) & JavaRandom.MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(bound: number): number {
    let r = this.next(31);
    const m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = this.next(31));
    return r;
  }
}

/** Jenkins's `Hash.from(seed)`: MD5 of the UTF-8 name, the second half XORed onto the first, read as a big-endian long. */
export function jenkinsHash(seed: string): JavaRandom {
  const digest = createHash('md5').update(seed, 'utf8').digest();
  for (let i = 8; i < digest.length; i++) digest[i % 8] = digest[i % 8]! ^ digest[i]!;
  let l = 0n;
  for (let i = 0; i < 8; i++) l = (l << 8n) + BigInt(digest[i]!);
  return new JavaRandom(l);
}

interface ParseState {
  dialect: Dialect;
  expression: string;
  hash: JavaRandom | undefined;
  hashed: boolean;
}

function fail(state: ParseState, message: string): never {
  throw new ToilError('INVALID_INPUT', `Cron expression "${state.expression}" (${state.dialect}): ${message}.`, { fix: FIX[state.dialect] });
}

function value(state: ParseState, def: FieldDef, token: string): number {
  let n: number;
  if (/^\d+$/.test(token)) n = Number(token);
  else {
    const named = def.names?.[token.toUpperCase()];
    if (named === undefined) fail(state, `${def.label} "${token}" is not a number${def.names ? ' or a name' : ''}`);
    n = named;
  }
  if (n < def.min || n > def.max) fail(state, `${def.label} ${token} is outside ${def.min}-${def.max}`);
  return n;
}

/** Normalises a day-of-week in the dialect's numbering to 0 (Sunday) to 6. */
function weekday(dialect: Dialect, n: number): number {
  return dialect === 'quartz' ? n - 1 : n % 7;
}

function range(start: number, end: number, step: number, def: FieldDef, state: ParseState): number[] {
  const out: number[] = [];
  if (start > end) {
    // Quartz wraps a backwards range (FRI-MON, 22-2); standard and Jenkins refuse it.
    if (state.dialect !== 'quartz') fail(state, `${def.label} range ${start}-${end} runs backwards`);
    const span = def.max - def.min + 1;
    for (let i = 0; i <= end - start + span; i += step) out.push(((start - def.min + i) % span) + def.min);
    return out;
  }
  for (let i = start; i <= end; i += step) out.push(i);
  return out;
}

interface FieldResult {
  values: number[];
  any: boolean;
  last: number[];
  nearestWeekday: number[];
  lastWeekday: boolean;
  nth: Array<{ weekday: number; n: number }>;
}

function parseField(state: ParseState, def: FieldDef, text: string): FieldResult {
  const out: FieldResult = { values: [], any: false, last: [], nearestWeekday: [], lastWeekday: false, nth: [] };
  const { dialect } = state;
  const isDow = def.key === 'dayOfWeek';
  const isDom = def.key === 'dayOfMonth';
  if (text === '?') {
    if (dialect !== 'quartz' || !(isDom || isDow)) fail(state, `? is only for Quartz's day-of-month and day-of-week fields`);
    out.any = true;
    return out;
  }
  const all = isDow && dialect !== 'quartz' ? { min: 0, max: 6 } : def;
  for (const item of text.split(',')) {
    if (item === '') fail(state, `${def.label} "${text}" has an empty list item`);
    if (dialect === 'quartz' && isDom) {
      if (item === 'L') { out.last.push(0); continue; }
      const back = /^L-(\d+)$/.exec(item);
      if (back) {
        const n = Number(back[1]);
        if (n > 30) fail(state, `L-${back[1]} counts back more than 30 days`);
        out.last.push(n);
        continue;
      }
      if (item === 'LW') { out.lastWeekday = true; continue; }
      const near = /^(\d+)W$/.exec(item);
      if (near) { out.nearestWeekday.push(value(state, def, near[1]!)); continue; }
    }
    if (dialect === 'quartz' && isDow) {
      // A lone L in day-of-week is 7, Saturday: the last day of Quartz's week.
      if (item === 'L') { out.values.push(7); continue; }
      const last = /^(\w+?)L$/i.exec(item);
      if (last) { out.last.push(weekday(dialect, value(state, def, last[1]!))); continue; }
      const nth = /^(\w+)#(\d+)$/.exec(item);
      if (nth) {
        const n = Number(nth[2]);
        if (n < 1 || n > 5) fail(state, `${item}: the week of the month after # runs 1 to 5`);
        out.nth.push({ weekday: weekday(dialect, value(state, def, nth[1]!)), n });
        continue;
      }
    }
    const hashed = /^H(?:\((\w+)-(\w+)\))?(?:\/(\d+))?$/.exec(item);
    if (hashed) {
      if (dialect !== 'jenkins') fail(state, `H is Jenkins syntax; pass --dialect jenkins`);
      state.hashed = true;
      if (!state.hash) fail(state, `H needs the job's full name to place it`);
      const s = hashed[1] === undefined ? def.min : value(state, def, hashed[1]);
      // Jenkins keeps an unbounded H inside 1-28 for day-of-month, so it exists every month, and 0-6 for day-of-week, since 7 is Sunday again.
      const e = hashed[2] === undefined ? (isDom ? 28 : isDow ? 6 : def.max) : value(state, def, hashed[2]);
      const step = hashed[3] === undefined ? 1 : Number(hashed[3]);
      if (step <= 0) fail(state, `${item}: a step must be positive`);
      if (step > e - s + 1) fail(state, `${item}: the step is larger than the range`);
      if (step > 1) for (let i = state.hash.nextInt(step) + s; i <= e; i += step) out.values.push(i);
      else out.values.push(s + state.hash.nextInt(e + 1 - s));
      continue;
    }
    const stepped = /^(.+)\/(\d+)$/.exec(item);
    const base = stepped ? stepped[1]! : item;
    const step = stepped ? Number(stepped[2]) : 1;
    if (stepped && step === 0) fail(state, `${item}: a step must be positive`);
    if (base === '*') {
      out.values.push(...range(all.min, all.max, step, def, state));
      continue;
    }
    const span = /^(\w+)-(\w+)$/.exec(base);
    if (span) {
      out.values.push(...range(value(state, def, span[1]!), value(state, def, span[2]!), step, def, state));
      continue;
    }
    if (!/^\w+$/.test(base)) fail(state, `${def.label} "${item}" is not a value, range, list or step`);
    const start = value(state, def, base);
    out.values.push(...(stepped ? range(start, all.max, step, def, state) : [start]));
  }
  return out;
}

const sorted = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b);

/** Which dialect an expression is written in, when the caller didn't say. */
export function detectDialect(expression: string): Dialect {
  const text = expression.trim();
  const count = text.startsWith('@') ? 5 : text.split(/\s+/).length;
  if (count === 6 || count === 7) return 'quartz';
  return /(^|[\s,])H(?=$|[\s,(/])/.test(text) ? 'jenkins' : 'standard';
}

/**
 * Reads an expression in `dialect`. `job` is the Jenkins job's full name
 * (`folder/job`), which `H` needs; any other dialect ignores it.
 */
export function parseCron(expression: string, dialect: Dialect, job?: string): CronSchedule {
  const state: ParseState = { dialect, expression, hash: dialect === 'jenkins' && job !== undefined ? jenkinsHash(job) : undefined, hashed: false };
  let text = expression.trim().replace(/\s+/g, ' ');
  if (text.startsWith('@')) {
    if (dialect === 'quartz') fail(state, 'Quartz has no @ macros');
    if (text.toLowerCase() === '@reboot') fail(state, '@reboot runs when the machine starts, so it has no times to list');
    const macro = MACROS[dialect][text.toLowerCase()];
    if (!macro) fail(state, `unknown macro ${text}`);
    text = macro;
  }
  const fields = text.split(' ');
  const fieldDefs = defs(dialect);
  const wanted = dialect === 'quartz' ? '6 or 7' : '5';
  if (dialect === 'quartz' ? fields.length < 6 || fields.length > 7 : fields.length !== 5) fail(state, `it has ${fields.length} fields, not ${wanted}`);
  const parsed = new Map<FieldKey, FieldResult>();
  fieldDefs.forEach((def, i) => {
    const field = fields[i];
    if (field !== undefined) parsed.set(def.key, parseField(state, def, field));
  });
  const get = (key: FieldKey) => parsed.get(key);
  const dom = get('dayOfMonth')!;
  const dow = get('dayOfWeek')!;
  if (dialect === 'quartz') {
    if (dom.any === dow.any) fail(state, dom.any ? 'only one of day-of-month and day-of-week may be ?' : 'one of day-of-month and day-of-week must be ?, since Quartz does not combine them');
  } else if (dow.last.length || dow.nth.length) fail(state, 'L and # are Quartz syntax');
  const dowValues = dow.values.map((v) => weekday(dialect, v));
  return {
    dialect,
    expression,
    written: fields,
    second: dialect === 'quartz' ? sorted(get('second')!.values) : [0],
    minute: sorted(get('minute')!.values),
    hour: sorted(get('hour')!.values),
    dayOfMonth: { any: dom.any, days: sorted(dom.values), last: sorted(dom.last), nearestWeekday: sorted(dom.nearestWeekday), lastWeekday: dom.lastWeekday },
    month: sorted(get('month')!.values),
    dayOfWeek: { any: dow.any, days: sorted(dowValues), last: sorted(dow.last), nth: dow.nth },
    year: get('year') ? sorted(get('year')!.values) : null,
    domStar: (fields[dialect === 'quartz' ? 3 : 2] ?? '').startsWith('*'),
    dowStar: (fields[dialect === 'quartz' ? 5 : 4] ?? '').startsWith('*'),
    hashed: state.hashed,
  };
}

/** The weekday (0 Sunday) of a date. */
function weekdayOf(year: number, month: number, day: number): number {
  return weekdayOfDay(dayNumber({ year, month, day }));
}

function nearestWeekday(year: number, month: number, n: number): number {
  const last = daysInMonth(year, month);
  const wd = weekdayOf(year, month, n);
  // Quartz never crosses into another month: the 1st on a Saturday moves to Monday the 3rd.
  if (wd === 6) return n === 1 ? 3 : n - 1;
  if (wd === 0) return n === last ? n - 2 : n + 1;
  return n;
}

function lastWeekday(year: number, month: number): number {
  const last = daysInMonth(year, month);
  const wd = weekdayOf(year, month, last);
  return wd === 6 ? last - 1 : wd === 0 ? last - 2 : last;
}

function domMatches(rule: DayOfMonthRule, year: number, month: number, day: number): boolean {
  if (rule.days.includes(day)) return true;
  const last = daysInMonth(year, month);
  if (rule.last.some((back) => day === last - back)) return true;
  if (rule.lastWeekday && day === lastWeekday(year, month)) return true;
  return rule.nearestWeekday.some((n) => n <= last && day === nearestWeekday(year, month, n));
}

function dowMatches(rule: DayOfWeekRule, year: number, month: number, day: number): boolean {
  const wd = weekdayOf(year, month, day);
  if (rule.days.includes(wd)) return true;
  if (rule.last.includes(wd) && day + 7 > daysInMonth(year, month)) return true;
  return rule.nth.some((r) => r.weekday === wd && Math.ceil(day / 7) === r.n);
}

/** Whether the schedule runs on a calendar date, by its dialect's rule for the two day fields. */
export function dateMatches(s: CronSchedule, year: number, month: number, day: number): boolean {
  if (!s.month.includes(month)) return false;
  if (s.year && !s.year.includes(year)) return false;
  if (s.dialect === 'quartz') return s.dayOfMonth.any ? dowMatches(s.dayOfWeek, year, month, day) : domMatches(s.dayOfMonth, year, month, day);
  const dom = domMatches(s.dayOfMonth, year, month, day);
  const dow = dowMatches(s.dayOfWeek, year, month, day);
  if (s.dialect === 'jenkins' || s.domStar || s.dowStar) return dom && dow;
  return dom || dow;
}

/** Whether the schedule fires at a wall-clock reading. */
export function wallMatches(s: CronSchedule, wall: Wall): boolean {
  return wall.ms === 0 && s.second.includes(wall.second) && s.minute.includes(wall.minute) && s.hour.includes(wall.hour) && dateMatches(s, wall.year, wall.month, wall.day);
}

/** One step of the walk forward from a time. */
export type CronEvent =
  | { kind: 'run'; instant: number; wall: Wall; overlap?: { later: number } }
  /** A run time the zone skipped: its clocks jumped from before it to after it. */
  | { kind: 'gap'; wall: Wall; gapSeconds: number; resumesAt: number };

/** How far ahead to look before giving up: standard and Jenkins schedules repeat within 28 years except Feb 29 on a weekday, within 40. */
export const HORIZON_YEARS = 100;

/**
 * The schedule's events after `from` in `zone`, in order: each run once, at
 * the first instant its wall clock occurs, and each skipped run time as a
 * gap. Stops at the horizon, year 9999, or Quartz's last listed year.
 */
export function* cronEvents(s: CronSchedule, from: number, zone: string): Generator<CronEvent> {
  const start = wallAt(from, zone);
  const startDay = dayNumber(start);
  const lastYear = Math.min(9999, start.year + HORIZON_YEARS, s.year ? s.year[s.year.length - 1]! : 9999);
  const endDay = dayNumber({ year: lastYear, month: 12, day: 31 });
  const startClock = start.hour * 3600 + start.minute * 60 + start.second;
  for (let day = startDay; day <= endDay; day++) {
    const date = dateOfDay(day);
    if (!s.month.includes(date.month) || (s.year && !s.year.includes(date.year))) {
      // Skip to the end of this month; the loop's ++ lands on the 1st of the next.
      day = dayNumber({ year: date.year, month: date.month, day: daysInMonth(date.year, date.month) });
      continue;
    }
    if (!dateMatches(s, date.year, date.month, date.day)) continue;
    for (const hour of s.hour) {
      for (const minute of s.minute) {
        for (const second of s.second) {
          // Earlier wall clocks on the first day are at or before `from` at their first occurrence.
          if (day === startDay && hour * 3600 + minute * 60 + second < startClock) continue;
          const wall: Wall = { ...date, hour, minute, second, ms: 0 };
          const r = resolveWall(wall, zone);
          if (r.kind === 'gap') {
            if (r.instant > from) yield { kind: 'gap', wall, gapSeconds: r.gapSeconds, resumesAt: r.instant };
            continue;
          }
          if (r.instant <= from) continue;
          yield r.kind === 'overlap' ? { kind: 'run', instant: r.instant, wall, overlap: { later: r.later } } : { kind: 'run', instant: r.instant, wall };
        }
      }
    }
  }
}

// ---- Explaining ----

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function list(words: string[], joiner = 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`;
}

/** Runs of consecutive values as `a-b`, the rest as they are. */
function runs(values: number[], show: (n: number) => string = String): string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length; ) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j]! + 1) j++;
    out.push(j - i >= 2 ? `${show(values[i]!)} through ${show(values[j]!)}` : j > i ? `${show(values[i]!)}, ${show(values[j]!)}` : show(values[i]!));
    i = j + 1;
  }
  return out;
}

/** An even step through the field from its start: `every 15 minutes`, or `every 15 minutes from minute 5`. */
function stepOf(values: number[], min: number, max: number): { step: number; start: number } | undefined {
  if (values.length < 2) return undefined;
  const step = values[1]! - values[0]!;
  if (step < 2 || values.some((v, i) => v !== values[0]! + i * step)) return undefined;
  if (values[values.length - 1]! + step <= max) return undefined;
  return values[0]! - min < step ? { step, start: values[0]! } : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

function unitPhrase(values: number[], unit: string, min: number, max: number): string {
  if (values.length === max - min + 1) return `every ${unit}`;
  const step = stepOf(values, min, max);
  if (step) return `every ${step.step} ${unit}s${step.start === min ? '' : ` from ${unit} ${step.start}`}`;
  return `at ${unit}${values.length > 1 ? 's' : ''} ${list(runs(values))}`;
}

function timePhrase(s: CronSchedule): string {
  const [sec, min, hr] = [s.second, s.minute, s.hour];
  const clock = (h: number, m: number, x: number) => `${pad(h)}:${pad(m)}${s.dialect === 'quartz' && x ? `:${pad(x)}` : ''}`;
  if (sec.length === 1 && min.length === 1 && hr.length <= 6) return `at ${list(hr.map((h) => clock(h, min[0]!, sec[0]!)))}`;
  const parts: string[] = [];
  if (s.dialect === 'quartz' && !(sec.length === 1 && sec[0] === 0)) parts.push(unitPhrase(sec, 'second', 0, 59));
  parts.push(min.length === 1 && hr.length === 24 ? `at minute ${min[0]} of every hour` : unitPhrase(min, 'minute', 0, 59));
  if (hr.length !== 24) {
    const step = stepOf(hr, 0, 23);
    parts.push(step ? `every ${step.step} hours${step.start ? ` from ${pad(step.start)}:00` : ''}` : `during hour${hr.length > 1 ? 's' : ''} ${list(runs(hr, (h) => `${pad(h)}:00`))}`);
  }
  return parts.join(', ');
}

function domPhrase(r: DayOfMonthRule): string[] {
  const out: string[] = [];
  if (r.days.length && r.days.length < 31) out.push(`on day${r.days.length > 1 ? 's' : ''} ${list(runs(r.days))} of the month`);
  for (const back of r.last) out.push(back === 0 ? 'on the last day of the month' : `${back} day${back > 1 ? 's' : ''} before the last day of the month`);
  if (r.lastWeekday) out.push('on the last weekday of the month');
  for (const n of r.nearestWeekday) out.push(`on the weekday nearest day ${n} of the month`);
  return out;
}

function dowPhrase(r: DayOfWeekRule): string[] {
  const out: string[] = [];
  if (r.days.length && r.days.length < 7) out.push(`on ${list(runs(r.days, (d) => WEEKDAY_NAMES[d]!))}`);
  for (const d of r.last) out.push(`on the last ${WEEKDAY_NAMES[d]} of the month`);
  for (const { weekday: d, n } of r.nth) out.push(`on the ${ordinal(n)} ${WEEKDAY_NAMES[d]} of the month`);
  return out;
}

/** The schedule in words, built from the same fields the runs come from. */
export function explainCron(s: CronSchedule): string {
  const parts = [timePhrase(s)];
  const dom = s.dayOfMonth.any ? [] : domPhrase(s.dayOfMonth);
  const dow = s.dayOfWeek.any ? [] : dowPhrase(s.dayOfWeek);
  const or = s.dialect === 'standard' && !s.domStar && !s.dowStar;
  if (dom.length && dow.length) parts.push(or ? `${list(dom, 'or')} or ${list(dow, 'or')}` : `${list(dom, 'or')}, if that day is also ${list(dow, 'or').replace(/^on /, '')}`);
  else if (dom.length || dow.length) parts.push(list([...dom, ...dow], 'or'));
  if (s.month.length < 12) parts.push(`in ${list(runs(s.month, (m) => MONTH_NAMES[m - 1]!))}`);
  if (s.year) parts.push(`in ${list(runs(s.year))}`);
  const text = parts.join(', ');
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}
