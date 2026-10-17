import { ToilError, type ErrorCode } from './errors.js';

/**
 * The output contract: every command, through the CLI or MCP, produces exactly
 * one of these. Removing or renaming a field is a breaking change.
 */
export interface Meta {
  command: string;
  durationMs: number;
  version: string;
  /** Under --verbose: every request the command made, credentials redacted. */
  requests?: Array<{ method: string; url: string; status: number | null; durationMs: number }>;
  /**
   * Things the caller should know that aren't failures: a deprecated flag, a
   * config key that was ignored. Present only when there are some. This, not
   * stderr, is how an MCP client hears about them.
   */
  warnings?: Warning[];
  /** For paged results: where the next page starts. `data` keeps its shape. */
  page?: Page;
  /**
   * For an area command: which connection the call used and how it was
   * chosen, each context input's value and source, and any setting taken from
   * another area's connection. Never a secret's value.
   */
  context?: ContextReport;
}

/** Where a resolved value came from, highest precedence first. */
export type ContextSource = 'input' | 'dossier' | 'git' | 'connection' | 'default';

export interface ContextValue {
  value: string;
  source: ContextSource;
  /** For `connection`: the context input whose value selected it (`instance`). */
  via?: string;
  /** For `connection` from the default: named in `defaults.<area>`, named after the area, or the only one. */
  default?: 'named' | 'area-name' | 'only';
}

export interface ContextReport {
  connection?: ContextValue;
  /** Each context input that resolved. Absent when none did. */
  inputs?: Record<string, ContextValue>;
  /**
   * Settings taken from another area's connection, by key: which area and
   * connection, where that value lived (env, ci, the store, the file, or
   * `defaults` in the file), and whether the user paired the connections or it was the default
   * connection's env fallback. Never the value. Absent when none were.
   */
  shared?: Record<string, { area: string; connection: string; source: 'env' | 'ci' | 'store' | 'file' | 'defaults'; via: 'pairing' | 'env-fallback' }>;
}

export interface Warning {
  code: string;
  message: string;
}

/** The paging convention: an opaque cursor for the next page (null on the last) and the page size used. */
export interface Page {
  nextCursor: string | null;
  limit: number;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  fix?: string;
  details?: unknown;
}

export type Envelope<T = unknown> =
  | { ok: true; data: T; error: null; meta: Meta }
  | { ok: false; data: null; error: ErrorBody; meta: Meta };

export function success<T>(data: T, meta: Meta): Envelope<T> {
  return { ok: true, data, error: null, meta };
}

export function failure(err: ToilError, meta: Meta): Envelope<never> {
  const error: ErrorBody = { code: err.code, message: err.message };
  if (err.fix !== undefined) error.fix = err.fix;
  if (err.details !== undefined) error.details = err.details;
  return { ok: false, data: null, error, meta };
}
