import oracledb from 'oracledb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { oracleDateText } from '../../src/core/db/oracle/dates.js';
import { connectDescriptor, oracleNumber, toToilError } from '../../src/core/db/oracle/index.js';
import { controlsTransaction, splitStatements } from '../../src/core/db/oracle/split.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { oracle, targets, type TargetDatabase } from './targets.js';

/**
 * What only Oracle does, beyond the shared conformance suite: splitting a
 * script, the connect descriptor, Thin mode, how values become JSON, and the
 * statements that get around a read-only transaction. The splitter,
 * descriptor and Thin-mode tests run offline; the rest need the server the
 * conformance target reaches, and skip with it. Each test gets its own user,
 * which in Oracle is the same thing as a schema, and has been since before
 * anyone thought to ask why.
 */

const words = (sql: string) => splitStatements(sql).map((s) => s.words[0]);

describe('oracle script splitting', () => {
  it("splits on semicolons outside strings, q'' quotes, identifiers and comments", () => {
    const sql = [
      "INSERT INTO t VALUES ('a;b', 'it''s; fine')",
      'UPDATE "we;ird" SET x = 1',
      "SELECT q'[it's; still]' FROM dual",
      "SELECT Q'{a;b}', nq'<c;d>', q'!e;f!' FROM dual",
      "SELECT N'n;n' FROM dual",
      '/* block; comment */ DELETE FROM t',
      '-- line; comment\nSELECT 1 FROM dual',
    ].join(';\n');
    expect(words(sql)).toEqual(['INSERT', 'UPDATE', 'SELECT', 'SELECT', 'SELECT', 'DELETE', 'SELECT']);
    expect(splitStatements('SELECT 1 FROM dual;')[0]!.text).toBe('SELECT 1 FROM dual');
  });

  it('keeps a PL/SQL unit whole, to a / line or the end, with its own semicolon', () => {
    const script = [
      'CREATE OR REPLACE EDITIONABLE FUNCTION two RETURN NUMBER IS BEGIN RETURN 2; END;',
      '/',
      'UPDATE t SET x = two();',
      'BEGIN',
      '  UPDATE t SET x = 3;',
      'END;',
      '  /  ',
      'DECLARE n NUMBER; BEGIN n := 1; END;',
    ].join('\n');
    const statements = splitStatements(script);
    expect(statements.map((s) => [s.words[0], s.plsql])).toEqual([
      ['CREATE', true],
      ['UPDATE', false],
      ['BEGIN', true],
      ['DECLARE', true],
    ]);
    expect(statements[0]!.text).toBe('CREATE OR REPLACE EDITIONABLE FUNCTION two RETURN NUMBER IS BEGIN RETURN 2; END;');
    expect(statements[2]!.text).toBe('BEGIN\n  UPDATE t SET x = 3;\nEND;');
    expect(splitStatements('WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f FROM dual')).toHaveLength(1);
    // A / inside an expression isn't a / line.
    expect(words('SELECT 4\n/ 2 FROM dual; SELECT 1 FROM dual')).toEqual(['SELECT', 'SELECT']);
    expect(splitStatements('CREATE TABLE a (x INTEGER); CREATE VIEW v AS SELECT 1 x FROM dual')).toHaveLength(2);
  });

  it('drops empty statements and comment-only tails', () => {
    expect(splitStatements(';; -- nothing\n /* here */ ;\n/\n')).toEqual([]);
    expect(words('SELECT 1 FROM dual; /* trailing */')).toEqual(['SELECT']);
  });

  it('finds transaction control after leading comments, and nothing else', () => {
    for (const sql of ['COMMIT', '/* a */ commit work', '-- x\nROLLBACK', 'ROLLBACK TO SAVEPOINT s', 'SAVEPOINT s', 'SET TRANSACTION READ WRITE', 'set /* c */ transaction isolation level serializable']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(true);
    }
    for (const sql of ['SELECT 1 AS commit FROM dual', "SELECT 'COMMIT' FROM dual", 'UPDATE t SET "COMMIT" = 1', 'SET ROLE NONE', 'BEGIN COMMIT; END;']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(false);
    }
  });
});

