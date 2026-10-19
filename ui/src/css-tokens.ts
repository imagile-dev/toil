/**
 * A CSS tokenizer, following CSS Syntax Level 3, section 4
 * (https://www.w3.org/TR/css-syntax-3/#tokenization), so a user theme's
 * stylesheet is checked as the browser reads it: escapes decoded, strings
 * and `url()` taken whole, comments dropped. A regular expression over the
 * raw text can be walked past with a backslash or a quoted parenthesis; this
 * can't, because it reads the text the same way the browser does.
 *
 * It keeps only what the theme rules need: each token's kind and decoded
 * value. Numbers, dimensions and the like come out as `other`, and a
 * malformed string or url comes out as `bad-string` or `bad-url`, which the
 * rules refuse.
 */

export type CssToken =
  | { type: 'ident' | 'function' | 'at-keyword' | 'hash' | 'string' | 'url'; value: string }
  | { type: 'bad-string' | 'bad-url' | 'whitespace' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ':' | ';' | 'cdo' | 'cdc' }
  | { type: 'delim' | 'other'; value: string };

const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isNewline = (c: string | undefined) => c === '\n';
const isWhitespace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n';
const isNameStart = (c: string | undefined) => c !== undefined && (/^[a-zA-Z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined) => isNameStart(c) || (c !== undefined && /^[0-9-]$/.test(c));
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isNonPrintable = (c: string | undefined) => {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  return n <= 0x08 || n === 0x0b || (n >= 0x0e && n <= 0x1f) || n === 0x7f;
};

/** Preprocessing (section 3.3): line endings to \n, NUL and surrogates to U+FFFD. */
function preprocess(css: string): string {
  return css.replace(/\r\n|\r|\f/g, '\n').replace(/\0/g, '�');
}

export function tokenize(input: string): CssToken[] {
  const s = [...preprocess(input)];
  const out: CssToken[] = [];
  let i = 0;
  const at = (k = 0) => s[i + k];

  const validEscape = (a: string | undefined, b: string | undefined) => a === '\\' && !isNewline(b);
  const startsIdent = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    a === '-' ? isNameStart(b) || b === '-' || validEscape(b, c) : isNameStart(a) ? true : a === '\\' ? validEscape(a, b) : false;
  const startsNumber = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    a === '+' || a === '-' ? isDigit(b) || (b === '.' && isDigit(c)) : a === '.' ? isDigit(b) : isDigit(a);

  /** 4.3.7: the character after a backslash, decoded. */
  function escape(): string {
    const c = s[i++];
    if (c === undefined) return '�';
    if (!isHex(c)) return c;
    let hex = c;
    while (hex.length < 6 && isHex(at())) hex += s[i++];
    if (isWhitespace(at())) i++;
    const n = parseInt(hex, 16);
    return n === 0 || (n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff ? '�' : String.fromCodePoint(n);
  }

  /** 4.3.11: a name, with escapes decoded. */
  function name(): string {
    let v = '';
    for (;;) {
      const c = at();
      if (isName(c)) {
        v += c;
        i++;
      } else if (validEscape(c, at(1))) {
        i++;
        v += escape();
      } else return v;
    }
  }

  /** 4.3.5: a string, up to its closing quote. A raw newline makes it a bad string. */
  function string(quote: string): CssToken {
    let v = '';
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === quote) return { type: 'string', value: v };
      if (isNewline(c)) {
        i--;
        return { type: 'bad-string' };
      }
      if (c === '\\') {
        if (at() === undefined) continue;
        if (isNewline(at())) i++;
        else v += escape();
      } else v += c;
    }
  }

  /** 4.3.14: the rest of a bad url, so tokenizing can carry on. */
  function badUrlRemnants(): void {
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === ')') return;
      if (validEscape(c, at())) escape();
    }
  }

  /** 4.3.6: an unquoted url(), after `url(` and any whitespace. */
  function url(): CssToken {
    let v = '';
    while (isWhitespace(at())) i++;
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === ')') return { type: 'url', value: v };
      if (isWhitespace(c)) {
        while (isWhitespace(at())) i++;
        if (at() === ')' || at() === undefined) {
          i++;
          return { type: 'url', value: v };
        }
        badUrlRemnants();
        return { type: 'bad-url' };
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        badUrlRemnants();
        return { type: 'bad-url' };
      }
      if (c === '\\') {
        if (validEscape(c, at())) v += escape();
        else {
          badUrlRemnants();
          return { type: 'bad-url' };
        }
      } else v += c;
    }
  }

  /** 4.3.4: an ident, a function, or url(). */
  function identLike(): CssToken {
    const v = name();
    if (v.toLowerCase() === 'url' && at() === '(') {
      i++;
      // Look past whitespace: a quoted url is a function token whose argument is a string.
      let k = 0;
      while (isWhitespace(at(k)) && isWhitespace(at(k + 1))) k++;
      const next = isWhitespace(at(k)) ? at(k + 1) : at(k);
      if (next === '"' || next === "'") {
        i += k;
        return { type: 'function', value: v };
      }
      return url();
    }
    if (at() === '(') {
      i++;
      return { type: 'function', value: v };
    }
    return { type: 'ident', value: v };
  }

  /** 4.3.12: a number, and its unit or percent sign. */
  function numeric(): CssToken {
    let v = '';
    if (at() === '+' || at() === '-') v += s[i++];
    while (isDigit(at())) v += s[i++];
    if (at() === '.' && isDigit(at(1))) {
      v += s[i++];
      while (isDigit(at())) v += s[i++];
    }
    if ((at() === 'e' || at() === 'E') && (isDigit(at(1)) || ((at(1) === '+' || at(1) === '-') && isDigit(at(2))))) {
      v += s[i++] + s[i++]!;
      while (isDigit(at())) v += s[i++];
    }
    if (startsIdent(at(), at(1), at(2))) v += name();
    else if (at() === '%') v += s[i++];
    return { type: 'other', value: v };
  }

  while (i < s.length) {
    const c = at();
    if (c === '/' && at(1) === '*') {
      let j = i + 2;
      while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++;
      i = j < s.length ? j + 2 : s.length;
      continue;
    }
    if (isWhitespace(c)) {
      while (isWhitespace(at())) i++;
      out.push({ type: 'whitespace' });
    } else if (c === '"' || c === "'") {
      i++;
      out.push(string(c));
    } else if (c === '#') {
      if (isName(at(1)) || validEscape(at(1), at(2))) {
        i++;
        out.push({ type: 'hash', value: name() });
      } else out.push({ type: 'delim', value: s[i++]! });
    } else if (c === '(' || c === ')' || c === '[' || c === ']' || c === '{' || c === '}' || c === ',' || c === ':' || c === ';') {
      i++;
      out.push({ type: c });
    } else if (c === '+' || c === '.') {
      if (startsNumber(c, at(1), at(2))) out.push(numeric());
      else out.push({ type: 'delim', value: s[i++]! });
    } else if (c === '-') {
      if (startsNumber(c, at(1), at(2))) out.push(numeric());
      else if (at(1) === '-' && at(2) === '>') {
        i += 3;
        out.push({ type: 'cdc' });
      } else if (startsIdent(c, at(1), at(2))) out.push(identLike());
      else out.push({ type: 'delim', value: s[i++]! });
    } else if (c === '<' && at(1) === '!' && at(2) === '-' && at(3) === '-') {
      i += 4;
      out.push({ type: 'cdo' });
    } else if (c === '@') {
      i++;
      if (startsIdent(at(), at(1), at(2))) out.push({ type: 'at-keyword', value: name() });
      else out.push({ type: 'delim', value: '@' });
    } else if (c === '\\') {
      if (validEscape(c, at(1))) out.push(identLike());
      else out.push({ type: 'delim', value: s[i++]! });
    } else if (isDigit(c)) {
      out.push(numeric());
    } else if (isNameStart(c)) {
      out.push(identLike());
    } else {
      out.push({ type: 'delim', value: s[i++]! });
    }
  }
  return out;
}
