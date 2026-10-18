import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { connectionConfig } from '../../src/core/db/sqlserver/index.js';
import { scanScript } from '../../src/core/db/sqlserver/script.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import type { NetworkApis } from '../../src/core/network.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { targets, type TargetDatabase } from './targets.js';

/**
 * What only SQL Server does, beyond the shared conformance suite: finding
 * transaction control in a T-SQL script, the connection settings, how values
 * become JSON, and how a read stays read-only on an engine with no read-only
 * transaction. The scanner and settings tests run offline; the rest need the
 * server the conformance target reaches, and skip with it. Each test gets its
 * own database, which the server provisions at the pace of a facilities request.
 */

const control = (sql: string) => scanScript(sql).transactionControl;

describe('sqlserver script scanning', () => {
  it('finds transaction control outside strings, quoted identifiers and comments', () => {
    for (const [sql, word] of [
      ['COMMIT', 'COMMIT'],
      ['UPDATE t SET x = 1 COMMIT', 'COMMIT'],
      ['  /* a /* nested */ b */ rollback tran', 'ROLLBACK'],
      ['-- x\nBEGIN TRANSACTION', 'BEGIN TRANSACTION'],
      ['begin tran', 'BEGIN TRAN'],
      ['BEGIN DISTRIBUTED TRANSACTION', 'BEGIN DISTRIBUTED'],
      ['SAVE TRANSACTION s', 'SAVE TRANSACTION'],
      ['UPDATE t SET x = 1; BEGIN; UPDATE t SET x = 2', 'BEGIN'],
      ['UPDATE t SET x = 1; END; UPDATE t SET x = 2', 'END'],
      ["EXEC('x') COMMIT", 'COMMIT'],
    ] as const) {
      expect(control(sql), sql).toBe(word);
    }
  });

  it('leaves blocks, CASE, TRY/CATCH and quoted words alone', () => {
    for (const sql of [
      "SELECT 'COMMIT', N'rollback; begin tran' AS s",
      'SELECT [commit], "rollback" FROM t',
      'SELECT [we]]ird commit] FROM t',
      '-- COMMIT\nSELECT 1 /* ROLLBACK */',
      'IF 1 = 1 BEGIN UPDATE t SET x = 1 END',
      'SELECT CASE WHEN x = 1 THEN 2 END FROM t',
      'BEGIN TRY SELECT 1 END TRY BEGIN CATCH SELECT 2 END CATCH',
      'SELECT 1e5 AS end_value, @begin, #end FROM t',
    ]) {
      expect(control(sql), sql).toBeUndefined();
    }
  });

  it('finds an OUTPUT clause on a data change, and leaves a column or alias named output alone', () => {
    for (const sql of [
      'UPDATE t SET x = 1 OUTPUT inserted.id',
      'DELETE FROM t OUTPUT deleted.*',
      'INSERT INTO t (x) OUTPUT inserted.x VALUES (1)',
      'WITH c AS (SELECT 1 AS id) MERGE t USING c ON t.id = c.id WHEN MATCHED THEN DELETE OUTPUT deleted.id;',
    ]) {
      expect(scanScript(sql).output, sql).toBe(true);
    }
    // The reviewer's table: plain reads with a column or alias named output.
    for (const sql of ['SELECT output FROM jobs', 'SELECT j.output FROM jobs j', 'SELECT name AS Output FROM t', 'SELECT [output] FROM jobs', "SELECT 'UPDATE' AS output FROM t -- delete"]) {
      expect(scanScript(sql).output, sql).toBe(false);
    }
  });

  it('knows SQL that holds no statement', () => {
    expect(scanScript(';; -- nothing\n /* here */ ;').empty).toBe(true);
    expect(scanScript("SELECT 1; /* trailing */").empty).toBe(false);
  });
});

