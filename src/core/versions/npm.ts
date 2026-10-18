import type { Bound, Difference, Interval, Parsed, RangeOptions, Release, VersionGrammar } from '../versions.js';
import { compareDigits, compareOrdinal, tighten, withinBounds } from './shared.js';

/**
 * npm's versions and ranges: SemVer 2.0.0 for versions, and npm's range
 * grammar (`^`, `~`, x-ranges, hyphen ranges, `||`) desugared to sets
 * of comparators exactly as npm does, so a range here means what it
 * means to npm. Strict mode only: npm's loose mode exists to coerce
 * text that isn't a version into one, and a version that doesn't parse is
 * reported here, never coerced. The leading `v` npm's strict grammar
 * allows is allowed.
 *
 * One deliberate difference: numeric prerelease identifiers compare as
 * numbers of any size (the spec's rule), where npm stops treating
 * one past 2^53 as a number. Precision is a policy, and the policy is to
 * keep all of it.
 */

export interface NpmVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated identifiers, as text. */
  prerelease: string[];
  build: string[];
}

type Operator = '' | '<' | '<=' | '>' | '>=';

interface Comparator {
  operator: Operator;
  /** Undefined for the comparator that matches anything. */
  version?: NpmVersion;
  /** How npm prints it: the operator and the version, no build. */
  value: string;
}

export interface NpmRange {
  sets: Comparator[][];
}

/** The longest version npm reads, and the longest range this reads (a range has no limit there; this one keeps the regular expressions linear). */
const MAX_LENGTH = 256;
const MAX_RANGE_LENGTH = 2048;

// The grammar, token by token as npm writes it.
const NUM = '0|[1-9]\\d*';
const NONNUM = '\\d*[a-zA-Z-][a-zA-Z0-9-]*';
const PREID = `(?:${NONNUM}|${NUM})`;
const PRERELEASE = `(?:-(${PREID}(?:\\.${PREID})*))`;
const BUILDID = '[a-zA-Z0-9-]+';
const BUILD = `(?:\\+(${BUILDID}(?:\\.${BUILDID})*))`;
const FULLPLAIN = `v?(${NUM})\\.(${NUM})\\.(${NUM})${PRERELEASE}?${BUILD}?`;
const LOOSEPLAIN = `[v=\\s]*(\\d+)\\.(\\d+)\\.(\\d+)(?:-?((?:${NONNUM}|\\d+)(?:\\.(?:${NONNUM}|\\d+))*))?${BUILD}?`;
const GTLT = '((?:<|>)?=?)';
const XID = `${NUM}|x|X|\\*`;
const XRANGEPLAIN = `[v=\\s]*(${XID})(?:\\.(${XID})(?:\\.(${XID})(?:${PRERELEASE})?${BUILD}?)?)?`;

const FULL = new RegExp(`^${FULLPLAIN}$`);
const PRERELEASE_ONLY = new RegExp(`^${PRERELEASE}$`);
const BUILD_ANYWHERE = new RegExp(BUILD, 'g');
const HYPHEN = new RegExp(`^\\s*(${XRANGEPLAIN})\\s+-\\s+(${XRANGEPLAIN})\\s*$`);
const COMPARATOR_TRIM = new RegExp(`(\\s*)${GTLT}\\s*(${LOOSEPLAIN}|${XRANGEPLAIN})`, 'g');
const TILDE_TRIM = /(\s*)~>?\s+/g;
const CARET_TRIM = /(\s*)\^\s+/g;
const TILDE = new RegExp(`^(?:~>?)${XRANGEPLAIN}$`);
const CARET = new RegExp(`^\\^${XRANGEPLAIN}$`);
const XRANGE = new RegExp(`^${GTLT}\\s*${XRANGEPLAIN}$`);
const STAR = /(<|>)?=?\s*\*/;
const GTE0 = /^\s*>=\s*0\.0\.0\s*$/;
const GTE0PRE = /^\s*>=\s*0\.0\.0-0\s*$/;
const COMPARATOR = new RegExp(`^${GTLT}\\s*(${FULLPLAIN})$|^$`);
const NUMERIC = /^\d+$/;

function parseVersion(text: string): Parsed<NpmVersion> {
  if (text.length > MAX_LENGTH) return { ok: false, reason: `longer than ${MAX_LENGTH} characters` };
  const m = FULL.exec(text.trim());
  if (!m) return { ok: false, reason: 'not major.minor.patch with an optional -prerelease and +build, as SemVer 2.0.0 writes it' };
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (const [name, n] of [['major', major], ['minor', minor], ['patch', patch]] as const) {
    if (n > Number.MAX_SAFE_INTEGER) return { ok: false, reason: `the ${name} version is larger than ${Number.MAX_SAFE_INTEGER}` };
  }
  return { ok: true, value: { major, minor, patch, prerelease: m[4] ? m[4].split('.') : [], build: m[5] ? m[5].split('.') : [] } };
}

