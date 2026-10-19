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
 * match costs O(steps x path length), whatever the pattern says.
 *
 * Forty years of shell globbing, and every tool still files its own variance.
 */
export interface Wildmatch {
  /** Whether the whole of `path` matches the pattern. */
  test(path: string): boolean;
}

/**
 * One step of a compiled pattern. `char` consumes one character that `ok`
 * accepts; `exact` is that character when only one, case and all, will do.
 * `star` consumes any run of characters `ok` accepts, none included. `dirs` is
 * a `**\/` in the middle: nothing, or any run that ends in `/`.
 */
type Step =
  | { kind: 'char'; ok: (c: string) => boolean; exact?: string }
  | { kind: 'star'; ok: (c: string) => boolean }
  | { kind: 'dirs' };

export function wildmatch(pattern: string, options: { pathname?: boolean; caseFold?: boolean } = {}): Wildmatch {
  const pathname = options.pathname !== false;
  const caseFold = options.caseFold === true;
  const one = pathname ? notSlash : anything;
  const steps: Step[] = [];
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
      const cls = bracket(pattern, i, pathname);
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
  // The exact characters the pattern starts and ends with, which every match
  // starts and ends with too. Most paths a walk meets fail on one of these
  // (`*.log` against `index.ts`), so most never reach the walk below.
  let prefix = '';
  for (let k = 0; k < n; k++) {
    const step = steps[k]!;
    if (step.kind !== 'char' || step.exact === undefined) break;
    prefix += step.exact;
  }
  let suffix = '';
  for (let k = n - 1; k >= 0; k--) {
    const step = steps[k]!;
    if (step.kind !== 'char' || step.exact === undefined) break;
    suffix = step.exact + suffix;
  }
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
    if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
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

/** One literal character, folded the way a RegExp's `i` flag folds it. */
function literal(c: string, caseFold: boolean): Step {
  if (caseFold) return { kind: 'char', ok: single(escape(c), caseFold) };
  return { kind: 'char', ok: (x) => x === c, exact: c };
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

/** A `[...]` class starting at `start`, or undefined when it never closes (then `[` is literal). */
function bracket(pattern: string, start: number, pathname: boolean): { source: string; end: number } | undefined {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') {
    negate = true;
    i++;
  }
  let body = '';
  let first = true;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === ']' && !first) {
      // A negated class never matches `/` under pathname rules either.
      const source = negate ? `[^${body}${pathname ? '/' : ''}]` : `[${body}]`;
      return { source, end: i + 1 };
    }
    first = false;
    if (c === '[' && pattern[i + 1] === ':') {
      const close = pattern.indexOf(':]', i + 2);
      const name = close === -1 ? undefined : pattern.slice(i + 2, close);
      if (name !== undefined && CLASSES[name] !== undefined) {
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
  return undefined;
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const escapeClass = (c: string) => c.replace(/[\\\]^-]/g, '\\$&');
