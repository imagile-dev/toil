import { QueryError } from './errors.js';
import { checkFunctions, ExpressionReference, Interpreter } from './interpreter.js';
import { parse, type Node } from './parser.js';

/**
 * JMESPath, built into core rather than added as a dependency (CLAUDE.md, No
 * Executables): a lexer, a Pratt parser and a tree interpreter, adapted to
 * strict TypeScript from the Apache-2.0 jmespath.js reference implementation
 * and attributed in NOTICE. It passes the language's official compliance
 * suite, vendored under test/fixtures/jmespath/.
 *
 * `--select` uses it to cut an envelope's `data` down to what was asked for,
 * and anything else in core that needs to ask a question of JSON (a wait
 * condition) uses the same module, so there is one query language to learn.
 * One language, like one form, is the most any office should ask anyone to
 * learn.
 */

export { QueryError, type QueryErrorKind } from './errors.js';

export interface Query {
  /** The expression as written. */
  readonly expression: string;
  /** Applies the expression. Throws a QueryError of kind `invalid-type` or `invalid-value` when the data doesn't suit it. */
  search(data: unknown): unknown;
}

/**
 * Parses and checks an expression: syntax, function names and argument
 * counts. Throws a QueryError with the position of the problem, so a bad
 * expression is refused before any command runs.
 */
export function compileQuery(expression: string): Query {
  const ast: Node = parse(expression);
  checkFunctions(ast);
  const interpreter = new Interpreter();
  return {
    expression,
    search: (data) => {
      const result = interpreter.visit(ast, data);
      return result instanceof ExpressionReference ? null : result;
    },
  };
}

/** `compileQuery(expression).search(data)`, for a one-off. */
export function search(data: unknown, expression: string): unknown {
  return compileQuery(expression).search(data);
}

/** Whether a value is false in the language's sense: null, false, or an empty string, array or object. Numbers, 0 included, are true. */
export { isFalse } from './interpreter.js';

/** A message that shows where in the expression a QueryError points, for an error's fix. */
export function pointAt(expression: string, error: QueryError): string {
  if (error.position === undefined) return error.message;
  return `${error.message} At position ${error.position}: ${expression.slice(0, error.position)}>>>${expression.slice(error.position)}`;
}
