import { QueryError } from './errors.js';
import { tokenize, type Token, type TokenType } from './lexer.js';

/**
 * A top-down operator-precedence (Pratt) parser for JMESPath, adapted to
 * strict TypeScript from the Apache-2.0 jmespath.js reference implementation
 * (see NOTICE). Each token has a binding power; `nud` handles a token that
 * starts an expression and `led` one that continues it. The tree it builds is
 * typed, so the interpreter can't meet a node it doesn't know. Binding power
 * decides who goes first, which committees otherwise settle by seniority.
 */

export type Comparator = 'EQ' | 'NE' | 'LT' | 'LTE' | 'GT' | 'GTE';

export type Node =
  | { type: 'Field'; name: string }
  | { type: 'Subexpression'; left: Node; right: Node }
  | { type: 'IndexExpression'; left: Node; right: Node }
  | { type: 'Index'; value: number }
  | { type: 'Slice'; start: number | null; stop: number | null; step: number | null }
  | { type: 'Projection'; left: Node; right: Node }
  | { type: 'ValueProjection'; left: Node; right: Node }
  | { type: 'FilterProjection'; left: Node; right: Node; condition: Node }
  | { type: 'Flatten'; child: Node }
  | { type: 'Identity' }
  | { type: 'Literal'; value: unknown }
  | { type: 'MultiSelectList'; children: Node[] }
  | { type: 'MultiSelectHash'; pairs: Array<{ key: string; value: Node }> }
  | { type: 'Comparator'; op: Comparator; left: Node; right: Node }
  | { type: 'Or'; left: Node; right: Node }
  | { type: 'And'; left: Node; right: Node }
  | { type: 'Not'; child: Node }
  | { type: 'Pipe'; left: Node; right: Node }
  | { type: 'Function'; name: string; args: Node[]; position: number }
  | { type: 'ExpressionReference'; child: Node };

const BINDING_POWER: Record<TokenType, number> = {
  EOF: 0,
  UnquotedIdentifier: 0,
  QuotedIdentifier: 0,
  Literal: 0,
  Rbracket: 0,
  Rparen: 0,
  Comma: 0,
  Rbrace: 0,
  Number: 0,
  Current: 0,
  Expref: 0,
  Colon: 0,
  Pipe: 1,
  Or: 2,
  And: 3,
  EQ: 5,
  GT: 5,
  LT: 5,
  GTE: 5,
  LTE: 5,
  NE: 5,
  Flatten: 9,
  Star: 20,
  Filter: 21,
  Dot: 40,
  Not: 45,
  Lbrace: 50,
  Lbracket: 55,
  Lparen: 60,
};

/** Below this, a projection's right-hand side is empty: the projection stops there. */
const PROJECTION_STOP = 10;

const IDENTITY: Node = { type: 'Identity' };

const describe = (token: Token): string => (token.type === 'EOF' ? 'the end of the expression' : `${JSON.stringify(String(token.value))}`);