describe('sqlserver connection settings', () => {
  const conn = { name: 'db', area: 'db', engine: 'sqlserver', host: 'db.imagile.dev', database: 'app', user: 'reader', password: 'from-toil' } as unknown as DbConnection;

  it('verifies TLS only when ssl is on, and never trusts any certificate', () => {
    const plain = connectionConfig(conn);
    expect(plain).toMatchObject({ server: 'db.imagile.dev', authentication: { type: 'default', options: { userName: 'reader', password: 'from-toil' } } });
    expect(plain.options).toMatchObject({ port: 1433, database: 'app', encrypt: false, trustServerCertificate: false, appName: 'toil', requestTimeout: 0 });
    expect(connectionConfig({ ...conn, ssl: true, port: 14330 } as DbConnection, () => {}, caApis(['CORP-ROOT'])).options).toMatchObject({ encrypt: true, trustServerCertificate: false, port: 14330 });
  });

  // tedious opens its own socket, so core's HTTP setup never loads the OS store for it.
  const caApis = (system: string[] | Error): NetworkApis => ({
    getCACertificates: ((type?: string) => {
      if (system instanceof Error) throw system;
      return type === 'system' ? system : ['BUNDLED-1'];
    }) as NetworkApis['getCACertificates'],
    setDefaultCACertificates: () => {},
    setGlobalProxyFromEnv: () => () => {},
  });

  it("verifies TLS against Node's CAs plus the OS store when ssl is on, and reads nothing without it", () => {
    expect(connectionConfig({ ...conn, ssl: true } as DbConnection, () => {}, caApis(['CORP-ROOT'])).options?.cryptoCredentialsDetails).toEqual({ ca: ['BUNDLED-1', 'CORP-ROOT'] });
    const debug: string[] = [];
    expect(connectionConfig({ ...conn, ssl: true } as DbConnection, (m) => debug.push(m), caApis(new Error('store locked'))).options?.cryptoCredentialsDetails).toBeUndefined();
    expect(debug.join()).toContain('store locked');
    expect(connectionConfig(conn, () => {}, caApis(new Error('never read'))).options?.cryptoCredentialsDetails).toBeUndefined();
  });
});

const target = targets.find((t) => t.engine === 'sqlserver')!;
const skip = await target.skip?.();

