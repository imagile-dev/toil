import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { connectionOptions, refusedOnRead } from '../../src/core/db/mysql/index.js';
import { controlsTransaction, splitStatements, writesServerFile } from '../../src/core/db/mysql/split.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { targets, type TargetDatabase } from './targets.js';

/**
 * What only MySQL and MariaDB do, beyond the shared conformance suite:
 * splitting a script, the statements that get around a read-only
 * transaction, how values become JSON, and how a connection is set up. The
 * splitter and option tests run offline; the rest run against each server
 * the conformance targets reach, and skip with them. Each test gets its own
 * database, issued promptly and returned in the condition it was found.
 */

const first = (sql: string) => splitStatements(sql).map((s) => s.words[0]);

describe('mysql script splitting', () => {
  it('splits on semicolons outside strings, identifiers and comments', () => {
    const sql = [
      "INSERT INTO t VALUES ('a;b', 'it''s; fine', 'back\\'slash; still')",
      'UPDATE `we;ird` SET x = 1',
      'SELECT "dq; string" AS s',
      '/* block; comment */ DELETE FROM t',
      '-- line; comment\nSELECT 1',
      '# hash; comment\nSELECT 2',
    ].join(';\n');
    expect(first(sql)).toEqual(['INSERT', 'UPDATE', 'SELECT', 'DELETE', 'SELECT', 'SELECT']);
  });

  it('reads -- as a comment only when whitespace follows, as MySQL does', () => {
    expect(first('SELECT 1--1; SELECT 2')).toEqual(['SELECT', 'SELECT']);
    expect(first('SELECT 1 -- x; SELECT 2')).toEqual(['SELECT']);
  });

  it('reads an executable comment as code', () => {
    expect(splitStatements("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */").some(writesServerFile)).toBe(true);
    expect(splitStatements("SELECT 1 /*M! INTO DUMPFILE '/tmp/x' */").some(writesServerFile)).toBe(true);
    expect(first('/*!40101 SET NAMES utf8 */; SELECT 1')).toEqual(['SET', 'SELECT']);
    expect(splitStatements("SELECT 1 /* INTO OUTFILE '/tmp/x' */").some(writesServerFile)).toBe(false);
  });

  it('drops empty statements and comment-only tails', () => {
    expect(splitStatements(';; -- nothing\n /* here */ ; # or here')).toEqual([]);
    expect(first('SELECT 1; /* trailing */')).toEqual(['SELECT']);
  });

  it('finds transaction control, and leaves words that only look like it', () => {
    for (const sql of ['COMMIT', '/* a */ commit', 'BEGIN', 'START TRANSACTION', 'END', 'ROLLBACK', 'SAVEPOINT s', 'RELEASE SAVEPOINT s', "XA START 'x'", 'LOCK TABLES t WRITE', 'UNLOCK TABLES', 'SET autocommit = 1', 'SET @@session.autocommit = 1']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(true);
    }
    for (const sql of ['SELECT 1 AS `commit`', "SELECT 'COMMIT'", 'UPDATE t SET `begin` = 1', 'SET @autocommit = 1']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(false);
    }
  });

  it('refuses INTO OUTFILE, INTO DUMPFILE and SET on reads, by name, and nothing that merely mentions them', () => {
    for (const sql of ["SELECT * FROM t INTO OUTFILE '/tmp/x'", "TABLE t INTO DUMPFILE '/tmp/x'", 'set global max_connections = 1', 'SET PERSIST x = 1', '/* c */ SET @a = 1']) {
      expect(refusedOnRead(sql)?.code, sql).toBe('INVALID_INPUT');
    }
    for (const sql of ["SELECT 'INTO OUTFILE'", 'SELECT `outfile` FROM t', 'SELECT 1 INTO @outfile', 'SELECT settings FROM t', 'SHOW VARIABLES']) {
      expect(refusedOnRead(sql), sql).toBeUndefined();
    }
  });

  // With NO_BACKSLASH_ESCAPES on the server, 'a\' is a whole string, and what
  // follows it is code. Read only one way, the INTO OUTFILE below would hide.
  it('finds INTO OUTFILE whichever way the server reads backslashes', () => {
    expect(refusedOnRead("SELECT 'a\\', 1 INTO OUTFILE '/tmp/x' -- '")?.code).toBe('INVALID_INPUT');
  });
});

