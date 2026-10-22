import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import oracledb from 'oracledb';
import pg from 'pg';
import { Connection, Request } from 'tedious';
import type { Settings } from '../../src/core/config.js';
import { encodeCursor, pageKey } from '../../src/core/db/paging.js';
import { createSqliteFile, PEOPLE, SEED_SQL, sqliteRows } from '../harness/db.js';
import { hs2Run, type Hs2Server } from './hs2-admin.js';

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
  /** How the engine stores an unquoted name (Oracle upper-cases it). Identity when absent. */
  stored?: (name: string) => string;
  /** Time limit in ms for each test and its setup and cleanup, for a slow engine (Oracle). Vitest's defaults when absent. */
  timeout?: number;
  /** A connection key this engine requires, to check the "missing key" error names it. */
  requiredKey: string;
  /**
   * What this engine doesn't do that the suite otherwise checks, each with the reason. A test
   * that needs one checks what the engine does instead, or is skipped, and says so in its name.
   */
  lacks?: Partial<Record<Lack, string>>;
  sql: {
    /** A query returning the integers 1..n in a column named `x`, in order. */
    series: (n: number) => string;
    /**
     * A query that keeps running until cancelled, and how to call it. The call
     * must still be inside the query when the test aborts it, however the
     * engine streams rows.
     */
    slow: () => { sql: string; cursor?: string };
    /** Statements that end or nest a transaction, which db execute must refuse. Default: COMMIT, ROLLBACK, BEGIN, END. */
    transactionControl?: string[];
  };
}

/**
 * Things an engine may not have: NOT NULL and DEFAULT reported by describe (columnConstraints),
 * indexes, keys on the tables it can update (keys), keys it enforces (enforcedKeys), two result
 * columns with one name (sameNamedColumns), transactions, and a read-only mode of its own
 * (readOnlyMode: reads are then read-only only through a read-only account, `reader`).
 */
export type Lack = 'columnConstraints' | 'indexes' | 'keys' | 'enforcedKeys' | 'sameNamedColumns' | 'transactions' | 'readOnlyMode';

