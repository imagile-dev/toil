/**
 * git's glob dialect, as `.gitignore` and `includeIf "gitdir:..."` use it.
 * With `pathname` (git's WM_PATHNAME), `*`, `?` and bracket classes never match
 * `/`, and `**` between slashes matches any number of directories, including
 * none. Without it, `*` matches across slashes too.
 *
 * The pattern compiles to a list of steps that a matcher walks as a set of
 * live positions, one path character at a time (#244). It used to compile to
 * a RegExp, which backtracks: a `.gitignore` line of stacked `*` or `**`
 * segments took time exponential in the number of stars, and every folder
 * walk reads `.gitignore`. The set holds at most two positions per step, so a
 * match costs O(steps x path length), whatever the pattern says. Compiling is
 * linear in the pattern's length too: a `[` that never closes is scanned at
 * most once past any point another such scan already reached (`bracket`).
 *
 * Forty years of shell globbing, and every tool still files its own variance.
 */
export interface Wildmatch {
  /** Whether the whole of `path` matches the pattern. */
  test(path: string): boolean;
}

/**
 * One step of a compiled pattern. `char` consumes one character that `ok`
 * accepts; `literal` marks one written as a plain character, whose `ok` is a
 * comparison rather than a RegExp.
 * `star` consumes any run of characters `ok` accepts, none included. `dirs` is
 * a `**\/` in the middle: nothing, or any run that ends in `/`.
 */
type Step =
  | { kind: 'char'; ok: (c: string) => boolean; literal?: true }
  | { kind: 'star'; ok: (c: string) => boolean }
  | { kind: 'dirs' };
type CharStep = Extract<Step, { kind: 'char' }>;

export function wildmatch(pattern: string, options: { pathname?: boolean; caseFold?: boolean } = {}): Wildmatch {
  const pathname = options.pathname !== false;
  const caseFold = options.caseFold === true;
  const one = pathname ? notSlash : anything;
  const steps: Step[] = [];
  const scan = classScan(pattern);
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '\\' && i + 1 < pattern.length) {
      steps.push(literal(pattern[i + 1]!, caseFold));
      i += 2;
      continue;
    }
    if (c === '*') {
      let j = i;
      while (pattern[j] === '*') j++;
      const stars = j - i;
      const atStart = i === 0 || pattern[i - 1] === '/';
      const atEnd = j === pattern.length || pattern[j] === '/';
      if (pathname && stars >= 2 && atStart && atEnd) {
        if (j === pattern.length) {
          // A trailing `**` (or `dir/**`) matches everything below.
          steps.push({ kind: 'star', ok: anything });
        } else {
          // `**/` matches zero or more whole directories.
          steps.push({ kind: 'dirs' });
          j++;
        }
      } else {
        steps.push({ kind: 'star', ok: one });
      }
      i = j;
      continue;
    }
    if (c === '?') {
      steps.push({ kind: 'char', ok: one });
      i++;
      continue;
    }
    if (c === '[') {
      const cls = bracket(pattern, i, pathname, scan);
      if (cls) {
        steps.push({ kind: 'char', ok: single(cls.source, caseFold) });
        i = cls.end;
        continue;
      }
    }
    steps.push(literal(c, caseFold));
    i++;
  }
  return { test: walker(steps) };
}

/**
 * Walks a path through `steps` with every live position at once, one
 * character at a time, so no choice is ever revisited. A position is a step
 * index `k` (the next character may start step `k`; `steps.length` is the end
 * of the pattern), or `steps.length + 1 + k` for a `dirs` step `k` that has
 * begun a run, which must still end in `/`. The buffers belong to the matcher
 * and are reused by every call, which is safe because a call never yields.
 */
function walker(steps: readonly Step[]): (path: string) => boolean {
  const n = steps.length;
  let fewest = 0;
  let fixed = true;
  for (const step of steps) {
    if (step.kind === 'char') fewest++;
    else fixed = false;
  }
  // The plain characters the pattern starts and ends with, which every match
  // starts and ends with too. Most paths a walk meets fail on one of these
  // (`*.log` against `index.ts`), so most never reach the walk below.
  const plain = (step: Step | undefined) => step?.kind === 'char' && step.literal === true;
  let head = 0;
  while (head < n && plain(steps[head])) head++;
  let tail = 0;
  while (tail < n - head && plain(steps[n - 1 - tail])) tail++;
  const firsts = steps.slice(0, head).map((step) => (step as CharStep).ok);
  const lasts = steps.slice(n - tail).map((step) => (step as CharStep).ok);
  const ends = (path: string) => {
    for (let k = 0; k < head; k++) if (!firsts[k]!(path[k]!)) return false;
    const from = path.length - tail;
    for (let k = 0; k < tail; k++) if (!lasts[k]!(path[from + k]!)) return false;
    return true;
  };
  // `seen[s] === round` means position `s` is already live this character,
  // which keeps the list from ever holding one position twice.
  const seen = new Uint32Array(2 * n + 2);
  let live = new Int32Array(2 * n + 2);
  let next = new Int32Array(2 * n + 2);
  let size = 0;
  let round = 0;
  const begin = () => {
    if (++round === 0xffffffff) {
      seen.fill(0);
      round = 1;
    }
    size = 0;
  };
  const add = (position: number) => {
    // A `star` or `dirs` step can take no characters, so reaching it reaches
    // the step after it too. Those skips only move forward.
    while (seen[position] !== round) {
      seen[position] = round;
      next[size++] = position;
      if (position >= n || steps[position]!.kind === 'char') return;
      position++;
    }
  };
  return (path) => {
    // One character per `char` step, exactly that many when nothing repeats.
    if (path.length < fewest || (fixed && path.length !== n)) return false;
    if (!ends(path)) return false;
    begin();
    add(0);
    for (let p = 0; p < path.length; p++) {
      const c = path[p]!;
      const swap = live;
      live = next;
      next = swap;
      const count = size;
      begin();
      for (let i = 0; i < count; i++) {
        const position = live[i]!;
        if (position === n) continue;
        const k = position > n ? position - n - 1 : position;
        const step = steps[k]!;
        if (step.kind === 'dirs') {
          add(n + 1 + k);
          if (c === '/') add(k + 1);
        } else if (step.ok(c)) {
          add(step.kind === 'star' ? k : k + 1);
        }
      }
      if (size === 0) return false;
    }
    return seen[n] === round;
  };
}

