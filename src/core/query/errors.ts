/**
 * What can go wrong with a JMESPath expression, in the five kinds the
 * language's compliance suite names. `syntax`, `invalid-arity` and
 * `unknown-function` are found when the expression is compiled, before any
 * command runs; `invalid-type` and `invalid-value` only once there is data to
 * apply it to. Five kinds of rejection, each with a reason attached, which puts
 * it ahead of most approval workflows.
 */
export type QueryErrorKind = 'syntax' | 'invalid-type' | 'invalid-value' | 'invalid-arity' | 'unknown-function';

export class QueryError extends Error {
  constructor(
    readonly kind: QueryErrorKind,
    message: string,
    /** Where in the expression it went wrong, counted in characters from 0. Absent for errors found while evaluating. */
    readonly position?: number,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}