export function parse(expression: string): Node {
  return new Parser(tokenize(expression)).parseAll();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseAll(): Node {
    const ast = this.expression(0);
    if (this.token().type !== 'EOF') this.fail(this.token(), `Unexpected ${describe(this.token())}`);
    return ast;
  }

  private token(offset = 0): Token {
    // The lexer always ends with EOF, and nothing reads past it.
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }


  private advance(): void {
    this.index++;
  }

  private fail(token: Token, message: string): never {
    throw new QueryError('syntax', `${message}.`, token.start);
  }

  private match(type: TokenType): void {
    if (this.token().type !== type) this.fail(this.token(), `Expected ${type}, found ${describe(this.token())}`);
    this.advance();
  }

  private expression(rbp: number): Node {
    const token = this.token();
    this.advance();
    let left = this.nud(token);
    while (rbp < BINDING_POWER[this.token().type]) {
      const next = this.token();
      this.advance();
      left = this.led(next, left);
    }
    return left;
  }

  private nud(token: Token): Node {
    switch (token.type) {
      case 'Literal':
        return { type: 'Literal', value: token.value };
      case 'UnquotedIdentifier':
        return { type: 'Field', name: token.value as string };
      case 'QuotedIdentifier':
        if (this.token().type === 'Lparen') this.fail(token, 'A quoted identifier can\'t name a function');
        return { type: 'Field', name: token.value as string };
      case 'Not':
        return { type: 'Not', child: this.expression(BINDING_POWER.Not) };
      case 'Star':
        return { type: 'ValueProjection', left: IDENTITY, right: this.token().type === 'Rbracket' ? IDENTITY : this.projectionRhs(BINDING_POWER.Star) };
      case 'Filter':
        return this.led(token, IDENTITY);
      case 'Lbrace':
        return this.multiSelectHash();
      case 'Flatten':
        return { type: 'Projection', left: { type: 'Flatten', child: IDENTITY }, right: this.projectionRhs(BINDING_POWER.Flatten) };
      case 'Lbracket': {
        const next = this.token().type;
        if (next === 'Number' || next === 'Colon') return this.projectIfSlice(IDENTITY, this.indexExpression());
        if (next === 'Star' && this.token(1).type === 'Rbracket') {
          this.advance();
          this.advance();
          return { type: 'Projection', left: IDENTITY, right: this.projectionRhs(BINDING_POWER.Star) };
        }
        return this.multiSelectList();
      }
      case 'Current':
        return IDENTITY;
      case 'Expref':
        return { type: 'ExpressionReference', child: this.expression(BINDING_POWER.Expref) };
      case 'Lparen': {
        const inner = this.expression(0);
        this.match('Rparen');
        return inner;
      }
      case 'EOF':
        return this.fail(token, 'The expression ends too soon');
      default:
        return this.fail(token, `Unexpected ${describe(token)}`);
    }
  }

  private led(token: Token, left: Node): Node {
    switch (token.type) {
      case 'Dot':
        if (this.token().type === 'Star') {
          this.advance();
          return { type: 'ValueProjection', left, right: this.projectionRhs(BINDING_POWER.Dot) };
        }
        return { type: 'Subexpression', left, right: this.dotRhs(BINDING_POWER.Dot) };
      case 'Pipe':
        return { type: 'Pipe', left, right: this.expression(BINDING_POWER.Pipe) };
      case 'Or':
        return { type: 'Or', left, right: this.expression(BINDING_POWER.Or) };
      case 'And':
        return { type: 'And', left, right: this.expression(BINDING_POWER.And) };
      case 'Lparen': {
        if (left.type !== 'Field') this.fail(token, 'Only a name can be called as a function');
        const args: Node[] = [];
        while (this.token().type !== 'Rparen') {
          args.push(this.expression(0));
          if (this.token().type === 'Comma') {
            this.advance();
            if (this.token().type === 'Rparen') this.fail(this.token(), 'Expected an argument after ","');
          } else if (this.token().type !== 'Rparen') {
            this.fail(this.token(), `Expected "," or ")", found ${describe(this.token())}`);
          }
        }
        this.match('Rparen');
        return { type: 'Function', name: left.name, args, position: token.start - left.name.length };
      }
      case 'Filter': {
        const condition = this.expression(0);
        this.match('Rbracket');
        const right = this.token().type === 'Flatten' ? IDENTITY : this.projectionRhs(BINDING_POWER.Filter);
        return { type: 'FilterProjection', left, right, condition };
      }
      case 'Flatten':
        return { type: 'Projection', left: { type: 'Flatten', child: left }, right: this.projectionRhs(BINDING_POWER.Flatten) };
      case 'EQ':
      case 'NE':
      case 'GT':
      case 'GTE':
      case 'LT':
      case 'LTE':
        return { type: 'Comparator', op: token.type, left, right: this.expression(BINDING_POWER[token.type]) };
      case 'Lbracket': {
        const next = this.token().type;
        if (next === 'Number' || next === 'Colon') return this.projectIfSlice(left, this.indexExpression());
        this.match('Star');
        this.match('Rbracket');
        return { type: 'Projection', left, right: this.projectionRhs(BINDING_POWER.Star) };
      }
      default:
        return this.fail(token, `Unexpected ${describe(token)}`);
    }
  }

  private indexExpression(): Node {
    if (this.token().type === 'Colon' || this.token(1).type === 'Colon') return this.sliceExpression();
    const token = this.token();
    this.match('Number');
    this.match('Rbracket');
    return { type: 'Index', value: token.value as number };
  }

  private projectIfSlice(left: Node, right: Node): Node {
    const indexed: Node = { type: 'IndexExpression', left, right };
    return right.type === 'Slice' ? { type: 'Projection', left: indexed, right: this.projectionRhs(BINDING_POWER.Star) } : indexed;
  }

  /** `[start:stop:step]`, each part optional, as is the second colon. */
  private sliceExpression(): Node {
    const parts: Array<number | null> = [null, null, null];
    let part = 0;
    while (this.token().type !== 'Rbracket') {
      const token = this.token();
      if (token.type === 'Colon') {
        part++;
        if (part > 2) this.fail(token, 'A slice has at most two ":"');
      } else if (token.type === 'Number') {
        if (parts[part] !== null) this.fail(token, 'Expected ":" or "]" in a slice');
        parts[part] = token.value as number;
      } else {
        this.fail(token, `Unexpected ${describe(token)} in a slice`);
      }
      this.advance();
    }
    this.match('Rbracket');
    return { type: 'Slice', start: parts[0]!, stop: parts[1]!, step: parts[2]! };
  }

  private dotRhs(rbp: number): Node {
    const next = this.token().type;
    if (next === 'UnquotedIdentifier' || next === 'QuotedIdentifier' || next === 'Star') return this.expression(rbp);
    if (next === 'Lbracket') {
      this.advance();
      return this.multiSelectList();
    }
    if (next === 'Lbrace') {
      this.advance();
      return this.multiSelectHash();
    }
    return this.fail(this.token(), `Expected a name, "*", "[" or "{" after ".", found ${describe(this.token())}`);
  }

  private projectionRhs(rbp: number): Node {
    const next = this.token().type;
    if (BINDING_POWER[next] < PROJECTION_STOP) return IDENTITY;
    if (next === 'Lbracket' || next === 'Filter') return this.expression(rbp);
    if (next === 'Dot') {
      this.advance();
      return this.dotRhs(rbp);
    }
    return this.fail(this.token(), `Unexpected ${describe(this.token())} after a projection`);
  }

  private multiSelectList(): Node {
    const children: Node[] = [];
    for (;;) {
      children.push(this.expression(0));
      if (this.token().type === 'Rbracket') break;
      this.match('Comma');
    }
    this.match('Rbracket');
    return { type: 'MultiSelectList', children };
  }

  private multiSelectHash(): Node {
    const pairs: Array<{ key: string; value: Node }> = [];
    for (;;) {
      const key = this.token();
      if (key.type !== 'UnquotedIdentifier' && key.type !== 'QuotedIdentifier') this.fail(key, `Expected a key name, found ${describe(key)}`);
      this.advance();
      this.match('Colon');
      pairs.push({ key: key.value as string, value: this.expression(0) });
      if (this.token().type === 'Rbrace') break;
      this.match('Comma');
    }
    this.match('Rbrace');
    return { type: 'MultiSelectHash', pairs };
  }
}