describe('oracle date bytes', () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  it('reads the wire form without the local time zone', () => {
    // 2026-03-08 02:30:00, then .000001 and +05:45.
    expect(oracleDateText(bytes(120, 126, 3, 8, 3, 31, 1), false)).toBe('2026-03-08 02:30:00');
    expect(oracleDateText(bytes(120, 126, 3, 8, 3, 31, 1, 0, 0, 3, 232), false)).toBe('2026-03-08 02:30:00.000001');
    expect(oracleDateText(bytes(120, 126, 3, 8, 3, 31, 1, 0, 0, 0, 0, 25, 105), true)).toBe('2026-03-08 08:15:00+05:45');
    expect(oracleDateText(bytes(120, 126, 1, 1, 1, 1, 1, 0, 0, 0, 0, 20 - 8, 60), true)).toBe('2025-12-31 16:00:00-08');
  });
});

describe('oracle errors', () => {
  const conn = { name: 'db', area: 'db', engine: 'oracle', host: 'db.imagile.dev', database: 'FREEPDB1', user: 'reader' } as unknown as DbConnection;
  it('reads "certificate" in a message as TLS only when the server sent no error code', () => {
    expect(toToilError({ code: 'ORA-00942', message: 'ORA-00942: table or view "TOIL"."CERTIFICATES" does not exist' }, conn, 'read')).toMatchObject({ code: 'DATABASE' });
    expect(toToilError({ code: 'ORA-00904', message: 'ORA-00904: "CERTIFICATE_ID": invalid identifier' }, conn, 'read')).toMatchObject({ code: 'DATABASE' });
    expect(toToilError({ code: 'NJS-506', message: 'NJS-506: TLS authentication failed' }, conn, 'read')).toMatchObject({ code: 'NETWORK' });
    expect(toToilError({ message: 'unable to verify the first certificate' }, conn, 'read')).toMatchObject({ code: 'NETWORK' });
  });
});

describe('oracle connection settings', () => {
  const conn = { name: 'db', area: 'db', engine: 'oracle', host: 'db.imagile.dev', database: 'ORCLPDB1', user: 'reader', password: 'from-toil' } as unknown as DbConnection;

  it('connects with a descriptor built from host, port and service only, so no tnsnames.ora or TNS_ADMIN is read', () => {
    expect(connectDescriptor(conn)).toBe('(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db.imagile.dev)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1)))');
    expect(connectDescriptor({ ...conn, port: 2484, ssl: true } as DbConnection)).toBe(
      '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=db.imagile.dev)(PORT=2484))(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1))(SECURITY=(SSL_SERVER_DN_MATCH=TRUE)))',
    );
    expect(connectDescriptor({ ...conn, host: '[::1]' } as DbConnection)).toContain('(HOST=::1)');
  });

  it('refuses a host or service that could add to the descriptor', () => {
    for (const host of ['db.imagile.dev)(HOST=other.imagile.dev', 'db.imagile.dev:1521', 'tcps://db.imagile.dev', 'config-file://x', 'db imagile', '']) {
      expect(() => connectDescriptor({ ...conn, host } as DbConnection), host).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    }
    for (const database of ['ORCL)(SERVER=DEDICATED', 'pdb/x', 'MYALIAS ', '']) {
      expect(() => connectDescriptor({ ...conn, database } as DbConnection), database).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    }
  });

  it('keeps a NUMBER a number only when nothing is lost', () => {
    expect(['42', '-7', '.5', '-.25', '1.10', '123456789012345', '9007199254740991'].map(oracleNumber)).toEqual([42, -7, 0.5, -0.25, 1.1, 123456789012345, 9007199254740991]);
    expect(['9007199254740993', '12345678901234567890', '.3333333333333333333333333333333333333333', '1.0000000000000001'].map(oracleNumber)).toEqual([
      '9007199254740993', '12345678901234567890', '.3333333333333333333333333333333333333333', '1.0000000000000001',
    ]);
    expect(oracleNumber(null)).toBeNull();
  });

  // Thick mode loads the driver's native addon (build/Release/*.node, present
  // in node_modules) through process.dlopen. A call through toil must reach
  // the network in Thin mode without ever doing that.
  it('runs in Thin mode: a call reaches the network without loading the native addon', async () => {
    const dlopen = vi.spyOn(process, 'dlopen');
    try {
      const { context } = testContext({ config: { db: { engine: 'oracle', host: '127.0.0.1', port: 1, database: 'FREEPDB1', user: 'reader', password: 'x' } } });
      const envelope = await execute(listSchemas, {}, context);
      expect(envelope.error?.code).toBe('NETWORK');
      expect(oracledb.thin).toBe(true);
      expect(dlopen).not.toHaveBeenCalled();
    } finally {
      dlopen.mockRestore();
    }
  });
});

