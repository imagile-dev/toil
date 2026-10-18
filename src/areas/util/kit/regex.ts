/**
 * Why a regular expression from a document may not be run, or undefined when
 * it's safe to. JavaScript has no regex timeout, and a backtracking engine
 * can take exponential time on a short string (`^(a+)+$` against
 * `aaaa…!`), so a document's patterns are checked by their shape before any
 * is run. Flagged:
 *   - a backreference (`\1`, `\k<name>`)
 *   - a repeated group that itself holds a repetition: `(a+)+`, `(.*a){12}`
 *   - a repeated alternation whose branches can start alike: `(a|aa)*`
 *   - three or more unbounded repetitions of a character class or `.`
 *     (`.*,.*,.*`), polynomial at best on a long string
 * Conservative: a few safe patterns are flagged too, and those are reported
 * unchecked rather than run. A pattern that doesn't parse is flagged. A
 * regex reviewed before it's run: the one approval process that saves time.
 */
export function regexRisk(source: string): string | undefined {
  if (/\\[1-9]|\\k</.test(source)) return 'it uses a backreference, which can take exponential time to match';
  type Quant = { min: number; max: number };
  type Item = { wide: boolean; first: string; quant?: Quant; group?: Group };
  type Group = { branches: Item[][]; quant?: Quant };
  const root: Group = { branches: [[]] };
  const stack: Group[] = [root];
  const top = () => stack[stack.length - 1]!;
  const branch = () => top().branches[top().branches.length - 1]!;
  let unboundedWide = 0;
  let i = 0;
  const readQuant = (): Quant | undefined => {
    const c = source[i];
    let q: Quant | undefined;
    if (c === '*') q = { min: 0, max: Infinity };
    else if (c === '+') q = { min: 1, max: Infinity };
    else if (c === '?') q = { min: 0, max: 1 };
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!m) return undefined;
      i += m[0].length - 1;
      q = { min: Number(m[1]), max: m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]) };
    }
    if (!q) return undefined;
    i++;
    if (source[i] === '?') i++;
    return q;
  };
  const repeats = (q?: Quant) => q !== undefined && q.max > 1;
  // A repetition inside a repeated group is ambiguous only when its count varies: (x{4})* has one way to match, (x+)* has many.
  const varies = (q?: Quant) => q !== undefined && q.max > q.min;
  const holdsRepeat = (g: Group): boolean => g.branches.some((b) => b.some((it) => varies(it.quant) || (it.group !== undefined && holdsRepeat(it.group))));
  /** The first character a branch can match: a literal, or '' for anything wide (a class, `.`, an escape, a group). */
  const firstOf = (b: Item[]): string => (b.length === 0 ? '' : b[0]!.wide ? '' : b[0]!.first);
  const close = (g: Group): string | undefined => {
    if (!repeats(g.quant)) return undefined;
    if (holdsRepeat(g)) return 'it repeats a group that itself repeats, which can take exponential time to match';
    if (g.branches.length > 1) {
      const firsts = g.branches.map(firstOf);
      if (firsts.includes('') || new Set(firsts).size < firsts.length) return 'it repeats an alternation whose branches can match the same text, which can take exponential time to match';
    }
    return undefined;
  };
  try {
    while (i < source.length) {
      const c = source[i]!;
      if (c === '(') {
        i++;
        if (source[i] === '?') {
          // (?:…), (?=…), (?!…), (?<=…), (?<!…), (?<name>…)
          const m = /^\?(:|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(source.slice(i));
          if (!m) return 'it uses a group syntax this check does not read';
          i += m[0].length;
        }
        const g: Group = { branches: [[]] };
        branch().push({ wide: true, first: '', group: g });
        stack.push(g);
        continue;
      }
      if (c === ')') {
        if (stack.length === 1) return "it doesn't parse: a ) with no (";
        const g = stack.pop()!;
        i++;
        const q = readQuant();
        const item = branch()[branch().length - 1]!;
        if (q) {
          item.quant = q;
          g.quant = q;
        }
        const risk = close(g);
        if (risk) return risk;
        continue;
      }
      if (c === '|') {
        top().branches.push([]);
        i++;
        continue;
      }
      if (c === '^' || c === '$') {
        i++;
        continue;
      }
      let item: Item;
      if (c === '[') {
        let j = i + 1;
        if (source[j] === '^') j++;
        if (source[j] === ']') j++;
        while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1;
        if (j >= source.length) return "it doesn't parse: a [ with no ]";
        i = j + 1;
        item = { wide: true, first: '' };
      } else if (c === '\\') {
        const e = source[i + 1] ?? '';
        if (e === 'b' || e === 'B') {
          i += 2;
          continue;
        }
        const m = /^\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z]|[pP]\{[^}]*\}|.)/.exec(source.slice(i));
        if (!m) return "it doesn't parse: a \\ at the end";
        i += m[0].length;
        item = /^[dDwWsSpP]/.test(m[1]!) ? { wide: true, first: '' } : { wide: false, first: m[1]! };
      } else if (c === '.') {
        i++;
        item = { wide: true, first: '' };
      } else {
        i++;
        item = { wide: false, first: c };
      }
      const q = readQuant();
      if (q) {
        item.quant = q;
        if (item.wide && q.max === Infinity && ++unboundedWide >= 3) return 'it repeats three or more character classes without limit, which can take polynomial time to match a long string';
      }
      branch().push(item);
    }
    if (stack.length > 1) return "it doesn't parse: a ( with no )";
  } catch {
    return "it doesn't parse";
  }
  return undefined;
}
