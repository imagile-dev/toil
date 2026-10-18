import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Settings } from '../../src/core/config.js';
import { encodeCursor, pageKey } from '../../src/core/db/paging.js';
import { createSqliteFile, SEED_SQL, sqliteRows } from '../harness/db.js';

/**
 * One entry per database engine the conformance suite runs against. Adding
 * PostgreSQL means adding a target here that starts from a seeded database
 * (SEED_SQL from test/harness/db.ts), not writing a new suite. A server
 * engine's target returns `skip` when its service container isn't reachable,
 * so offline runs stay green and say why.
 *
 * Each server engine reads one URL from the environment, defaulting to the CI
 * service container's (`TOIL_TEST_PG_URL`, and so on). Unset and unreachable
 * is a skip. Set and unreachable is a failure: whoever set it meant the run to
 * happen, and `npm run test:integration` in CI always sets it.
 */
export interface DbTarget {
  engine: string;
  /** The suite's name for this target, when one engine has several (MySQL and MariaDB). Defaults to `engine`. */
  name?: string;
  /** A reason to skip this target in this run, or undefined to run it. Throws when the run was asked for and can't happen. */
  skip?: () => Promise<string | undefined> | string | undefined;
  /** A fresh, seeded database, and the connection settings that reach it (without `writes`). */
  setup: () => Promise<TargetDatabase>;
  /** The schema commands use when none is named, unless the database says (`TargetDatabase.schema`). */
  defaultSchema?: string;
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
  /** The schema commands use when none is named, where it depends on the database (MySQL's is the database itself). */
  schema?: string;
  /** Reads the database directly, outside toil, to check what a command did or didn't change. */
  rows: (sql: string) => Promise<unknown[]>;
  /**
   * Server engines: how many of toil's statements are still running on the
   * server against this database. After a cancel or a time limit it must
   * reach 0, which proves the provider stopped the statement on the server
   * rather than only giving up waiting for it.
   */
  running?: () => Promise<number>;
  cleanup: () => Promise<void>;
}

/** A server engine's test URL: the env var, else the CI service container's. `explicit` says whether the env var set it. */
function serverUrl(envVar: string, ciDefault: string): { url: URL; explicit: boolean } {
  const value = process.env[envVar];
  return { url: new URL(value || ciDefault), explicit: Boolean(value) };
}

/** Skip when the server isn't there, unless the env var asked for it; then fail, naming the var. */
async function probe(engine: string, envVar: string, explicit: boolean, reach: () => Promise<void>): Promise<string | undefined> {
  try {
    await reach();
    return undefined;
  } catch (err) {
    const why = (err as Error).message || (err as { code?: string }).code || String(err);
    if (explicit) throw new Error(`${envVar} is set, but ${engine} isn't reachable there: ${why}`, { cause: err });
    return `no ${engine} server (${why}); set ${envVar} to run it`;
  }
}

const PG_ENV = 'TOIL_TEST_PG_URL';
const pgTarget = serverUrl(PG_ENV, 'postgres://postgres:postgres@localhost:5432/postgres');

function pgClient(database?: string): pg.Client {
  const { url } = pgTarget;
  return new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: database ?? url.pathname.slice(1),
    connectionTimeoutMillis: 3000,
  });
}

async function withPg<T>(database: string | undefined, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = pgClient(database);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const MYSQL_ENV = 'TOIL_TEST_MYSQL_URL';
const MARIADB_ENV = 'TOIL_TEST_MARIADB_URL';

/** The MySQL or MariaDB server a URL names, as mysql2 options; `database` overrides the URL's path. */
function mysqlOptions(url: URL, database?: string): mysql.ConnectionOptions {
  const name = database ?? url.pathname.slice(1);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(name ? { database: name } : {}),
    connectTimeout: 3000,
  };
}

async function withMysql<T>(url: URL, database: string | undefined, work: (c: mysql.Connection) => Promise<T>): Promise<T> {
  const client = await mysql.createConnection(mysqlOptions(url, database));
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * One target per server: MySQL and MariaDB share the `mysql` engine, and
 * the suite runs once against each. `running` counts statements executing
 * against the test database; the counting connection names no database, so
 * it never counts itself.
 */
function mysqlTarget(name: string, envVar: string, ciDefault: string): DbTarget {
  const server = serverUrl(envVar, ciDefault);
  return {
    engine: 'mysql',
    name,
    requiredKey: 'host',
    skip: () => probe(name, envVar, server.explicit, () => withMysql(server.url, '', async (c) => void (await c.query('SELECT 1')))),
    setup: async () => {
      const database = `toil_test_${randomBytes(6).toString('hex')}`;
      await withMysql(server.url, '', (c) => c.query(`CREATE DATABASE ${database}`));
      await withMysql(server.url, database, async (c) => {
        for (const sql of SEED_SQL) await c.query(sql);
      });
      const { url } = server;
      return {
        settings: {
          engine: 'mysql',
          host: url.hostname,
          port: Number(url.port || 3306),
          database,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        },
        schema: database,
        rows: (sql) => withMysql(server.url, database, async (c) => (await c.query(sql))[0] as unknown[]),
        running: () =>
          withMysql(server.url, '', async (c) => {
            const [rows] = await c.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ? AND COMMAND = 'Query'", [database]);
            return Number((rows as Array<{ n: number }>)[0]!.n);
          }),
        cleanup: () => withMysql(server.url, '', async (c) => void (await c.query(`DROP DATABASE IF EXISTS ${database}`))),
      };
    },
    sql: {
      series: (n) => `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${n}) SELECT x FROM n`,
      // Sleeps on the server without producing a row, so only a server-side KILL stops it.
      slow: () => ({ sql: 'SELECT SLEEP(60) AS x' }),
    },
  };
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
  {
    engine: 'postgres',
    defaultSchema: 'public',
    requiredKey: 'host',
    skip: () => probe('PostgreSQL', PG_ENV, pgTarget.explicit, () => withPg(undefined, async (c) => void (await c.query('SELECT 1')))),
    setup: async () => {
      // A fresh database per test, so no test sees another's writes.
      const database = `toil_test_${randomBytes(6).toString('hex')}`;
      await withPg(undefined, (c) => c.query(`CREATE DATABASE ${database}`));
      await withPg(database, async (c) => {
        for (const sql of SEED_SQL) await c.query(sql);
      });
      const { url } = pgTarget;
      return {
        settings: {
          engine: 'postgres',
          host: url.hostname,
          port: Number(url.port || 5432),
          database,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        },
        rows: (sql) => withPg(database, async (c) => (await c.query(sql)).rows),
        running: () =>
          withPg(undefined, async (c) => {
            const { rows } = await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND application_name = 'toil' AND state = 'active' AND query NOT LIKE '%pg_cancel_backend%'",
              [database],
            );
            return rows[0]!.n;
          }),
        cleanup: () => withPg(undefined, async (c) => void (await c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`))),
      };
    },
    sql: {
      series: (n) => `SELECT x FROM generate_series(1, ${n}) AS x`,
      // Sleeps on the server without producing a row, so only a server-side cancel stops it.
      slow: () => ({ sql: 'SELECT pg_sleep(60) AS x' }),
    },
  },
  mysqlTarget('MySQL', MYSQL_ENV, 'mysql://root:mysql@localhost:3306/'),
  mysqlTarget('MariaDB', MARIADB_ENV, 'mysql://root:mysql@localhost:3307/'),
];