const target = targets.find((t) => t.engine === 'oracle')!;
const skip = await target.skip?.();

describe.skipIf(skip !== undefined)(`oracle server${skip ? ` (skipped: ${skip})` : ''}`, () => {
  let db: TargetDatabase;
  beforeEach(async () => {
    db = await target.setup();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  const user = () => ({ name: String(db.settings.user), password: String(db.settings.password) });
  const run = (def: AnyCommand, input: Record<string, unknown>, settings: Settings = db.settings, debug: (m: string) => void = () => {}) => {
    const { context } = testContext({ config: { db: settings } });
    return execute(def, input, { ...context, debug });
  };
  const write = (sql: string) => run(executeCmd, { sql, allowWrite: true }, { ...db.settings, writes: true });
  /** Runs SQL as the test user, outside toil. */
  const direct = (sql: string) => oracle.run(user(), async (c) => (await c.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_ARRAY })).rows ?? []);
  /** Runs SQL as the test user inside SET TRANSACTION READ ONLY, then rolls back, as toil's reads do. */
  const readOnly = (sql: string) =>
    oracle.run(user(), async (c) => {
      await c.execute('SET TRANSACTION READ ONLY');
      try {
        await c.execute(sql);
      } finally {
        await c.rollback();
      }
    });
  const tables = async () => (await direct('SELECT table_name FROM user_tables ORDER BY 1')).map((r) => (r as string[])[0]);

  it('turns Oracle values into JSON without losing anything', async () => {
    const envelope = await run(query, {
      sql: `SELECT 42 AS i, 12345678901234567890 AS big, 1/3 AS third, 0.5 AS half, TO_BINARY_DOUBLE(2.5) AS f, BINARY_DOUBLE_NAN AS nan, TRUE AS b, 'x' AS t, CAST(NULL AS VARCHAR2(5)) AS n,
              HEXTORAW('0102FF') AS bin, TO_CLOB('long text') AS cl, TO_BLOB(HEXTORAW('0A0B')) AS bl,
              DATE '2026-01-02' + 3723/86400 AS d, TIMESTAMP '2026-01-02 03:04:05.678' AS ts, TIMESTAMP '2026-01-02 03:04:05 +02:00' AS tstz
         FROM dual`,
    });
    expect(envelope.error).toBeNull();
    const data = envelope.data as { columns: Array<{ name: string; type: string }>; rows: unknown[][] };
    expect(data.columns.map((c) => c.type)).toEqual([
      'NUMBER', 'NUMBER', 'NUMBER', 'NUMBER', 'BINARY_DOUBLE', 'BINARY_DOUBLE', 'BOOLEAN', 'CHAR', 'VARCHAR2', 'RAW', 'CLOB', 'BLOB', 'DATE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE',
    ]);
    expect(data.rows[0]).toEqual([
      42, '12345678901234567890', '.3333333333333333333333333333333333333333', 0.5, 2.5, 'NaN', true, 'x', null, 'AQL/', 'long text', 'Cgs=',
      // As the server holds them, in the shape PostgreSQL and MySQL use: no zone added, and a zoned value with its own offset.
      '2026-01-02 01:02:03', '2026-01-02 03:04:05.678', '2026-01-02 03:04:05+02',
    ]);
  });

  // The driver builds a local-time Date and keeps only milliseconds. Run in a
  // zone with daylight saving, so a value in the gap would move an hour.
  it('returns dates and timestamps exactly as stored: a daylight-saving gap, microseconds, offsets', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    try {
      const envelope = await run(query, {
        sql: `SELECT DATE '2026-03-08' + 2.5/24 AS gap, TIMESTAMP '2026-03-08 02:30:00.123456' AS gap_micro, TIMESTAMP '2026-01-02 03:04:05.123456789' AS nanos,
                  TIMESTAMP '2026-01-02 03:04:05.5 -03:30' AS west, TIMESTAMP '2026-07-01 12:00:00 Europe/Paris' AS region,
                  CAST(TIMESTAMP '2026-01-02 03:04:05.25 +00:00' AS TIMESTAMP WITH LOCAL TIME ZONE) AS ltz, DATE '0099-12-31' AS old
             FROM dual`,
      });
      expect(envelope.error).toBeNull();
      expect((envelope.data as { rows: unknown[][] }).rows[0]).toEqual([
        '2026-03-08 02:30:00', '2026-03-08 02:30:00.123456', '2026-01-02 03:04:05.123456789',
        '2026-01-02 03:04:05.5-03:30',
        // A named region needs Oracle's region table for its offset, so it reads as the same instant in UTC.
        '2026-07-01 10:00:00+00',
        '2026-01-02 03:04:05.25+00', '0099-12-31 00:00:00',
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('describes column types as declared, and finds a table by its unquoted name', async () => {
    await write("CREATE TABLE kinds (a NUMBER(10,2), b NUMBER(5), c NUMBER, d VARCHAR2(20 CHAR), e NVARCHAR2(10), f RAW(16), g DATE, h TIMESTAMP(3), i FLOAT(10), j CLOB)");
    const d = (await run(describeTable, { table: 'kinds' })).data as { name: string; columns: Array<{ name: string; type: string }> };
    expect(d.name).toBe('KINDS');
    expect(d.columns.map((c) => c.type)).toEqual(['NUMBER(10,2)', 'NUMBER(5)', 'NUMBER', 'VARCHAR2(20 CHAR)', 'NVARCHAR2(10)', 'RAW(16)', 'DATE', 'TIMESTAMP(3)', 'FLOAT(10)', 'CLOB']);
    // A quoted mixed-case name is found only as written.
    await write('CREATE TABLE "Mixed" (x INTEGER)');
    expect((await run(describeTable, { table: 'Mixed' })).data).toMatchObject({ name: 'Mixed' });
    expect((await run(describeTable, { table: 'MIXED' })).error?.code).toBe('NOT_FOUND');
    expect((await run(listTables, { schema: String(db.schema).toLowerCase() })).data).toMatchObject({ tables: expect.arrayContaining([{ name: 'Mixed', type: 'table' }]) });
  });

  it('describes a composite key, an expression index and a cascading foreign key', async () => {
    await write(`CREATE TABLE badges (team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE, seq INTEGER NOT NULL, code VARCHAR2(10), CONSTRAINT badges_pk PRIMARY KEY (team_id, seq));
      CREATE INDEX badges_lower ON badges (LOWER(code))`);
    const d = (await run(describeTable, { table: 'badges' })).data as Record<string, unknown>;
    expect(d).toMatchObject({ name: 'BADGES', primaryKey: ['TEAM_ID', 'SEQ'] });
    expect(d.foreignKeys).toEqual([{ columns: ['TEAM_ID'], references: { schema: db.schema, table: 'TEAMS', columns: ['ID'] }, onUpdate: null, onDelete: 'CASCADE' }]);
    expect(d.indexes).toContainEqual({ name: 'BADGES_LOWER', columns: ['<expression>'], unique: false });
    expect(d.indexes).toContainEqual({ name: 'BADGES_PK', columns: ['TEAM_ID', 'SEQ'], unique: true });
  });

  it('previews a table past the first page', async () => {
    const envelope = await run(previewTable, { table: 'people', limit: 5 });
    const next = await run(previewTable, { table: 'people', limit: 5, cursor: envelope.meta.page!.nextCursor });
    expect((next.data as { rows: unknown[][] }).rows).toHaveLength(5);
  });

  // The escapes that make the deny necessary. In a read-only transaction
  // Oracle refuses INSERT, UPDATE, DELETE, MERGE and SELECT FOR UPDATE
  // (ORA-01456), but DDL commits before and after itself, and PL/SQL can
  // commit, run DDL, or run an autonomous transaction. Each statement below
  // changes the database through SET TRANSACTION READ ONLY, outside toil,
  // and db query refuses it with nothing changed.
  it('refuses DDL on reads, because Oracle commits DDL inside a read-only transaction', async () => {
    await write('CREATE TABLE victim (x INTEGER); CREATE TABLE old_victim (x INTEGER); DROP TABLE old_victim');
    const escapes: Array<[string, () => Promise<unknown>]> = [
      ['CREATE TABLE made (x INTEGER)', async () => expect(await tables()).toContain('MADE')],
      ['ALTER TABLE victim ADD (y INTEGER)', async () => expect(await direct("SELECT count(*) FROM user_tab_columns WHERE table_name = 'VICTIM'")).toEqual([[2]])],
      ['COMMENT ON TABLE victim IS \'changed\'', async () => expect(await direct("SELECT comments FROM user_tab_comments WHERE table_name = 'VICTIM'")).toEqual([['changed']])],
      ['GRANT SELECT ON victim TO PUBLIC', async () => expect(await direct("SELECT count(*) FROM user_tab_privs WHERE table_name = 'VICTIM'")).toEqual([[1]])],
      ['REVOKE SELECT ON victim FROM PUBLIC', async () => expect(await direct("SELECT count(*) FROM user_tab_privs WHERE table_name = 'VICTIM'")).toEqual([[0]])],
      ['ANALYZE TABLE victim COMPUTE STATISTICS', async () => expect(await direct("SELECT last_analyzed IS NOT NULL FROM user_tables WHERE table_name = 'VICTIM'")).toEqual([[true]])],
      ['ASSOCIATE STATISTICS WITH FUNCTIONS toil_sleep DEFAULT COST (1, 1, 1)', async () => expect(await direct("SELECT count(*) FROM user_associations WHERE object_name = 'TOIL_SLEEP'")).toEqual([[1]])],
      ['DISASSOCIATE STATISTICS FROM FUNCTIONS toil_sleep', async () => expect(await direct("SELECT count(*) FROM user_associations WHERE object_name = 'TOIL_SLEEP'")).toEqual([[0]])],
      ['NOAUDIT ALL ON victim', async () => undefined],
      ['FLASHBACK TABLE old_victim TO BEFORE DROP', async () => expect(await tables()).toContain('OLD_VICTIM')],
      ['RENAME old_victim TO renamed', async () => expect(await tables()).toContain('RENAMED')],
      ['TRUNCATE TABLE people', async () => expect(await direct('SELECT count(*) FROM people')).toEqual([[0]])],
      ['DROP TABLE renamed', async () => expect(await tables()).not.toContain('RENAMED')],
      ['PURGE RECYCLEBIN', async () => expect(await direct('SELECT count(*) FROM user_recyclebin')).toEqual([[0]])],
    ];
    // Through toil first, while nothing has changed: every one is refused.
    for (const [sql] of escapes) {
      const envelope = await run(query, { sql: `/* c */ ${sql.toLowerCase()}` });
      expect(envelope.error, sql).toMatchObject({ code: 'WRITE_DISABLED', fix: expect.stringContaining('db execute') });
    }
    expect(await tables()).toEqual(['PEOPLE', 'TEAMS', 'VICTIM']);
    expect(await direct('SELECT count(*) FROM people')).toEqual([[12]]);
    // Then outside toil, in a read-only transaction: every one goes through.
    for (const [sql, changed] of escapes) {
      await readOnly(sql);
      await changed();
    }
  });

  it('refuses PL/SQL on reads, because a block, CALL or WITH FUNCTION can write from a read-only transaction', async () => {
    const escapes = [
      "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE made_by_block (x INTEGER)'; END;",
      'DECLARE PRAGMA AUTONOMOUS_TRANSACTION; BEGIN UPDATE people SET active = 0 WHERE id = 1; COMMIT; END;',
      "CALL DBMS_UTILITY.EXEC_DDL_STATEMENT('CREATE TABLE made_by_call (x INTEGER)')",
      'WITH FUNCTION f RETURN NUMBER IS PRAGMA AUTONOMOUS_TRANSACTION; BEGIN UPDATE people SET active = 0 WHERE id = 2; COMMIT; RETURN 1; END; SELECT f FROM dual',
    ];
    for (const sql of escapes) {
      const envelope = await run(query, { sql });
      expect(envelope.error, sql).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
    }
    expect(await tables()).toEqual(['PEOPLE', 'TEAMS']);
    for (const sql of escapes) await readOnly(sql);
    expect(await tables()).toEqual(['MADE_BY_BLOCK', 'MADE_BY_CALL', 'PEOPLE', 'TEAMS']);
    expect(await direct('SELECT active FROM people WHERE id IN (1, 2) ORDER BY id')).toEqual([[0], [0]]);
  });

  it('refuses MERGE, SELECT FOR UPDATE and a multi-table INSERT as writes, at the engine', async () => {
    for (const sql of ['MERGE INTO teams t USING dual ON (t.id = 1) WHEN MATCHED THEN UPDATE SET name = \'X\'', 'SELECT * FROM people FOR UPDATE', 'INSERT ALL INTO teams (id, name) VALUES (9, \'Nine\') SELECT * FROM dual']) {
      expect((await run(query, { sql })).error?.code, sql).toBe('WRITE_DISABLED');
    }
    expect(await direct('SELECT name FROM teams ORDER BY id')).toEqual([['Platform'], ['Data']]);
  });

  // Known limit, documented in skills/toil/db.md: a stored function that runs
  // an autonomous transaction writes even when a SELECT calls it from a
  // read-only transaction. It can't be refused by name, so the fix is an
  // account that can't write.
  it('known limit: a SELECT calling a stored autonomous-transaction function still writes', async () => {
    await write(`CREATE FUNCTION sneak RETURN NUMBER IS PRAGMA AUTONOMOUS_TRANSACTION; BEGIN UPDATE people SET active = 0 WHERE id = 1; COMMIT; RETURN 1; END;`);
    expect((await run(query, { sql: 'SELECT sneak() AS x FROM dual' })).data).toMatchObject({ rows: [[1]] });
    expect(await direct('SELECT active FROM people WHERE id = 1')).toEqual([[0]]);
  });

  // Known limit: Thin mode's break is in band, so a session asleep in
  // DBMS_SESSION.SLEEP only hears it when the sleep ends. toil still answers
  // CANCELLED at once; the server finishes the sleep, then stops.
  it('known limit: a cancelled DBMS_SESSION.SLEEP answers at once but sleeps on to the end', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const started = Date.now();
    const { context } = testContext({ config: { db: db.settings } });
    const envelope = await execute(query, { sql: 'SELECT toil_sleep(4) AS x FROM dual' }, { ...context, signal: controller.signal });
    expect(envelope.error?.code).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await db.running!()).toBe(1);
    await expect.poll(db.running!, { timeout: 10_000 }).toBe(0);
  });

  it('runs PL/SQL through db execute, to a / line', async () => {
    const sql = 'CREATE FUNCTION two RETURN NUMBER IS BEGIN RETURN 2; END;\n/\nUPDATE people SET active = two() WHERE id = 1;\nBEGIN\n  UPDATE people SET active = 3 WHERE id = 2;\nEND;\n/';
    expect((await write(sql)).data).toEqual({ changes: 1 });
    expect(await direct('SELECT active FROM people WHERE id IN (1, 2) ORDER BY id')).toEqual([[2], [3]]);
  });

  it('says which statements stay committed when a script with DDL fails', async () => {
    const envelope = await write("UPDATE people SET active = 0 WHERE id = 1; CREATE TABLE notes (id INTEGER); UPDATE people SET active = 0 WHERE id = 2; INSERT INTO teams (id, name) VALUES (1, 'Duplicate')");
    expect(envelope.error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('committed statements 1 to 2 of 4') });
    // The DDL committed the first UPDATE; the second rolled back with the failure.
    expect(await direct('SELECT active FROM people WHERE id IN (1, 2) ORDER BY id')).toEqual([[0], [1]]);
    expect(await tables()).toContain('NOTES');
  });

  // Oracle commits before a DDL statement runs, so one that fails after
  // parsing (a name already in use) has still committed the work before it.
  it('says the work before a failing DDL statement stayed committed, and not when nothing was', async () => {
    const failedDdl = await write('UPDATE people SET active = 0 WHERE id = 1; CREATE TABLE teams (id INTEGER)');
    expect(failedDdl.error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('ORA-00955') });
    expect(failedDdl.error?.message).toContain('committed statements 1 to 1 of 2');
    expect(await direct('SELECT active FROM people WHERE id = 1')).toEqual([[0]]);

    // A block that commits inside, then a failure: the same.
    const block = await write("UPDATE people SET active = 0 WHERE id = 2; BEGIN COMMIT; END;\n/\nINSERT INTO teams (id, name) VALUES (1, 'Duplicate')");
    expect(block.error?.message).toContain('committed statements 1 to 2 of 3');
    expect(await direct('SELECT active FROM people WHERE id = 2')).toEqual([[0]]);

    // A DDL statement Oracle refuses while parsing commits nothing, and the error says nothing about it.
    const parse = await write('UPDATE people SET active = 0 WHERE id = 4; CREATE TABLEX notes');
    expect(parse.error?.code).toBe('DATABASE');
    expect(parse.error?.message).not.toContain('committed');
    expect(await direct('SELECT active FROM people WHERE id = 4')).toEqual([[1]]);
  });

  it('refuses a script that ends the transaction, even after a comment, before running any of it', async () => {
    const envelope = await write('UPDATE people SET active = 0 WHERE id = 1; /* x */ commit work; SELECT * FROM no_such_table');
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(await direct('SELECT active FROM people WHERE id = 1')).toEqual([[1]]);
  });

  it('lists its own schema, and not the ones Oracle maintains', async () => {
    const names = ((await run(listSchemas, {})).data as { schemas: Array<{ name: string }> }).schemas.map((s) => s.name);
    expect(names).toContain(db.schema);
    expect(names).not.toContain('SYS');
    expect(names).not.toContain('SYSTEM');
  });

  it('marks its sessions as toil in v$session, and runs in Thin mode', async () => {
    expect(await run(query, { sql: "SELECT SYS_CONTEXT('USERENV', 'MODULE') FROM dual" })).toMatchObject({ data: { rows: [['toil']] } });
    expect(oracledb.thin).toBe(true);
  });

  it('answers an unknown service with NOT_FOUND and a wrong password with AUTH, never echoing the password', async () => {
    const missing = await run(listSchemas, {}, { ...db.settings, database: 'NO_SUCH_SERVICE' });
    expect(missing.error?.code).toBe('NOT_FOUND');
    const debug: string[] = [];
    const wrong = await run(listSchemas, {}, { ...db.settings, password: 'not-the-password-123' }, (m) => debug.push(m));
    expect(wrong.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('connections login db') });
    expect(JSON.stringify(wrong) + debug.join('\n')).not.toContain('not-the-password-123');
    expect(debug.join('\n')).toContain('connection db');
  });

  it('answers a closed port with NETWORK', async () => {
    expect((await run(listSchemas, {}, { ...db.settings, host: '127.0.0.1', port: 1 })).error?.code).toBe('NETWORK');
  });
});
