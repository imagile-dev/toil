import { QueryError } from './errors.js';

/**
 * Turns a JMESPath expression into tokens. Adapted to strict TypeScript from
 * the Apache-2.0 jmespath.js reference implementation (see NOTICE), with the
 * corners the compliance suite checks filled in: a lone `=` or `-` is a syntax
 * error rather than a token nobody asked for, raw strings unescape every `\'`,
 * and every error says where in the expression it happened, a courtesy rarely
 * extended by a form returned for being filled in incorrectly.
 */

export type TokenType =
  | 'EOF'
  | 'UnquotedIdentifier'
  | 'QuotedIdentifier'
  | 'Rbracket'
  | 'Rparen'
  | 'Comma'
  | 'Colon'
  | 'Rbrace'
  | 'Number'
  | 'Current'
  | 'Expref'
  | 'Pipe'
  | 'Or'
  | 'And'
  | 'EQ'
  | 'GT'
  | 'LT'
  | 'GTE'
  | 'LTE'
  | 'NE'
  | 'Flatten'
  | 'Star'
  | 'Filter'
  | 'Dot'
  | 'Not'
  | 'Lbrace'
  | 'Lbracket'
  | 'Lparen'
  | 'Literal';

export interface Token {
  type: TokenType;
  /** The identifier's name, the number, or the literal's value; the source text for punctuation. */
  value: unknown;
  /** Index of the token's first character in the expression. */
  start: number;
}

const SINGLE: Record<string, TokenType> = {
  '.': 'Dot',
  '*': 'Star',
  ',': 'Comma',
  ':': 'Colon',
  '{': 'Lbrace',
  '}': 'Rbrace',
  ']': 'Rbracket',
  '(': 'Lparen',
  ')': 'Rparen',
  '@': 'Current',
};

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

const isAlpha = (ch: string | undefined) => ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_');
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9';
const isAlphaNum = (ch: string | undefined) => isAlpha(ch) || isDigit(ch);

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const push = (type: TokenType, value: unknown, start: number) => tokens.push({ type, value, start });

  while (at < expression.length) {
    const ch = expression[at]!;
    const start = at;
    if (isAlpha(ch)) {
      at++;
      while (isAlphaNum(expression[at])) at++;
      push('UnquotedIdentifier', expression.slice(start, at), start);
    } else if (SINGLE[ch] !== undefined) {
      push(SINGLE[ch], ch, start);
      at++;
    } else if (isDigit(ch) || ch === '-') {
      at++;
      while (isDigit(expression[at])) at++;
      const text = expression.slice(start, at);
      if (text === '-') throw new QueryError('syntax', 'A "-" must be followed by digits.', start);
      push('Number', Number.parseInt(text, 10), start);
    } else if (ch === '[') {
      at++;
      if (expression[at] === '?') {
        at++;
        push('Filter', '[?', start);
      } else if (expression[at] === ']') {
        at++;
        push('Flatten', '[]', start);
      } else {
        push('Lbracket', '[', start);
      }
    } else if (ch === '"') {
      at = delimited(expression, at, '"');
      try {
        push('QuotedIdentifier', JSON.parse(expression.slice(start, at)) as string, start);
      } catch {
        throw new QueryError('syntax', `Invalid quoted identifier ${expression.slice(start, at)}.`, start);
      }
    } else if (ch === "'") {
      at = delimited(expression, at, "'");
      // A raw string: only \' is an escape; every other backslash is kept as typed.
      push('Literal', expression.slice(start + 1, at - 1).replaceAll("\\'", "'"), start);
    } else if (ch === '`') {
      at = delimited(expression, at, '`');
      push('Literal', jsonLiteral(expression.slice(start + 1, at - 1).replaceAll('\\`', '`'), start), start);
    } else if (ch === '<' || ch === '>' || ch === '!' || ch === '=') {
      at++;
      const equals = expression[at] === '=';
      if (equals) at++;
      if (ch === '=' && !equals) throw new QueryError('syntax', 'A single "=" isn\'t an operator; compare with "==".', start);
      const type: TokenType = ch === '<' ? (equals ? 'LTE' : 'LT') : ch === '>' ? (equals ? 'GTE' : 'GT') : ch === '!' ? (equals ? 'NE' : 'Not') : 'EQ';
      push(type, expression.slice(start, at), start);
    } else if (ch === '&' || ch === '|') {
      at++;
      if (expression[at] === ch) {
        at++;
        push(ch === '&' ? 'And' : 'Or', ch + ch, start);
      } else {
        push(ch === '&' ? 'Expref' : 'Pipe', ch, start);
      }
    } else if (WHITESPACE.has(ch)) {
      at++;
    } else {
      throw new QueryError('syntax', `Unexpected character ${JSON.stringify(ch)}.`, start);
    }
  }
  push('EOF', '', expression.length);
  return tokens;
}

/**
 * The index just past the closing `quote` of a token starting at `start`. A
 * backslash keeps the next character from closing it.
 */
function delimited(expression: string, start: number, quote: string): number {
  let at = start + 1;
  while (at < expression.length && expression[at] !== quote) at += expression[at] === '\\' && at + 1 < expression.length ? 2 : 1;
  if (at >= expression.length) throw new QueryError('syntax', `Unterminated ${quote} starting here.`, start);
  return at + 1;
}

/**
 * A backtick literal is JSON. The older spelling with an unquoted string
 * inside (`` `foo` ``) is still accepted, as the language's own suite expects.
 */
function jsonLiteral(text: string, start: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(`"${text.trimStart()}"`);
    } catch {
      throw new QueryError('syntax', `Invalid JSON literal \`${text}\`.`, start);
    }
  }
}