describe.skipIf(skip !== undefined)(`sqlserver server${skip ? ` (skipped: ${skip})` : ''}`, () => {
  let db: TargetDatabase;
  beforeEach(async () => {
    db = await target.setup();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  const settings = () => db.settings as Record<string, string | number>;
  const run = (def: AnyCommand, input: Record<string, unknown>, s: Settings = db.settings, debug: (m: string) => void = () => {}) => {
    const { context } = testContext({ config: { db: s } });
    return execute(def, input, { ...context, debug });
  };
  const direct = (sql: string) => db.rows(sql) as Promise<Array<Record<string, unknown>>>;
  const activeSum = async () => Number((await direct('SELECT SUM(active) AS n FROM people'))[0]!.n);

  it('turns SQL Server values into JSON without losing or shifting anything', async () => {
    const envelope = await run(query, {
      sql: `SELECT 42 AS i, CAST(9007199254740993 AS bigint) AS big, CAST(7 AS bigint) AS small, CAST(1.5 AS decimal(10,2)) AS num, CAST(2.5 AS float) AS f,
              CAST(1 AS bit) AS b, N'x' AS t, CAST(NULL AS nvarchar(10)) AS n, 0x0102FF AS bin, CAST('abc12345-0000-0000-0000-000000000000' AS uniqueidentifier) AS g,
              CAST('2026-01-02' AS date) AS d, CAST('2026-01-02 03:04:05.123' AS datetime2(3)) AS ts, CAST('2026-01-02 03:04:05' AS datetime) AS dt,
              CAST('2026-01-02 03:04:05 +02:00' AS datetimeoffset(0)) AS dto, CAST('03:04:05' AS time(0)) AS tm`,
    });
    expect(envelope.error).toBeNull();
    const data = envelope.data as { columns: Array<{ name: string; type: string }>; rows: unknown[][] };
    expect(data.columns.map((c) => c.type)).toEqual([
      'int', 'bigint', 'bigint', 'decimal(10,2)', 'float', 'bit', 'nvarchar(1)', 'nvarchar(10)', 'varbinary(3)', 'uniqueidentifier',
      'date', 'datetime2(3)', 'datetime', 'datetimeoffset(0)', 'time(0)',
    ]);
    const [row] = data.rows;
    expect(row!.slice(0, 10)).toEqual([42, '9007199254740993', 7, 1.5, 2.5, true, 'x', null, 'AQL/', 'ABC12345-0000-0000-0000-000000000000']);
    // As the server holds them: no shift into the local zone of whoever ran toil.
    expect(row!.slice(10)).toEqual(['2026-01-02', '2026-01-02 03:04:05.123', '2026-01-02 03:04:05.000', '2026-01-02T01:04:05.000Z', '03:04:05.000']);
  });

  it("reports a table column's declared type with its length", async () => {
    const envelope = await run(query, { sql: 'SELECT TOP 1 id, name FROM people' });
    expect((envelope.data as { columns: unknown }).columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'name', type: 'varchar(100)' },
    ]);
    const d = (await run(describeTable, { table: 'people' })).data as { columns: Array<{ name: string; type: string; default: string | null }> };
    expect(d.columns.map((c) => c.type)).toEqual(['int', 'varchar(100)', 'int', 'int']);
  });

  // The server reports each statement's type in its DONE token; every type
  // toil treats as a write is run here, so a wrong number fails a test.
  it('refuses every statement the server reports as a write, and nothing is changed', async () => {
    await direct('CREATE TABLE scratch (id int)');
    for (const sql of [
      'SELECT id INTO copied FROM people',
      "INSERT INTO teams (id, name) VALUES (3, 'Ops')",
      'DELETE FROM people WHERE id = 1',
      'UPDATE people SET active = 0',
      "MERGE teams AS t USING (SELECT 1 AS id) AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = 'x';",
      'CREATE TABLE notes (id int)',
      'DROP TABLE scratch',
      'CREATE INDEX people_name ON people (name)',
      'DROP INDEX people_team ON people',
      "EXEC('CREATE VIEW more_people AS SELECT id FROM people')",
      'ALTER TABLE people ADD extra int NULL',
      "EXEC('CREATE PROCEDURE p AS SELECT 1')",
      'TRUNCATE TABLE scratch',
      'UPDATE STATISTICS people',
      "EXEC('UPDATE people SET active = 0')",
      'SELECT id FROM people; UPDATE people SET active = 0',
    ]) {
      const envelope = await run(query, { sql }, { ...db.settings, writes: true });
      expect(envelope.error?.code, sql).toBe('WRITE_DISABLED');
    }
    expect(await activeSum()).toBe(8);
    expect((await direct("SELECT COUNT(*) AS n FROM sys.objects WHERE name IN ('copied', 'notes', 'more_people', 'p', 'people_name')"))[0]!.n).toBe(0);
    expect((await direct("SELECT COUNT(*) AS n FROM sys.objects WHERE name = 'scratch'"))[0]!.n).toBe(1);
    expect((await run(describeTable, { table: 'people' })).data).toMatchObject({ indexes: expect.arrayContaining([expect.objectContaining({ name: 'people_team' })]) });
  });

  // The escape that makes the deny necessary: a COMMIT in the SQL ends the
  // transaction toil would roll back, so the write before it is saved.
  it('refuses COMMIT, ROLLBACK and the rest on reads, because a COMMIT saves the write before it', async () => {
    await direct('BEGIN TRANSACTION; UPDATE people SET active = 0 WHERE id = 1; COMMIT; IF @@TRANCOUNT > 0 ROLLBACK');
    expect(await activeSum()).toBe(7);
    for (const sql of ['UPDATE people SET active = 0 COMMIT', 'ROLLBACK; UPDATE people SET active = 0', 'BEGIN TRANSACTION', 'SAVE TRANSACTION s', 'COMMIT']) {
      const envelope = await run(query, { sql }, { ...db.settings, writes: true });
      expect(envelope.error, sql).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
    }
    expect(await activeSum()).toBe(7);
  });

  // Known limit, documented in skills/toil/db.md: a COMMIT inside dynamic SQL
  // or a procedure can't be refused by name. toil sees the transaction end
  // and says so loudly; a read-only login is what stops the write.
  it('known limit: a COMMIT inside dynamic SQL saves a write, and the read says so', async () => {
    const envelope = await run(query, { sql: "EXEC('SET NOCOUNT ON; UPDATE people SET active = 0 WHERE id = 1; COMMIT')" }, { ...db.settings, writes: true });
    expect(envelope.error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('may have been saved') });
    expect(await activeSum()).toBe(7);
    const script = await run(executeCmd, { sql: "UPDATE people SET active = 0 WHERE id = 2; EXEC('COMMIT')", allowWrite: true }, { ...db.settings, writes: true });
    expect(script.error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('may have been applied') });
  });

  it('with a read-only login, the server itself refuses the write', async () => {
    const login = `toil_reader_${randomBytes(4).toString('hex')}`;
    const password = `Rd-${randomBytes(8).toString('hex')}-Aa1`;
    await direct(`CREATE LOGIN ${login} WITH PASSWORD = '${password}', CHECK_POLICY = OFF; CREATE USER ${login} FOR LOGIN ${login}; ALTER ROLE db_datareader ADD MEMBER ${login}`);
    try {
      const reader = { ...db.settings, user: login, password, writes: true };
      expect((await run(query, { sql: 'SELECT COUNT(*) AS n FROM people' }, reader)).data).toMatchObject({ rows: [[12]] });
      for (const sql of ['UPDATE people SET active = 0', 'SET NOCOUNT ON; UPDATE people SET active = 0', "EXEC('DELETE FROM people')", 'DROP TABLE people', 'CREATE TABLE notes (id int)']) {
        expect((await run(query, { sql }, reader)).error?.code, sql).toBe('WRITE_DISABLED');
      }
      // 262 also refuses reads, such as a DMV that needs VIEW DATABASE STATE: a permission error, not a write.
      // (SQL Server 2022 answers these with 262, VIEW DATABASE PERFORMANCE STATE, and 300.)
      for (const sql of ['SELECT COUNT(*) AS n FROM sys.dm_db_partition_stats', 'SELECT COUNT(*) AS n FROM sys.dm_db_index_usage_stats']) {
        const denied = await run(query, { sql }, reader);
        expect(denied.error, sql).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('permission'), fix: expect.stringContaining('lacks that permission') });
      }
      // A write through execute reaches the same refusal: the login is the boundary.
      const denied = await run(executeCmd, { sql: 'UPDATE people SET active = 0', allowWrite: true }, reader);
      expect(denied.error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('permission') });
      expect(await activeSum()).toBe(8);
    } finally {
      await direct(`DROP USER ${login}`);
      await direct(`DROP LOGIN ${login}`);
    }
  });

  it('stops the server once a page is full', async () => {
    const debug: string[] = [];
    const envelope = await run(query, { sql: 'WITH n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT x FROM n OPTION (MAXRECURSION 0)', limit: 3 }, db.settings, (m) => debug.push(m));
    expect((envelope.data as { rows: unknown[][] }).rows).toEqual([[1], [2], [3]]);
    expect(envelope.meta.page?.nextCursor).toEqual(expect.any(String));
    await expect.poll(db.running!, { timeout: 5000 }).toBe(0);
  });

  // An OUTPUT clause streams the changed rows before the statement's DONE token, so a full page
  // would stop it before the server said it was a write; reads refuse OUTPUT outright.
  it('refuses OUTPUT on reads, whatever the page size', async () => {
    for (const limit of [1, 100]) {
      const envelope = await run(query, { sql: 'UPDATE people SET active = 0 OUTPUT inserted.id', limit }, { ...db.settings, writes: true });
      expect(envelope.error, String(limit)).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
    }
    expect((await run(query, { sql: 'UPDATE people SET active = 0 OUTPUT inserted.id' })).error?.fix).toContain('[output]');
    // A column named output is an ordinary read.
    await direct('CREATE TABLE jobs (id int, output varchar(20))');
    await direct("INSERT INTO jobs VALUES (1, 'done')");
    expect((await run(query, { sql: 'SELECT j.output FROM jobs j' })).data).toMatchObject({ rows: [['done']] });
    expect(await activeSum()).toBe(8);
  });

  it('refuses SQL that holds no statement', async () => {
    expect((await run(query, { sql: '-- only a comment' })).error?.code).toBe('INVALID_INPUT');
  });

  it('runs a script with a block and a CASE through db execute, and counts only changed rows', async () => {
    const sql = "IF EXISTS (SELECT 1 FROM people) BEGIN UPDATE people SET active = CASE WHEN id = 1 THEN 0 ELSE active END END; SELECT * FROM teams";
    expect((await run(executeCmd, { sql, allowWrite: true }, { ...db.settings, writes: true })).data).toEqual({ changes: 12 });
    expect(await activeSum()).toBe(7);
  });

  it('describes a table in another schema, with a composite key and actions on its foreign key', async () => {
    await direct('CREATE SCHEMA hr');
    await direct(`CREATE TABLE hr.badges (team_id int NOT NULL REFERENCES dbo.teams (id) ON DELETE CASCADE, seq int NOT NULL, code nvarchar(max), CONSTRAINT badges_pk PRIMARY KEY (team_id, seq));
      CREATE UNIQUE INDEX badges_code ON hr.badges (seq, team_id)`);
    expect(((await run(listSchemas, {})).data as { schemas: Array<{ name: string }> }).schemas.map((s) => s.name)).toEqual(['dbo', 'hr']);
    expect((await run(listTables, { schema: 'hr' })).data).toEqual({ schema: 'hr', tables: [{ name: 'badges', type: 'table' }] });
    const d = (await run(describeTable, { table: 'badges', schema: 'hr' })).data as Record<string, unknown>;
    expect(d).toMatchObject({ schema: 'hr', name: 'badges', primaryKey: ['team_id', 'seq'] });
    expect((d.columns as Array<{ type: string }>).map((c) => c.type)).toEqual(['int', 'int', 'nvarchar(max)']);
    expect(d.foreignKeys).toEqual([{ columns: ['team_id'], references: { schema: 'dbo', table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: 'CASCADE' }]);
    expect(d.indexes).toEqual([
      { name: 'badges_code', columns: ['seq', 'team_id'], unique: true },
      { name: 'badges_pk', columns: ['team_id', 'seq'], unique: true },
    ]);
    expect((await run(previewTable, { table: 'badges', schema: 'hr' })).data).toEqual({ columns: expect.any(Array), rows: [] });
  });

  it('answers a missing database with NOT_FOUND and a wrong password with AUTH, never echoing the password', async () => {
    const missing = await run(listSchemas, {}, { ...db.settings, database: 'no_such_database' });
    expect(missing.error?.code).toBe('NOT_FOUND');
    const debug: string[] = [];
    const wrong = await run(listSchemas, {}, { ...db.settings, password: 'not-the-password-123' }, (m) => debug.push(m));
    expect(wrong.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('connections login db') });
    expect(JSON.stringify(wrong) + debug.join('\n')).not.toContain('not-the-password-123');
    expect(JSON.stringify(wrong) + debug.join('\n')).not.toContain(String(settings().password));
    expect(debug.join('\n')).toContain('connection db');
  });

  it('answers a closed port with NETWORK, and a server that wants TLS it can verify with NETWORK too', async () => {
    expect((await run(listSchemas, {}, { ...db.settings, host: '127.0.0.1', port: 1 })).error?.code).toBe('NETWORK');
    // The test server's certificate is self-signed, so verifying it fails, and toil has no switch to skip that.
    const tls = await run(listSchemas, {}, { ...db.settings, ssl: true });
    expect(tls.error).toMatchObject({ code: 'NETWORK', fix: expect.stringContaining('NODE_EXTRA_CA_CERTS') });
  });
});