export interface TargetDatabase {
  settings: Settings;
  /** The same database through a read-only account, for an engine with no read-only mode of its own. */
  reader?: Settings;
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

const ORACLE_ENV = 'TOIL_TEST_ORACLE_URL';
const oracleTarget = serverUrl(ORACLE_ENV, 'oracle://system:toil_test_pw@localhost:1521/FREEPDB1');

function oracleConnect(user?: { name: string; password: string }): Promise<oracledb.Connection> {
  const { url } = oracleTarget;
  return oracledb.getConnection({
    user: user?.name ?? decodeURIComponent(url.username),
    password: user?.password ?? decodeURIComponent(url.password),
    connectString: `${url.hostname}:${url.port || 1521}${url.pathname}`,
    connectTimeout: 5,
    transportConnectTimeout: 5,
  });
}

async function withOracle<T>(user: { name: string; password: string } | undefined, work: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  const c = await oracleConnect(user);
  try {
    return await work(c);
  } finally {
    await c.close();
  }
}

const MSSQL_ENV = 'TOIL_TEST_SQLSERVER_URL';
// The CI service container's SA password: a throwaway server that lives for one job.
const mssqlTarget = serverUrl(MSSQL_ENV, 'mssql://sa:Toil-test-Pa55word@localhost:1433/master');

/** Runs one batch against the test server as its admin login, outside toil, and returns the rows as objects. */
function withMssql(database: string | undefined, sql: string): Promise<Array<Record<string, unknown>>> {
  const { url } = mssqlTarget;
  const connection = new Connection({
    server: url.hostname,
    authentication: { type: 'default', options: { userName: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } },
    options: { port: Number(url.port || 1433), database: database ?? (url.pathname.slice(1) || 'master'), encrypt: false, connectTimeout: 3000, requestTimeout: 0 },
  });
  connection.on('error', () => {});
  return new Promise((resolve, reject) => {
    connection.connect((err) => {
      if (err) return reject(err);
      const rows: Array<Record<string, unknown>> = [];
      const request = new Request(sql, (e) => {
        connection.close();
        if (e) reject(e);
        else resolve(rows);
      });
      request.on('row', (cols: Array<{ value: unknown; metadata: { colName: string } }>) => rows.push(Object.fromEntries(cols.map((c) => [c.metadata.colName, c.value]))));
      connection.execSqlBatch(request);
    });
  });
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
 * A function that sleeps on the server, for a test that needs a statement
 * no break can stop: Thin mode's break is in band, and DBMS_SESSION.SLEEP
 * doesn't read the socket until it wakes.
 */
export const ORACLE_SLEEP_SQL = 'CREATE FUNCTION toil_sleep(s NUMBER) RETURN NUMBER IS BEGIN DBMS_SESSION.SLEEP(s); RETURN 1; END;';

/** Drops a test user, ending its sessions first: DROP USER refuses while one is connected. */
async function dropOracleUser(name: string): Promise<void> {
  await withOracle(undefined, async (c) => {
    for (let attempt = 0; ; attempt++) {
      const { rows } = await c.execute<[number, number]>('SELECT sid, serial# FROM v$session WHERE username = :u', { u: name });
      for (const [sid, serial] of rows ?? []) await c.execute(`ALTER SYSTEM KILL SESSION '${sid},${serial}' IMMEDIATE`).catch(() => {});
      try {
        await c.execute(`DROP USER ${name} CASCADE`);
        return;
      } catch (err) {
        // ORA-01940: a session is still closing.
        if ((err as { code?: string }).code !== 'ORA-01940' || attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });
}

/** A fresh Oracle user (a schema) seeded with SEED_SQL, plus the sleeping function. */
export async function createOracleUser(): Promise<{ name: string; password: string }> {
  const user = { name: `TOIL_T_${randomBytes(5).toString('hex').toUpperCase()}`, password: `p${randomBytes(9).toString('hex')}` };
  await withOracle(undefined, async (c) => {
    await c.execute(`CREATE USER ${user.name} IDENTIFIED BY "${user.password}" QUOTA UNLIMITED ON users`);
    await c.execute(`GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE TO ${user.name}`);
  });
  await withOracle(user, async (c) => {
    for (const sql of [...SEED_SQL, ORACLE_SLEEP_SQL]) await c.execute(sql);
    await c.commit();
    // A read-only transaction refuses a table whose definition is newer than
    // its snapshot (ORA-01466), and a table created a moment ago can be, for
    // up to a few seconds. Wait until a read-only read works, as toil's will.
    for (const started = Date.now(); ; ) {
      try {
        await c.execute('SET TRANSACTION READ ONLY');
        await c.execute('SELECT count(*) FROM people p JOIN teams t ON t.id = p.team_id');
        await c.rollback();
        break;
      } catch (err) {
        await c.rollback();
        if ((err as { code?: string }).code !== 'ORA-01466' || Date.now() - started > 15_000) throw err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });
  return user;
}

export function oracleSettings(user: { name: string; password: string }): Settings {
  const { url } = oracleTarget;
  return { engine: 'oracle', host: url.hostname, port: Number(url.port || 1521), database: url.pathname.slice(1), user: user.name, password: user.password };
}

export const oracle = {
  probe: () => probe('Oracle', ORACLE_ENV, oracleTarget.explicit, () => withOracle(undefined, async (c) => void (await c.execute('SELECT 1 FROM dual')))),
  connect: oracleConnect,
  run: withOracle,
  dropUser: dropOracleUser,
  /** toil's statements still running on the server for this user, from v$session. */
  running: (name: string) =>
    withOracle(undefined, async (c) => {
      const { rows } = await c.execute<[number]>("SELECT count(*) FROM v$session WHERE username = :u AND status = 'ACTIVE' AND module = 'toil'", { u: name });
      return rows![0]![0];
    }),
};

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

/**
 * Hive and Impala share one provider, and each gets its own target. Neither
 * has a read-only mode, transactions, or indexes, and neither enforces a key,
 * so the target says so (`lacks`) and the suite checks what each engine does
 * instead. Hive runs with SQL standard authorization, so a read-only account
 * (`toil_reader`, granted SELECT) is what refuses a read's writes, as the
 * docs require of users; the test server takes any password. Its tables are
 * transactional ORC, which Hive can UPDATE. The Impala target is local only
 * (test/db/impala/compose.yml): its cluster has no authorization, so the
 * engine side of the read-only checks can't run there, and `people` is an
 * Iceberg table, the kind Impala can UPDATE, which reports no keys.
 *
 * Both count running statements from the server's web UI, whose port the URL
 * names (`?webui=`).
 */
const HIVE_ENV = 'TOIL_TEST_HIVE_URL';
const hiveTarget = serverUrl(HIVE_ENV, 'hive://hive:hive@localhost:10000/?webui=10002');
const IMPALA_ENV = 'TOIL_TEST_IMPALA_URL';
const impalaTarget = serverUrl(IMPALA_ENV, 'impala://impala@localhost:21050/?webui=25000');
const HIVE_WRITER = 'toil_writer';
const HIVE_READER = 'toil_reader';

function hs2Server(url: URL): Hs2Server {
  return { host: url.hostname, port: Number(url.port), password: url.password ? decodeURIComponent(url.password) : null };
}

function webUi(url: URL): string {
  return `http://${url.hostname}:${url.searchParams.get('webui')}`;
}

/** The seed in each engine's own DDL, with the same rows as SEED_SQL. */
function hs2Seed(engine: 'hive' | 'impala', db: string): string[] {
  const people = `INSERT INTO ${db}.people VALUES ${PEOPLE.map((name, i) => `(${i + 1}, '${name}', ${(i % 2) + 1}, ${i % 3 === 2 ? 0 : 1})`).join(', ')}`;
  const view = `CREATE VIEW ${db}.active_people AS SELECT id, name FROM ${db}.people WHERE active = 1`;
  if (engine === 'hive') {
    const acid = "STORED AS ORC TBLPROPERTIES ('transactional'='true')";
    return [
      `CREATE TABLE ${db}.teams (id INT, name VARCHAR(50), PRIMARY KEY (id) DISABLE NOVALIDATE) ${acid}`,
      `CREATE TABLE ${db}.people (id INT, name VARCHAR(100) NOT NULL, team_id INT, active INT DEFAULT 1, PRIMARY KEY (id) DISABLE NOVALIDATE, CONSTRAINT people_team FOREIGN KEY (team_id) REFERENCES ${db}.teams(id) DISABLE NOVALIDATE) ${acid}`,
      view,
      `INSERT INTO ${db}.teams VALUES (1, 'Platform'), (2, 'Data')`,
      people,
    ];
  }
  return [
    `CREATE TABLE ${db}.teams (id INT, name STRING, PRIMARY KEY (id) DISABLE NOVALIDATE RELY)`,
    `CREATE TABLE ${db}.people (id INT NOT NULL, name STRING NOT NULL, team_id INT, active INT, PRIMARY KEY (id) NOT ENFORCED) STORED BY ICEBERG TBLPROPERTIES ('format-version'='2')`,
    view,
    `INSERT INTO ${db}.teams VALUES (1, 'Platform'), (2, 'Data')`,
    people,
  ];
}

const HS2_LACKS = {
  columnConstraints: "it doesn't report NOT NULL or DEFAULT through the protocol",
  indexes: 'it has no indexes',
  enforcedKeys: "it doesn't enforce keys, so a duplicate inserts",
  transactions: 'it has no transactions, so db execute runs one statement per call',
} as const;

export const hive = {
  probe: () => probe('Hive', HIVE_ENV, hiveTarget.explicit, async () => void (await hs2Run(hs2Server(hiveTarget.url), hiveTarget.url.username, ['SELECT 1']))),
  run: (user: string, statements: string[]) => hs2Run(hs2Server(hiveTarget.url), user, statements),
  writer: HIVE_WRITER,
  reader: HIVE_READER,
  /** A fresh database owned by the writer, seeded, with SELECT granted to the reader. */
  async createDatabase(): Promise<string> {
    const db = `toil_test_${randomBytes(6).toString('hex')}`;
    const admin = hiveTarget.url.username;
    await hive.run(admin, ['SET ROLE ADMIN', `CREATE DATABASE ${db}`, `ALTER DATABASE ${db} SET OWNER USER ${HIVE_WRITER}`]);
    await hive.run(HIVE_WRITER, [...hs2Seed('hive', db), ...['teams', 'people', 'active_people'].map((t) => `GRANT SELECT ON TABLE ${db}.${t} TO USER ${HIVE_READER}`)]);
    return db;
  },
  dropDatabase: (db: string) => hive.run(hiveTarget.url.username, ['SET ROLE ADMIN', `DROP DATABASE IF EXISTS ${db} CASCADE`]).then(() => {}),
  settings(db: string, user: string): Settings {
    const { url } = hiveTarget;
    return { engine: 'hive', host: url.hostname, port: Number(url.port), database: db, user, password: decodeURIComponent(url.password) };
  },
  /** Statements still running for the test accounts, from HiveServer2's web UI. */
  async running(): Promise<number> {
    const active = (await (await fetch(`${webUi(hiveTarget.url)}/api/v1/queries/active`)).json()) as Array<{ userName: string; running: boolean }>;
    return active.filter((q) => q.running && (q.userName === HIVE_WRITER || q.userName === HIVE_READER)).length;
  },
};

/** Ten rows, 0 to 9, crossed three times: 1 to n in order, for an engine with no series function. */
const DIGITS = '(VALUES (0 AS d), (1), (2), (3), (4), (5), (6), (7), (8), (9))';

export const impala = {
  probe: () => probe('Impala', IMPALA_ENV, impalaTarget.explicit, async () => void (await hs2Run(hs2Server(impalaTarget.url), impalaTarget.url.username, ['SELECT 1']))),
  run: (statements: string[]) => hs2Run(hs2Server(impalaTarget.url), impalaTarget.url.username, statements),
  settings(db: string): Settings {
    const { url } = impalaTarget;
    return {
      engine: 'impala',
      host: url.hostname,
      port: Number(url.port),
      database: db,
      user: decodeURIComponent(url.username),
      ...(url.password ? { password: decodeURIComponent(url.password) } : { auth: 'nosasl' }),
    };
  },
  /** Statements still in flight against this database, from the impalad's web UI. */
  async running(db: string): Promise<number> {
    const page = (await (await fetch(`${webUi(impalaTarget.url)}/queries?json`)).json()) as { in_flight_queries: Array<{ default_db: string }> };
    return page.in_flight_queries.filter((q) => q.default_db === db).length;
  },
};

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
  {
    engine: 'sqlserver',
    defaultSchema: 'dbo',
    requiredKey: 'host',
    skip: () => probe('SQL Server', MSSQL_ENV, mssqlTarget.explicit, async () => void (await withMssql(undefined, 'SELECT 1 AS one'))),
    setup: async () => {
      // A fresh database per test, so no test sees another's writes.
      const database = `toil_test_${randomBytes(6).toString('hex')}`;
      await withMssql(undefined, `CREATE DATABASE ${database}`);
      // SQL Server wants CREATE VIEW alone in its batch.
      for (const sql of SEED_SQL) await withMssql(database, sql);
      const { url } = mssqlTarget;
      return {
        settings: {
          engine: 'sqlserver',
          host: url.hostname,
          port: Number(url.port || 1433),
          database,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        },
        rows: (sql) => withMssql(database, sql),
        running: async () => {
          const [row] = await withMssql(
            undefined,
            `SELECT COUNT(*) AS n FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
              WHERE s.program_name = 'toil' AND r.database_id = DB_ID('${database}')`,
          );
          return Number(row!.n);
        },
        cleanup: () => withMssql(undefined, `IF DB_ID('${database}') IS NOT NULL BEGIN ALTER DATABASE ${database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${database}; END`).then(() => {}),
      };
    },
    sql: {
      series: (n) => `WITH n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${n}) SELECT x FROM n OPTION (MAXRECURSION 0)`,
      // Waits on the server without producing a row, so only a TDS attention stops it.
      slow: () => ({ sql: "WAITFOR DELAY '00:01:00'" }),
    },
  },
  {
    engine: 'oracle',
    requiredKey: 'host',
    stored: (name) => name.toUpperCase(),
    // Creating and dropping a user per test is slow, and a shared CI runner is slower.
    timeout: 30_000,
    skip: oracle.probe,
    setup: async () => {
      // A fresh user per test: in Oracle a schema is a user.
      const user = await createOracleUser();
      return {
        settings: oracleSettings(user),
        schema: user.name,
        rows: (sql) => withOracle(user, async (c) => (await c.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []),
        running: () => oracle.running(user.name),
        cleanup: () => dropOracleUser(user.name),
      };
    },
    sql: {
      series: (n) => `SELECT level AS x FROM dual CONNECT BY level <= ${n}`,
      // Computes for hours without producing a row. A break stops it at the
      // server's next check; abandoning the connection would leave it running.
      slow: () => ({ sql: 'SELECT count(*) AS x FROM all_objects a, all_objects b, all_objects c' }),
      transactionControl: ['COMMIT', 'ROLLBACK', 'SAVEPOINT s', 'SET TRANSACTION READ WRITE'],
    },
  },
  {
    engine: 'hive',
    requiredKey: 'host',
    // Every statement that writes runs a Tez job, a few seconds each in the test container.
    timeout: 60_000,
    lacks: {
      ...HS2_LACKS,
      sameNamedColumns: 'it names the second one id_1',
      readOnlyMode: 'it has no read-only mode, so the engine side is checked through a read-only account',
    },
    skip: hive.probe,
    setup: async () => {
      const db = await hive.createDatabase();
      return {
        settings: hive.settings(db, hive.writer),
        reader: hive.settings(db, hive.reader),
        schema: db,
        rows: (sql) => hive.run(hive.writer, [`USE ${db}`, sql]),
        running: hive.running,
        cleanup: () => hive.dropDatabase(db),
      };
    },
    sql: {
      series: (n) => `SELECT pos + 1 AS x FROM (SELECT posexplode(split(space(${n - 1}), ' ')) AS (pos, val)) t`,
      // A Tez job that counts forty billion rows: only a server-side cancel stops it.
      slow: () => ({ sql: "SELECT count(*) AS x FROM (SELECT posexplode(split(space(200000), ' '))) a CROSS JOIN (SELECT posexplode(split(space(200000), ' '))) b" }),
    },
  },
  {
    engine: 'impala',
    requiredKey: 'host',
    timeout: 30_000,
    lacks: {
      ...HS2_LACKS,
      keys: "people is an Iceberg table, the kind it can UPDATE, and it reports no keys for one",
      readOnlyMode: 'it has no read-only mode, and the local test cluster has no authorization to make a read-only account with',
    },
    skip: impala.probe,
    setup: async () => {
      const db = `toil_test_${randomBytes(6).toString('hex')}`;
      await impala.run([`CREATE DATABASE ${db}`, ...hs2Seed('impala', db)]);
      return {
        settings: impala.settings(db),
        schema: db,
        rows: (sql) => impala.run([`USE ${db}`, sql]),
        running: () => impala.running(db),
        cleanup: () => impala.run([`DROP DATABASE IF EXISTS ${db} CASCADE`]).then(() => {}),
      };
    },
    sql: {
      series: (n) => `SELECT x FROM (SELECT a.d * 100 + b.d * 10 + c.d + 1 AS x FROM ${DIGITS} a CROSS JOIN ${DIGITS} b CROSS JOIN ${DIGITS} c) n WHERE x <= ${n} ORDER BY x`,
      // Sleeps in the coordinator without producing a row, so only a server-side cancel stops it.
      slow: () => ({ sql: 'SELECT sleep(60000) AS x' }),
    },
  },
];
