/**
 * git's glob dialect, as `.gitignore` and `includeIf "gitdir:..."` use it,
 * compiled to a RegExp. With `pathname` (git's WM_PATHNAME), `*`, `?` and
 * bracket classes never match `/`, and `**` between slashes matches any number
 * of directories, including none. Without it, `*` matches across slashes too.
 *
 * Forty years of shell globbing, and every tool still files its own variance.
 */
export function wildmatch(pattern: string, options: { pathname?: boolean; caseFold?: boolean } = {}): RegExp {
  const pathname = options.pathname !== false;
  const one = pathname ? '[^/]' : '.';
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '\\' && i + 1 < pattern.length) {
      out += escape(pattern[i + 1]!);
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
          out += '.*';
        } else {
          // `**/` matches zero or more whole directories.
          out += '(?:.*/)?';
          j++;
        }
      } else {
        out += `${one}*`;
      }
      i = j;
      continue;
    }
    if (c === '?') {
      out += one;
      i++;
      continue;
    }
    if (c === '[') {
      const cls = bracket(pattern, i, pathname);
      if (cls) {
        out += cls.source;
        i = cls.end;
        continue;
      }
    }
    out += escape(c);
    i++;
  }
  return new RegExp(`^${out}$`, options.caseFold ? 'is' : 's');
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
