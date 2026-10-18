/**
 * A small lexer for the languages `util size` outlines: TypeScript,
 * JavaScript, Python, C#, Java and Go. It knows each language's comments and
 * string forms (template literals with `${}`, C# verbatim, raw and
 * interpolated strings, Java text blocks, Go raw strings, Python triple
 * quotes) and nothing else, which is all an outline needs: once comments and
 * strings are out of the way, braces, parentheses and names can be read as
 * written. JavaScript's regular expression literals are told from division
 * by the token before them, the way every editor without a parser does it.
 *
 * What it can't read, it says: a string or comment that never closes is an
 * OutlineError naming the line, never a guess about where it ended. The
 * lexer has no opinion on whether the code compiles, a position it shares
 * with most change advisory boards.
 */

export type CodeLanguage = 'typescript' | 'javascript' | 'python' | 'csharp' | 'java' | 'go';

/** The outline could not be built: the message says why and where. */
export class OutlineError extends Error {}

export interface Token {
  /** `id` an identifier or keyword, `p` punctuation, `str` a string, character or regex literal, `num` a number. */
  t: 'id' | 'p' | 'str' | 'num';
  v: string;
  /** 1-based line the token starts on. */
  line: number;
  /** Line it ends on (a multi-line string ends later). */
  endLine: number;
  /** Column (0-based) the token starts at. */
  col: number;
  /** Whether it is the first token on its line. */
  nl: boolean;
}

/** Punctuation read as one token, longest first. `>>` is not one: generics close with it. */
const MULTI = ['===', '!==', '...', '=>', '->', '==', '!=', '<=', '>=', '::', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '&&', '||', '??', '?.', ':=', '++', '--'];

/** Tokens after which a `/` starts a regular expression rather than dividing. */
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const DIVIDE_AFTER_PUNCT = new Set([')', ']', '}', '++', '--']);

const isIdStart = (c: string) => /[A-Za-z_$À-￿]/.test(c);
const isIdPart = (c: string) => /[\w$À-￿]/.test(c);

