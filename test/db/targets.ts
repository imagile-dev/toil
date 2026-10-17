import type { Settings } from '../../src/core/config.js';
import { encodeCursor, pageKey } from '../../src/core/db/paging.js';
import { createSqliteFile, sqliteRows } from '../harness/db.js';

/**
 * One entry per database engine the conformance suite runs against. Adding
 * PostgreSQL means adding a target here that starts from a seeded database
 * (SEED_SQL from test/harness/db.ts), not writing a new suite. A server
 * engine's target returns `skip` when its service container isn't reachable,
 * so offline runs stay green and say why.
 */
export interface DbTarget {
  engine: string;
  /** A reason to skip this target in this run, or undefined to run it. */
  skip?: () => string | undefined;
  /** A fresh, seeded database, and the connection settings that reach it (without `writes`). */
  setup: () => Promise<TargetDatabase>;
  /** The schema commands use when none is named. */
  defaultSchema: string;
  /** A connection key this engine requires, to check the "missing key" error names it. */
  requiredKey: string;
  sql: {
    /** A query returning the integers 1..n in a column named `x`, in order. */
    series: (n: number) => string;
    /**
     * A query that keeps running until cancelled, and how to call it. The call
     * must still be inside the query when the test aborts it, however the
     * engine streams rows.
     */
    slow: () => { sql: string; cursor?: string };
  };
}

export interface TargetDatabase {
  settings: Settings;
  /** Reads the database directly, outside toil, to check what a command did or didn't change. */
  rows: (sql: string) => Promise<unknown[]>;
  cleanup: () => Promise<void>;
}

const INFINITE = 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT x FROM n';

export const targets: DbTarget[] = [
  {
    engine: 'sqlite',
    defaultSchema: 'main',
    requiredKey: 'path',
    setup: async () => {
      const db = createSqliteFile();
      return { settings: { engine: 'sqlite', path: db.path }, rows: async (sql) => sqliteRows(db.path, sql), cleanup: async () => db.cleanup() };
    },
    sql: {
      series: (n) => `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${n}) SELECT x FROM n`,
      // node:sqlite has no interrupt, so a statement can only be stopped
      // between rows. An endless series read from a far-off cursor keeps the
      // worker stepping through rows it skips, which is exactly that.
      slow: () => ({ sql: INFINITE, cursor: encodeCursor(1e12, pageKey('db query', INFINITE)) }),
    },
  },
];