describe('mysql connection settings', () => {
  const conn = { name: 'db', area: 'db', engine: 'mysql', host: 'db.imagile.dev', database: 'app', user: 'reader', password: 'from-toil' } as unknown as DbConnection;

  it('connects with only what the connection names, LOCAL INFILE and cleartext passwords off', () => {
    expect(connectionOptions(conn)).toMatchObject({
      host: 'db.imagile.dev', port: 3306, user: 'reader', password: 'from-toil', database: 'app',
      flags: ['-LOCAL_FILES'], multipleStatements: false, enableCleartextPlugin: false, dateStrings: true,
    });
    expect(connectionOptions(conn).ssl).toBeUndefined();
    expect(connectionOptions({ ...conn, password: undefined } as DbConnection).password).toBe('');
  });

  it("verifies TLS, the host name included, against Node's and the OS's CAs when ssl is on", () => {
    const ssl = connectionOptions({ ...conn, ssl: true } as DbConnection).ssl as { rejectUnauthorized: boolean; verifyIdentity: boolean; ca: string[] };
    expect(ssl).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true });
    expect(ssl.ca.length).toBeGreaterThan(0);
  });
});

for (const target of targets.filter((t) => t.engine === 'mysql')) {
  const skip = await target.skip?.();

  describe.skipIf(skip !== undefined)(`${target.name} server${skip ? ` (skipped: ${skip})` : ''}`, () => {
    let db: TargetDatabase;
    beforeEach(async () => {
      db = await target.setup();
    });
    afterEach(async () => {
      await db.cleanup();
    });

    const run = (def: AnyCommand, input: Record<string, unknown>, settings: Settings = db.settings, debug: (m: string) => void = () => {}) => {
      const { context } = testContext({ config: { db: settings } });
      return execute(def, input, { ...context, debug });
    };
    const writable = () => ({ ...db.settings, writes: true });
    /** Straight to the server as the test's admin, outside toil; `readOnly` sets the session up the way toil's reads are. */
    const direct = async (sql: string, readOnly = false): Promise<unknown> => {
      const s = db.settings as Record<string, string | number>;
      const c = await mysql.createConnection({ host: String(s.host), port: Number(s.port), user: String(s.user), password: String(s.password), database: String(s.database) });
      try {
        if (readOnly) {
          await c.query('SET SESSION TRANSACTION READ ONLY');
          await c.query('START TRANSACTION READ ONLY');
        }
        return (await c.query(sql))[0];
      } finally {
        await c.end();
      }
    };
    const scalar = async (sql: string) => Object.values(((await direct(sql)) as Array<Record<string, unknown>>)[0]!)[0];

    it('turns MySQL values into JSON without losing or shifting anything', async () => {
      const envelope = await run(query, {
        sql: `SELECT 42 AS i, 9007199254740993 AS big, CAST(7 AS SIGNED) AS small, CAST(1.50 AS DECIMAL(5,2)) AS num, 2.5e0 AS f, 'x' AS t, NULL AS n,
                X'0102FF' AS bin, CAST('2026-01-02' AS DATE) AS d, CAST('2026-01-02 03:04:05' AS DATETIME) AS ts, CAST('26:00:00' AS TIME) AS tm`,
      });
      expect(envelope.error).toBeNull();
      const data = envelope.data as { columns: Array<{ name: string; type: string }>; rows: unknown[][] };
      expect(data.columns.map((c) => c.type)).toEqual([expect.stringMatching(/INT$/), 'BIGINT', expect.stringMatching(/INT$/), 'DECIMAL', 'DOUBLE', 'VARCHAR', expect.any(String), 'VARBINARY', 'DATE', 'DATETIME', 'TIME']);
      // As the server wrote them: no Date in the local zone of whoever ran toil.
      expect(data.rows[0]).toEqual([42, '9007199254740993', 7, '1.50', 2.5, 'x', null, 'AQL/', '2026-01-02', '2026-01-02 03:04:05', '26:00:00']);
    });

    it('describes a table with a composite key, a defaulted text column and actions on its foreign key', async () => {
      await direct(`CREATE TABLE badges (team_id INT NOT NULL, seq INT NOT NULL, code VARCHAR(10) NOT NULL DEFAULT 'none', made TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (team_id, seq), KEY badges_code (code), FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE)`);
      const d = (await run(describeTable, { table: 'badges' })).data as { columns: Array<{ name: string; default: string | null; primaryKey: number | null }>; [k: string]: unknown };
      expect(d).toMatchObject({ name: 'badges', primaryKey: ['team_id', 'seq'] });
      expect(d.columns.map((c) => [c.name, c.primaryKey])).toEqual([['team_id', 1], ['seq', 2], ['code', null], ['made', null]]);
      expect(d.columns.find((c) => c.name === 'code')?.default).toBe("'none'");
      expect(d.columns.find((c) => c.name === 'made')?.default).toMatch(/^current_timestamp/i);
      expect(d.foreignKeys).toEqual([{ columns: ['team_id'], references: { schema: db.schema, table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: 'CASCADE' }]);
      expect(d.indexes).toContainEqual({ name: 'PRIMARY', columns: ['team_id', 'seq'], unique: true });
      expect(d.indexes).toContainEqual({ name: 'badges_code', columns: ['code'], unique: false });
    });

    it('previews a table in primary-key order, whatever index the planner reads', async () => {
      // teams has a unique index on name, which InnoDB would otherwise scan: Data before Platform.
      expect((await run(previewTable, { table: 'teams' })).data).toMatchObject({ rows: [[1, 'Platform'], [2, 'Data']] });
    });

    // Why reads set the session read-only as well as the transaction: DDL
    // commits implicitly, ending a read-only transaction, then runs in
    // autocommit. The transaction alone lets DROP TABLE through.
    it('refuses DDL, which a read-only transaction alone lets through', async () => {
      const c = await mysql.createConnection(connectionOptions({ ...(db.settings as object), name: 'db' } as unknown as DbConnection));
      await c.query('START TRANSACTION READ ONLY');
      await c.query('CREATE TABLE escapee (id INT)');
      await c.end();
      expect(await scalar(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'escapee'`)).toBe(1);

      for (const sql of ['CREATE TABLE notes (id INT)', 'TRUNCATE TABLE people', 'ALTER TABLE people ADD COLUMN z INT', 'CREATE TEMPORARY TABLE tmp (id INT)']) {
        expect((await run(query, { sql }, writable())).error?.code, sql).toBe('WRITE_DISABLED');
      }
      expect(await scalar('SELECT COUNT(*) FROM people')).toBe(12);
    });

    it('keeps a read read-only even when the statement asks for read-write', async () => {
      // The only statement in the session, which then ends: nothing can follow it.
      expect((await run(query, { sql: 'COMMIT' })).ok).toBe(true);
      expect((await run(query, { sql: 'UPDATE people SET active = 0' })).error?.code).toBe('WRITE_DISABLED');
    });

    // The escapes that make the denies necessary: in a read-only session and
    // transaction an account with FILE still writes a server file with INTO
    // OUTFILE, and one with SYSTEM_VARIABLES_ADMIN still changes the server.
    it('refuses INTO OUTFILE and SET on reads, because both get around read-only mode', async () => {
      const dir = String(await scalar('SELECT @@secure_file_priv') ?? '');
      const file = `${dir || '/tmp/'}toil-out-${randomBytes(4).toString('hex')}`;
      await direct(`SELECT 1 INTO OUTFILE '${file}'`, true);
      expect(await scalar(`SELECT LOAD_FILE('${file}') IS NOT NULL`)).toBe(1);

      const before = Number(await scalar('SELECT @@global.max_connect_errors'));
      await direct(`SET GLOBAL max_connect_errors = ${before + 1}`, true);
      expect(Number(await scalar('SELECT @@global.max_connect_errors'))).toBe(before + 1);
      await direct(`SET GLOBAL max_connect_errors = ${before}`);

      for (const sql of [`SELECT 1 INTO OUTFILE '${file}-toil'`, `select 'x' /*!50000 into dumpfile '${file}-toil' */`, `SET GLOBAL max_connect_errors = ${before + 1}`]) {
        expect((await run(query, { sql })).error, sql).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
      }
      expect(await scalar(`SELECT LOAD_FILE('${file}-toil') IS NULL`)).toBe(1);
      expect(Number(await scalar('SELECT @@global.max_connect_errors'))).toBe(before);
    });

    it('refuses LOAD DATA, local or not', async () => {
      for (const sql of ["LOAD DATA INFILE '/etc/hostname' INTO TABLE teams", "LOAD DATA LOCAL INFILE '/etc/hostname' INTO TABLE teams"]) {
        expect((await run(query, { sql }, writable())).error?.code, sql).toMatch(/WRITE_DISABLED|DATABASE/);
      }
      expect(await scalar('SELECT COUNT(*) FROM teams')).toBe(2);
    });

    // Known limit, documented in skills/toil/db.md: a stored procedure that
    // commits and turns read-write itself still writes when a read CALLs it.
    // Refusing CALL would refuse every reporting procedure, so the fix is an
    // account without EXECUTE on such a procedure.
    it('known limit: a procedure that changes its own transaction mode can write from a read', async () => {
      await direct('CREATE PROCEDURE escape_hatch() BEGIN COMMIT; SET SESSION TRANSACTION READ WRITE; UPDATE people SET active = 0 WHERE id = 1; END');
      expect((await run(query, { sql: 'CALL escape_hatch()' })).ok).toBe(true);
      expect(await scalar('SELECT active FROM people WHERE id = 1')).toBe(0);
    });

    it('refuses SQL that holds no statement', async () => {
      expect((await run(query, { sql: '-- only a comment' })).error?.code).toBe('INVALID_INPUT');
    });

    it('refuses LOCK TABLES and SET autocommit in a script before running any of it', async () => {
      for (const sql of ['UPDATE people SET active = 0 WHERE id = 1; LOCK TABLES people WRITE', 'UPDATE people SET active = 0 WHERE id = 1; SET autocommit = 1']) {
        expect((await run(executeCmd, { sql, allowWrite: true }, writable())).error?.code, sql).toBe('INVALID_INPUT');
      }
      expect(await scalar('SELECT active FROM people WHERE id = 1')).toBe(1);
    });

    it('answers a missing database with NOT_FOUND and a wrong password with AUTH, never echoing the password', async () => {
      expect((await run(listSchemas, {}, { ...db.settings, database: 'no_such_database' })).error?.code).toBe('NOT_FOUND');
      const debug: string[] = [];
      const wrong = await run(listSchemas, {}, { ...db.settings, password: 'not-the-password-123' }, (m) => debug.push(m));
      expect(wrong.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('connections login db') });
      expect(JSON.stringify(wrong) + debug.join('\n')).not.toContain('not-the-password-123');
      expect(debug.join('\n')).toContain('connection db');
    });

    it('answers a reference to another missing database in the SQL as DATABASE, not as the connection', async () => {
      expect((await run(query, { sql: 'SELECT * FROM no_such_database.t' })).error?.code).toBe('DATABASE');
    });

    it('answers a closed port with NETWORK', async () => {
      expect((await run(listSchemas, {}, { ...db.settings, host: '127.0.0.1', port: 1 })).error?.code).toBe('NETWORK');
    });
  });
}