const notSlash = (c: string) => c !== '/';
const anything = () => true;

/**
 * One literal character, folded the way a RegExp's `i` flag folds it. Without
 * the `u` flag, folding never maps a non-ASCII character onto an ASCII one, so
 * an ASCII character matches only its own two cases (`k` and `K`, never the
 * Kelvin sign) and a plain comparison does. Anything else asks a RegExp.
 */
function literal(c: string, caseFold: boolean): Step {
  if (!caseFold) return { kind: 'char', ok: (x) => x === c, literal: true };
  if (c.charCodeAt(0) < 0x80) {
    const lower = c.toLowerCase();
    const upper = c.toUpperCase();
    return { kind: 'char', ok: (x) => x === lower || x === upper, literal: true };
  }
  return { kind: 'char', ok: single(escape(c), caseFold), literal: true };
}

/**
 * A RegExp that accepts exactly one character, as a predicate. One atom
 * anchored at both ends can't backtrack, and it keeps the `i` flag's case
 * folding (and a class's ranges) exactly as they were when the whole pattern
 * was one RegExp.
 */
function single(source: string, caseFold: boolean): (c: string) => boolean {
  const regex = new RegExp(`^${source}$`, caseFold ? 'is' : 's');
  return (c) => regex.test(c);
}

const CLASSES: Record<string, string> = {
  alnum: 'a-zA-Z0-9',
  alpha: 'a-zA-Z',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f',
  digit: '0-9',
  graph: '\\x21-\\x7e',
  lower: 'a-z',
  print: '\\x20-\\x7e',
  punct: '!-\\/:-@\\[-`{-~',
  space: ' \\t\\n\\r\\f\\v',
  upper: 'A-Z',
  xdigit: '0-9a-fA-F',
};

/** The longest name in CLASSES, so a `[:` far from any `:]` is never sliced out to look up. */
const LONGEST_CLASS = Math.max(...Object.keys(CLASSES).map((name) => name.length));

/**
 * What `bracket` keeps between the classes of one pattern, so compiling it
 * stays linear. `dead[i]` marks a point that a class scan which never closed
 * passed through between two of its tokens: any later scan that reaches the
 * same point reads the same tokens from there, so it can't close either.
 * `colonClose[i]` is where the first `:]` at or after `i` starts, or -1, found
 * in one pass rather than searched for at every `[:`.
 */
interface ClassScan {
  dead: Uint8Array;
  colonClose: Int32Array | undefined;
  pattern: string;
}

function classScan(pattern: string): ClassScan {
  return { dead: new Uint8Array(pattern.length + 1), colonClose: undefined, pattern };
}

function colonCloseAt(scan: ClassScan, i: number): number {
  if (!scan.colonClose) {
    const { pattern } = scan;
    const close = new Int32Array(pattern.length + 1).fill(-1);
    for (let k = pattern.length - 2; k >= 0; k--) close[k] = pattern[k] === ':' && pattern[k + 1] === ']' ? k : close[k + 1]!;
    scan.colonClose = close;
  }
  return i < scan.colonClose.length ? scan.colonClose[i]! : -1;
}

/**
 * A `[...]` class starting at `start`, or undefined when it never closes (then
 * `[` is literal). A scan that fails marks every point it passed between
 * tokens as dead, and a later scan stops as soon as it reaches one, so across
 * a whole pattern each character is scanned past a bounded number of times.
 */
function bracket(pattern: string, start: number, pathname: boolean, scan: ClassScan): { source: string; end: number } | undefined {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') {
    negate = true;
    i++;
  }
  let body = '';
  let first = true;
  const passed: number[] = [];
  const fail = () => {
    for (const point of passed) scan.dead[point] = 1;
    return undefined;
  };
  while (i < pattern.length) {
    if (!first) {
      // The rest of this scan would read exactly what a failed one read from here.
      if (scan.dead[i] === 1) return fail();
      passed.push(i);
    }
    const c = pattern[i]!;
    if (c === ']' && !first) {
      // A negated class never matches `/` under pathname rules either.
      const source = negate ? `[^${body}${pathname ? '/' : ''}]` : `[${body}]`;
      return { source, end: i + 1 };
    }
    first = false;
    if (c === '[' && pattern[i + 1] === ':') {
      const close = colonCloseAt(scan, i + 2);
      const name = close === -1 || close - (i + 2) > LONGEST_CLASS ? undefined : pattern.slice(i + 2, close);
      if (name !== undefined && Object.hasOwn(CLASSES, name)) {
        body += CLASSES[name];
        i = close + 2;
        continue;
      }
    }
    if (c === '\\' && i + 1 < pattern.length) {
      body += escapeClass(pattern[i + 1]!);
      i += 2;
      continue;
    }
    if (c === '-' && body !== '' && pattern[i + 1] !== undefined && pattern[i + 1] !== ']') {
      body += '-';
      i++;
      continue;
    }
    body += escapeClass(c);
    i++;
  }
  return fail();
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const escapeClass = (c: string) => c.replace(/[\\\]^-]/g, '\\$&');