const format = (v: NpmVersion) => `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;

/** SemVer 2.0.0 §11: numeric identifiers by value, below alphanumeric ones, which compare in ASCII order. */
function compareIdentifiers(a: string, b: string): number {
  const an = NUMERIC.test(a);
  const bn = NUMERIC.test(b);
  if (an && bn) return compareDigits(a, b);
  if (an !== bn) return an ? -1 : 1;
  return compareOrdinal(a, b);
}

const compareMain = (a: NpmVersion, b: NpmVersion) => Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch);

function comparePre(a: NpmVersion, b: NpmVersion): number {
  if (a.prerelease.length && !b.prerelease.length) return -1;
  if (!a.prerelease.length && b.prerelease.length) return 1;
  for (let i = 0; ; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined && y === undefined) return 0;
    if (y === undefined) return 1;
    if (x === undefined) return -1;
    const c = compareIdentifiers(x, y);
    if (c !== 0) return c;
  }
}

/** Build metadata never counts (§10). */
export const compareNpm = (a: NpmVersion, b: NpmVersion) => compareMain(a, b) || comparePre(a, b);

// Range desugaring, step for step as npm does it.

const isX = (id: string | undefined) => !id || id.toLowerCase() === 'x' || id === '*';

function replaceTilde(comp: string, z: string): string {
  return comp.replace(TILDE, (_all, M: string, m?: string, p?: string, pr?: string) => {
    if (isX(M)) return '';
    if (isX(m)) return `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
    if (isX(p)) return `>=${M}.${m}.0${z} <${M}.${+m! + 1}.0-0`;
    if (pr) return `>=${M}.${m}.${p}-${pr} <${M}.${+m! + 1}.0-0`;
    return `>=${M}.${m}.${p} <${M}.${+m! + 1}.0-0`;
  });
}

function replaceCaret(comp: string, z: string): string {
  return comp.replace(CARET, (_all, M: string, m?: string, p?: string, pr?: string) => {
    if (isX(M)) return '';
    if (isX(m)) return `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
    if (isX(p)) return M === '0' ? `>=${M}.${m}.0${z} <${M}.${+m! + 1}.0-0` : `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
    const from = `>=${M}.${m}.${p}${pr ? `-${pr}` : ''}`;
    if (M === '0') return m === '0' ? `${from} <${M}.${m}.${+p! + 1}-0` : `${from} <${M}.${+m! + 1}.0-0`;
    return `${from} <${+M + 1}.0.0-0`;
  });
}

