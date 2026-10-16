/**
 * Every failure a user can see is a ToilError: a stable code, a message, and a
 * fix they can act on. Anything else that escapes a command is wrapped as
 * INTERNAL so the envelope never carries a raw stack trace. A stack trace in a
 * ticket gets reassigned to three teams and resolved by none of them.
 */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONFIGURED'
  | 'CONFIG_INVALID'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'HTTP'
  | 'NETWORK'
  | 'WRITE_DISABLED'
  | 'INTERNAL';

export class ToilError extends Error {
  readonly code: ErrorCode;
  readonly fix: string | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: { fix?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'ToilError';
    this.code = code;
    this.fix = options.fix;
    this.details = options.details;
  }
}

export function toToilError(err: unknown): ToilError {
  if (err instanceof ToilError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ToilError('INTERNAL', message, {
    fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues with the command you ran.',
  });
}