/** Every token in `src`, with comments and whitespace left out. Throws OutlineError on an unterminated string or comment. */
export function lex(src: string, lang: CodeLanguage): Token[] {
  const js = lang === 'typescript' || lang === 'javascript';
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let lastEnd = 0;

  const newline = () => {
    line++;
    lineStart = i + 1;
  };
  const emit = (t: Token['t'], v: string, startLine: number, col: number) => {
    tokens.push({ t, v, line: startLine, endLine: line, col, nl: startLine > lastEnd });
    lastEnd = line;
  };
  const unterminated = (what: string, at: number): never => {
    throw new OutlineError(`${what} opened on line ${at} is never closed`);
  };

  /** A string closed by `quote` on the same line, with backslash escapes. */
  const quoted = (quote: string, what: string) => {
    const at = line;
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') {
        if (src[i + 1] === '\n') {
          i++;
          newline();
        }
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        return;
      }
      if (c === '\n') throw new OutlineError(`${what} opened on line ${at} isn't closed by the end of that line`);
      i++;
    }
    unterminated(what, at);
  };

  /** Runs until `close` (inclusive), counting lines, with no escapes. */
  const until = (close: string, what: string, at: number) => {
    while (i < src.length) {
      if (src.startsWith(close, i)) {
        i += close.length;
        return;
      }
      if (src[i] === '\n') newline();
      i++;
    }
    unterminated(what, at);
  };

  /** Code inside a `${…}` or C# `{…}` hole, up to and including its closing brace. Its tokens are part of the string. */
  const hole = () => {
    const at = line;
    const keep = tokens.length;
    const saved = lastEnd;
    let depth = 0;
    while (i < src.length) {
      const before = tokens.length;
      step();
      const tok = tokens[before];
      if (tokens.length > before && tok?.t === 'p') {
        if (tok.v === '{') depth++;
        else if (tok.v === '}') {
          if (depth === 0) {
            tokens.length = keep;
            lastEnd = saved;
            return;
          }
          depth--;
        }
      }
    }
    tokens.length = keep;
    lastEnd = saved;
    throw new OutlineError(`an interpolation opened on line ${at} is never closed`);
  };

  const template = () => {
    const at = line;
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') {
        if (src[i + 1] === '\n') {
          i++;
          newline();
        }
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        hole();
        continue;
      }
      if (c === '\n') newline();
      i++;
    }
    unterminated('a template literal', at);
  };

  /** A C# string starting at `i` (any of `$`, `@`, `"`), in every form the language has. */
  const csharpString = () => {
    const at = line;
    let dollars = 0;
    let verbatim = false;
    while (src[i] === '$' || src[i] === '@') {
      if (src[i] === '$') dollars++;
      else verbatim = true;
      i++;
    }
    let quotes = 0;
    while (src[i + quotes] === '"') quotes++;
    if (quotes >= 3) {
      // A raw string literal: closed by as many quotes as opened it. Its holes can't contain that many.
      const close = '"'.repeat(quotes);
      i += quotes;
      until(close, 'a raw string', at);
      while (src[i] === '"') i++;
      return;
    }
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (verbatim) {
        if (c === '"') {
          if (src[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          return;
        }
      } else {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          return;
        }
        if (c === '\n') throw new OutlineError(`a string opened on line ${at} isn't closed by the end of that line`);
      }
      if (dollars > 0 && c === '{') {
        if (src[i + 1] === '{') {
          i += 2;
          continue;
        }
        i++;
        hole();
        continue;
      }
      if (c === '\n') newline();
      i++;
    }
    unterminated('a string', at);
  };

  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.t === 'num' || prev.t === 'str') return false;
    if (prev.t === 'id') return REGEX_AFTER_KEYWORD.has(prev.v);
    return !DIVIDE_AFTER_PUNCT.has(prev.v);
  };

  const regex = () => {
    const at = line;
    i++;
    let inClass = false;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\n') throw new OutlineError(`a regular expression opened on line ${at} isn't closed by the end of that line`);
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++;
        while (i < src.length && isIdPart(src[i]!)) i++;
        return;
      }
      i++;
    }
    unterminated('a regular expression', at);
  };

  /** Reads one token, or skips one stretch of whitespace or one comment. */
  function step(): void {
    const c = src[i]!;
    const start = i;
    const startLine = line;
    const col = i - lineStart;
    if (c === '\n') {
      newline();
      i++;
      return;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\ufeff') {
      i++;
      return;
    }
    // Comments.
    if (lang === 'python' ? c === '#' : c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      return;
    }
    if (lang !== 'python' && c === '/' && src[i + 1] === '*') {
      i += 2;
      until('*/', 'a block comment', startLine);
      return;
    }
    // A C# preprocessor directive takes its whole line.
    if (lang === 'csharp' && c === '#' && src.slice(lineStart, i).trim() === '') {
      while (i < src.length && src[i] !== '\n') i++;
      return;
    }
    // Strings.
    if (lang === 'python') {
      const prefix = /^[rRbBuUfF]{0,2}(?='|")/.exec(src.slice(i, i + 3));
      if (prefix && (prefix[0] === '' || !isIdPart(src[i - 1] ?? ' '))) {
        i += prefix[0].length;
        const q = src[i]!;
        if (src.startsWith(q.repeat(3), i)) {
          i += 3;
          until(q.repeat(3), 'a triple-quoted string', startLine);
        } else quoted(q, 'a string');
        emit('str', src.slice(start, i), startLine, col);
        return;
      }
    } else if (lang === 'csharp' && (c === '"' || ((c === '$' || c === '@') && /^[$@]*"/.test(src.slice(i, i + 4))))) {
      csharpString();
      emit('str', src.slice(start, i), startLine, col);
      return;
    } else if (lang === 'java' && c === '"' && src.startsWith('"""', i)) {
      i += 3;
      until('"""', 'a text block', startLine);
      emit('str', src.slice(start, i), startLine, col);
      return;
    } else if (c === '"' || c === "'") {
      quoted(c, c === "'" && !js ? 'a character literal' : 'a string');
      emit('str', src.slice(start, i), startLine, col);
      return;
    } else if (c === '`' && (js || lang === 'go')) {
      if (js) template();
      else {
        i++;
        until('`', 'a raw string', startLine);
      }
      emit('str', src.slice(start, i), startLine, col);
      return;
    }
    if (js && c === '/' && regexAllowed()) {
      regex();
      emit('str', src.slice(start, i), startLine, col);
      return;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j]!)) j++;
      const v = src.slice(i, j);
      i = j;
      emit('id', v, startLine, col);
      return;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) j++;
      i = j;
      emit('num', '', startLine, col);
      return;
    }
    for (const m of MULTI) {
      if (src.startsWith(m, i)) {
        i += m.length;
        emit('p', m, startLine, col);
        return;
      }
    }
    i++;
    emit('p', c, startLine, col);
  }

  while (i < src.length) step();
  return tokens;
}