function replaceXRange(comp: string, includePrerelease: boolean): string {
  const trimmed = comp.trim();
  return trimmed.replace(XRANGE, (whole, op: string, M: string, m?: string, p?: string) => {
    // 1.x.5 and x.1 are not ranges; left as they are, they fail as comparators.
    if ((isX(M) && !isX(m)) || (isX(m) && p && !isX(p))) return trimmed;
    const xM = isX(M);
    const xm = xM || isX(m);
    const xp = xm || isX(p);
    let gtlt = op;
    if (gtlt === '=' && xp) gtlt = '';
    let pr = includePrerelease ? '-0' : '';
    if (xM) return gtlt === '>' || gtlt === '<' ? '<0.0.0-0' : '*';
    if (gtlt && xp) {
      let major = +M;
      let minor = xm ? 0 : +m!;
      if (gtlt === '>') {
        gtlt = '>=';
        if (xm) major += 1;
        else minor += 1;
      } else if (gtlt === '<=') {
        gtlt = '<';
        if (xm) major += 1;
        else minor += 1;
      }
      if (gtlt === '<') pr = '-0';
      return `${gtlt}${major}.${minor}.0${pr}`;
    }
    if (xm) return `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
    if (xp) return `>=${M}.${m}.0${pr} <${M}.${+m! + 1}.0-0`;
    return whole;
  });
}

function hyphenReplace(includePrerelease: boolean) {
  const z = includePrerelease ? '-0' : '';
  return (_all: string, from: string, fM: string, fm?: string, fp?: string, fpr?: string, _fb?: string, to?: string, tM?: string, tm?: string, tp?: string, tpr?: string) => {
    let lower: string;
    if (isX(fM)) lower = '';
    else if (isX(fm)) lower = `>=${fM}.0.0${z}`;
    else if (isX(fp)) lower = `>=${fM}.${fm}.0${z}`;
    else if (fpr) lower = `>=${from}`;
    else lower = `>=${from}${z}`;
    let upper: string;
    if (isX(tM)) upper = '';
    else if (isX(tm)) upper = `<${+tM! + 1}.0.0-0`;
    else if (isX(tp)) upper = `<${tM}.${+tm! + 1}.0-0`;
    else if (tpr) upper = `<=${tM}.${tm}.${tp}-${tpr}`;
    else if (includePrerelease) upper = `<${tM}.${tm}.${+tp! + 1}-0`;
    else upper = `<=${to}`;
    return `${lower} ${upper}`.trim();
  };
}

function parseComparator(text: string): Parsed<Comparator> {
  const comp = text.trim().split(/\s+/).join(' ');
  const m = COMPARATOR.exec(comp);
  if (!m) return { ok: false, reason: `"${comp}" is not a comparator` };
  const operator = (m[1] === '=' ? '' : (m[1] ?? '')) as Operator;
  if (!m[2]) return { ok: true, value: { operator, value: '' } };
  const version = parseVersion(m[2]);
  if (!version.ok) return { ok: false, reason: `"${comp}": ${version.reason}` };
  return { ok: true, value: { operator, version: version.value, value: operator + format(version.value) } };
}

const isNullSet = (c: Comparator) => c.value === '<0.0.0-0';
const isAny = (c: Comparator) => c.value === '';

function parseSet(text: string, includePrerelease: boolean): Parsed<Comparator[]> {
  let range = text.replace(BUILD_ANYWHERE, '');
  range = range.replace(HYPHEN, hyphenReplace(includePrerelease));
  range = range.replace(COMPARATOR_TRIM, '$1$2$3').replace(TILDE_TRIM, '$1~').replace(CARET_TRIM, '$1^');
  const z = includePrerelease ? '-0' : '';
  const list = range
    .split(' ')
    .map((comp) => {
      let c = comp.replace(new RegExp(BUILD), '');
      c = c.trim().split(/\s+/).map((part) => replaceCaret(part, z)).join(' ');
      c = c.trim().split(/\s+/).map((part) => replaceTilde(part, z)).join(' ');
      c = c.split(/\s+/).map((part) => replaceXRange(part, includePrerelease)).join(' ');
      return c.trim().replace(STAR, '');
    })
    .join(' ')
    .split(/\s+/)
    .map((comp) => comp.trim().replace(includePrerelease ? GTE0PRE : GTE0, ''));
  const byValue = new Map<string, Comparator>();
  for (const text of list) {
    const parsed = parseComparator(text);
    if (!parsed.ok) return parsed;
    if (isNullSet(parsed.value)) return { ok: true, value: [parsed.value] };
    byValue.set(parsed.value.value, parsed.value);
  }
  if (byValue.size > 1) byValue.delete('');
  return { ok: true, value: [...byValue.values()] };
}

function parseRange(text: string, options: RangeOptions): Parsed<NpmRange> {
  if (text.length > MAX_RANGE_LENGTH) return { ok: false, reason: `longer than ${MAX_RANGE_LENGTH} characters` };
  const includePrerelease = options.includePrerelease === true;
  const raw = text.trim().replace(/\s+/g, ' ');
  let sets: Comparator[][] = [];
  for (const part of raw.split('||')) {
    const set = parseSet(part.trim(), includePrerelease);
    if (!set.ok) return set;
    if (set.value.length) sets.push(set.value);
  }
  if (sets.length > 1) {
    const first = sets[0]!;
    sets = sets.filter((c) => !isNullSet(c[0]!));
    if (sets.length === 0) sets = [first];
    else if (sets.length > 1) {
      const any = sets.find((c) => c.length === 1 && isAny(c[0]!));
      if (any) sets = [any];
    }
  }
  return { ok: true, value: { sets } };
}

/** The range as npm normalises it, or `*` for the range that matches anything. */
const formatRange = (range: NpmRange) => range.sets.map((set) => set.map((c) => c.value).join(' ')).join('||') || '*';

function testComparator(c: Comparator, v: NpmVersion): boolean {
  if (!c.version) return true;
  const order = compareNpm(v, c.version);
  switch (c.operator) {
    case '':
      return order === 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
  }
}

const sameTuple = (a: NpmVersion, b: NpmVersion) => a.major === b.major && a.minor === b.minor && a.patch === b.patch;

function testSet(set: Comparator[], v: NpmVersion, includePrerelease: boolean): boolean {
  if (!set.every((c) => testComparator(c, v))) return false;
  // A prerelease matches only when a comparator names a prerelease of the same
  // major.minor.patch: ^1.2.3-pr.1 lets 1.2.3-pr.2 in, never 1.2.4-alpha.
  if (v.prerelease.length && !includePrerelease) return set.some((c) => c.version !== undefined && c.version.prerelease.length > 0 && sameTuple(c.version, v));
  return true;
}

const satisfies = (range: NpmRange, v: NpmVersion, options: RangeOptions) => range.sets.some((set) => testSet(set, v, options.includePrerelease === true));

/** Each comparator set reduced to its tightest bounds, independently of how {@link testSet} reads it. */
function intervals(range: NpmRange): Interval<NpmVersion>[] {
  return range.sets.map((set) => {
    let lower: Bound<NpmVersion> | undefined;
    let upper: Bound<NpmVersion> | undefined;
    const prereleaseOf = new Set<string>();
    for (const c of set) {
      if (!c.version) continue;
      const v = c.version;
      if (v.prerelease.length) prereleaseOf.add(`${v.major}.${v.minor}.${v.patch}`);
      if (c.operator === '' || c.operator === '>' || c.operator === '>=') lower = tighten(compareNpm, lower, { version: v, inclusive: c.operator !== '>' }, 'lower');
      if (c.operator === '' || c.operator === '<' || c.operator === '<=') upper = tighten(compareNpm, upper, { version: v, inclusive: c.operator !== '<' }, 'upper');
    }
    return { ...(lower ? { lower } : {}), ...(upper ? { upper } : {}), prereleaseOf: [...prereleaseOf] };
  });
}

function inInterval(interval: Interval<NpmVersion>, v: NpmVersion, options: RangeOptions): boolean {
  if (!withinBounds(compareNpm, interval, v)) return false;
  if (!v.prerelease.length || options.includePrerelease) return true;
  return (interval.prereleaseOf ?? []).includes(`${v.major}.${v.minor}.${v.patch}`);
}

const RELEASES: readonly Release[] = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease', 'release'];

/** npm's version bump, without an identifier base: a prerelease counter starts at 0. */
function bump(version: NpmVersion, release: Release, preid?: string): Parsed<NpmVersion> {
  if (preid !== undefined && !PRERELEASE_ONLY.test(`-${preid}`)) return { ok: false, reason: `"${preid}" is not a prerelease identifier: letters, digits and hyphens, separated by dots` };
  const v: NpmVersion = { ...version, prerelease: [...version.prerelease], build: [] };
  const pre = () => {
    if (v.prerelease.length === 0) v.prerelease = ['0'];
    else {
      let i = v.prerelease.length;
      while (--i >= 0) {
        if (NUMERIC.test(v.prerelease[i]!)) {
          v.prerelease[i] = String(BigInt(v.prerelease[i]!) + 1n);
          break;
        }
      }
      if (i === -1) v.prerelease.push('0');
    }
    if (preid) {
      const ids = preid.split('.');
      const startsWith = ids.length <= v.prerelease.length && ids.every((id, n) => compareIdentifiers(v.prerelease[n]!, id) === 0);
      const next = v.prerelease[ids.length];
      if (!startsWith || next === undefined || !NUMERIC.test(next)) v.prerelease = [...ids, '0'];
    }
  };
  const patch = () => {
    if (v.prerelease.length === 0) v.patch++;
    v.prerelease = [];
  };
  switch (release) {
    case 'major':
      if (v.minor !== 0 || v.patch !== 0 || v.prerelease.length === 0) v.major++;
      v.minor = 0;
      v.patch = 0;
      v.prerelease = [];
      break;
    case 'minor':
      if (v.patch !== 0 || v.prerelease.length === 0) v.minor++;
      v.patch = 0;
      v.prerelease = [];
      break;
    case 'patch':
      patch();
      break;
    case 'premajor':
      v.prerelease = [];
      v.major++;
      v.minor = 0;
      v.patch = 0;
      pre();
      break;
    case 'preminor':
      v.prerelease = [];
      v.minor++;
      v.patch = 0;
      pre();
      break;
    case 'prepatch':
      v.prerelease = [];
      patch();
      pre();
      break;
    case 'prerelease':
      if (v.prerelease.length === 0) patch();
      pre();
      break;
    case 'release':
      if (v.prerelease.length === 0) return { ok: false, reason: `${format(version)} is not a prerelease, so it has no release to bump to` };
      v.prerelease = [];
      break;
  }
  if (v.major > Number.MAX_SAFE_INTEGER || v.minor > Number.MAX_SAFE_INTEGER || v.patch > Number.MAX_SAFE_INTEGER) return { ok: false, reason: `the result is larger than ${Number.MAX_SAFE_INTEGER}` };
  return { ok: true, value: v };
}

function diff(a: NpmVersion, b: NpmVersion): Difference | null {
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch) return 'patch';
  return comparePre(a, b) === 0 ? null : 'prerelease';
}

export const npmGrammar: VersionGrammar<NpmVersion, NpmRange> = {
  ecosystem: 'npm',
  parse: parseVersion,
  format,
  compare: compareNpm,
  parseRange,
  formatRange,
  satisfies,
  intervals,
  inInterval,
  releases: RELEASES,
  bump,
  diff,
};
