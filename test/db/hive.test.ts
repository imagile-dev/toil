import { afterEach, describe, expect, it } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { providerFor } from '../../src/core/db/engines.js';
import { LinkFailed } from '../../src/core/db/hive/hs2.js';
import { hiveProvider, impalaProvider, refusedPrivilege, toToilError } from '../../src/core/db/hive/index.js';
import { decodeRows, typeName } from '../../src/core/db/hive/rows.js';
import { encodeCursor, pageKey } from '../../src/core/db/paging.js';
import { splitStatements } from '../../src/core/db/hive/split.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import type { Envelope } from '../../src/core/envelope.js';
import { ToilError } from '../../src/core/errors.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { engineQuery } from '../harness/db.js';
import { fakeHs2, type FakeHs2, type FakeOptions } from '../harness/hs2-server.js';
import { hive } from './targets.js';

/**
 * Hive and Impala's provider, offline, against the HiveServer2 in
 * test/harness/hs2-server.ts: the sign-in, value mapping, paging, error
 * mapping, the read-only rules and cancellation, through the real protocol
 * and the real commands. What a live server does is the conformance suite's
 * job (test/db/targets.ts); this file is what can be pinned without one.
 */

let server: FakeHs2 | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const SASL = { user: 'toil_reader', password: 'pw' };

async function start(options: FakeOptions = {}): Promise<FakeHs2> {
  server = await fakeHs2({ sasl: SASL, ...options });
  return server;
}

function settings(engine: 'hive' | 'impala' = 'hive', extra: Settings = {}): Settings {
  return { engine, host: '127.0.0.1', port: server!.port, user: SASL.user, password: SASL.password, ...extra };
}

function run(def: AnyCommand, input: Record<string, unknown>, opts: { settings?: Settings; writes?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Envelope> {
  const { context } = testContext({ config: { db: { ...(opts.settings ?? settings()), ...(opts.writes ? { writes: true } : {}) } } });
  return execute(def, input, { ...context, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
}

const methods = () => server!.calls.map((c) => c.method);
const executed = () => server!.calls.filter((c) => c.method === 'ExecuteStatement').map((c) => c.request.statement);

describe('hive statement splitting', () => {
  it('cuts at semicolons outside strings, quoted names and comments, and drops empty pieces', () => {
    expect(splitStatements("SELECT ';', \"a;b\", `c;d` FROM t -- x;\n; /* ; */ ;").map((s) => s.text)).toEqual(["SELECT ';', \"a;b\", `c;d` FROM t -- x;"]);
    expect(splitStatements('SELECT 1; SELECT 2').map((s) => s.text)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(splitStatements("SELECT 'it\\'s; fine'").map((s) => s.text)).toEqual(["SELECT 'it\\'s; fine'"]);
    expect(splitStatements('-- only a comment\n/* and another */;')).toEqual([]);
    expect(splitStatements('/* a */ SELECT 2 /* b */')[0]!.words).toEqual(['SELECT']);
  });
});

describe('hive values and types', () => {
  it('names result types as HiveQL writes them, with lengths and precision', () => {
    const col = (type: number, qualifiers?: Record<string, number>) => ({
      columnName: 'c',
      position: 1,
      typeDesc: { types: [{ primitiveEntry: { type, typeQualifiers: qualifiers ? { qualifiers: Object.fromEntries(Object.entries(qualifiers).map(([k, v]) => [k, { i32Value: v }])) } : null } }] },
    });
    expect(typeName(col(3))).toBe('INT');
    expect(typeName(col(18, { characterMaximumLength: 100 }))).toBe('VARCHAR(100)');
    expect(typeName(col(15, { precision: 10, scale: 2 }))).toBe('DECIMAL(10,2)');
    expect(typeName(col(16))).toBeNull();
    expect(typeName({ columnName: 'a', position: 1, typeDesc: { types: [{ arrayEntry: {} }] } })).toBe('ARRAY');
  });

  it('turns columnar results into rows, with nulls from the bitmap and BIGINT as BigInt', () => {
    const big = Buffer.from('0020000000000001', 'hex');
    const rows = decodeRows({
      columns: [
        { i32Val: { values: [1, 0, 3], nulls: Buffer.from([0b010]) } },
        { i64Val: { values: [{ buffer: big, offset: 0 }, { buffer: Buffer.alloc(8), offset: 0 }, { buffer: Buffer.alloc(8), offset: 0 }], nulls: Buffer.from([0b110]) } },
      ],
    });
    expect(rows).toEqual([
      [1, 9007199254740993n],
      [null, null],
      [3, null],
    ]);
  });
});

describe('hive provider over HiveServer2', () => {
  it('signs in with SASL PLAIN, opens a session with its settings, and maps every value', async () => {
    await start({
      statements: {
        'SELECT * FROM t': {
          columns: [
            { name: 'i', type: 'INT_TYPE' },
            { name: 'big', type: 'BIGINT_TYPE' },
            { name: 'd', type: 'DECIMAL_TYPE', qualifiers: { precision: 20, scale: 2 } },
            { name: 'b', type: 'BOOLEAN_TYPE' },
            { name: 'bin', type: 'BINARY_TYPE' },
            { name: 'f', type: 'DOUBLE_TYPE' },
            { name: 'ts', type: 'TIMESTAMP_TYPE' },
            { name: 'v', type: 'VARCHAR_TYPE', qualifiers: { characterMaximumLength: 10 } },
            { name: 'arr', type: 'ARRAY_TYPE' },
          ],
          rows: [
            [1, 9007199254740993n, '123456789012345678.91', true, Buffer.from('hi'), 2.5, '2026-01-02 03:04:05.123456', 'Ada', '[1,2]'],
            [null, 42n, null, false, null, null, null, null, null],
          ],
        },
      },
    });
    const envelope = await run(query, { sql: 'SELECT * FROM t', lint: false }, { settings: settings('hive', { database: 'sales' }) });
    expect(envelope.error).toBeNull();
    expect(envelope.data).toEqual({
      columns: [
        { name: 'i', type: 'INT' },
        { name: 'big', type: 'BIGINT' },
        { name: 'd', type: 'DECIMAL(20,2)' },
        { name: 'b', type: 'BOOLEAN' },
        { name: 'bin', type: 'BINARY' },
        { name: 'f', type: 'DOUBLE' },
        { name: 'ts', type: 'TIMESTAMP' },
        { name: 'v', type: 'VARCHAR(10)' },
        { name: 'arr', type: 'ARRAY' },
      ],
      rows: [
        [1, '9007199254740993', '123456789012345678.91', true, 'aGk=', 2.5, '2026-01-02 03:04:05.123456', 'Ada', '[1,2]'],
        [null, 42, null, false, null, null, null, null, null],
      ],
    });
    const open = server!.calls.find((c) => c.method === 'OpenSession')!.request;
    expect(open).toMatchObject({ username: 'toil_reader', password: 'pw', configuration: { 'use:database': 'sales', 'set:hiveconf:hive.resultset.use.unique.column.names': 'false' } });
    expect(methods()).toEqual(['OpenSession', 'ExecuteStatement', 'GetOperationStatus', 'GetResultSetMetadata', 'FetchResults', 'FetchResults', 'CloseOperation', 'CloseSession']);
  });

  it('sends Impala only the database to start in, since it reads any other key as a query option', async () => {
    await start({ statements: { 'SELECT 1 AS x': { columns: [{ name: 'x', type: 'TINYINT_TYPE' }], rows: [[1]] } } });
    expect((await run(query, { sql: 'SELECT 1 AS x' }, { settings: settings('impala', { database: 'sales' }) })).data).toEqual({ columns: [{ name: 'x', type: 'TINYINT' }], rows: [[1]] });
    expect(server!.calls.find((c) => c.method === 'OpenSession')!.request.configuration).toEqual({ 'use:database': 'sales' });
  });

  it('signs in without SASL when auth is nosasl, sending the user and no password', async () => {
    await start({ sasl: undefined, statements: { 'SELECT 1 AS x': { columns: [{ name: 'x', type: 'INT_TYPE' }], rows: [[1]] } } });
    const envelope = await run(query, { sql: 'SELECT 1 AS x' }, { settings: { engine: 'impala', host: '127.0.0.1', port: server!.port, user: 'impala', auth: 'nosasl' } });
    expect(envelope.data).toEqual({ columns: [{ name: 'x', type: 'INT' }], rows: [[1]] });
    expect(server!.calls[0]!.request).toMatchObject({ username: 'impala', password: null });
  });

  it('pages: skips to the offset in batches, stops at the page, and closes the statement', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => [i + 1]);
    await start({ batch: 700, statements: { 'SELECT x FROM n': { columns: [{ name: 'x', type: 'INT_TYPE' }], rows } } });
    const first = await run(query, { sql: 'SELECT x FROM n', limit: 5 });
    expect((first.data as { rows: unknown[][] }).rows).toEqual([[1], [2], [3], [4], [5]]);
    expect(first.meta.page?.nextCursor).toEqual(expect.any(String));
    server!.calls.length = 0;
    const later = await run(query, { sql: 'SELECT x FROM n', limit: 5, cursor: encodeCursor(1005, pageKey('db query', 'SELECT x FROM n')) });
    expect((later.data as { rows: unknown[][] }).rows).toEqual([[1006], [1007], [1008], [1009], [1010]]);
    expect(later.meta.page?.nextCursor).toEqual(expect.any(String));
    const asked = server!.calls.filter((c) => c.method === 'FetchResults').map((c) => Number(c.request.maxRows));
    // 1005 rows skipped as 1000 then 5 (the server sends at most 700 at a time), then the page's six.
    expect(asked).toEqual([1000, 305, 6]);
    expect(methods().at(-2)).toBe('CloseOperation');
  });

  it('keeps fetching through an empty batch the server says has more behind it, as Impala sends when no row is ready yet', async () => {
    await start({ stall: 2, statements: { 'SELECT x FROM n': { columns: [{ name: 'x', type: 'INT_TYPE' }], rows: [[1], [2]] } } });
    expect((await run(query, { sql: 'SELECT x FROM n' }, { settings: settings('impala') })).data).toEqual({ columns: [{ name: 'x', type: 'INT' }], rows: [[1], [2]] });
    expect(methods().filter((m) => m === 'FetchResults')).toHaveLength(4);
  });

  it('sends one statement without its semicolon or trailing comments, and refuses several before connecting', async () => {
    await start({ statements: { 'SELECT 1 AS x': { columns: [{ name: 'x', type: 'INT_TYPE' }], rows: [[1]] } } });
    expect((await run(query, { sql: 'SELECT 1 AS x; -- done' })).error).toBeNull();
    expect(executed()).toEqual(['SELECT 1 AS x']);
    server!.calls.length = 0;
    const conn = { ...settings(), name: 'db', area: 'db', writes: true } as DbConnection;
    await expect(engineQuery(settings(), 'SELECT 1; SELECT 2')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(hiveProvider.execute(conn, 'UPDATE a SET x = 1; UPDATE b SET y = 2', { signal: new AbortController().signal, debug: () => {} })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      fix: expect.stringContaining('no transactions'),
    });
    await expect(engineQuery(settings(), '-- nothing\n;')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(server!.calls).toEqual([]);
  });

  it("reports the server's error as DATABASE, and a write a read-only account was refused as WRITE_DISABLED", async () => {
    const denied = (privilege: string) =>
      `Error while compiling statement: FAILED: HiveAccessControlException Permission denied: Principal [name=toil_reader, type=USER] does not have following privileges for operation QUERY [[${privilege}] on Object [type=TABLE_OR_VIEW, name=sales.people]]`;
    await start({
      statements: {
        'SELECT nope': { error: { sqlState: '42000', errorCode: 10004, errorMessage: "Error while compiling statement: FAILED: SemanticException Invalid column reference 'nope'" } },
        'UPDATE people SET a = 1': { error: { sqlState: '42000', errorCode: 40000, errorMessage: denied('DELETE, INSERT') } },
        'SELECT secret FROM vault': { error: { sqlState: '42000', errorCode: 40000, errorMessage: denied('SELECT') } },
        'SELECT slow': { error: { errorMessage: 'Error while processing statement: FAILED: Execution Error, return code 2' }, async: true },
      },
    });
    expect(await engineQuery(settings(), 'SELECT nope').catch((e: ToilError) => [e.code, e.message])).toEqual(['DATABASE', expect.stringContaining('Hive: Error while compiling statement')]);
    await expect(engineQuery(settings(), 'UPDATE people SET a = 1')).rejects.toMatchObject({ code: 'WRITE_DISABLED', message: expect.stringContaining('Nothing was changed') });
    await expect(engineQuery(settings(), 'SELECT secret FROM vault')).rejects.toMatchObject({ code: 'DATABASE', fix: expect.stringContaining('lacks that privilege') });
    await expect(engineQuery(settings(), 'SELECT slow')).rejects.toMatchObject({ code: 'DATABASE', message: expect.stringContaining('return code 2') });
    const conn = { ...settings(), name: 'db', area: 'db', writes: true } as DbConnection;
    // On a write the same refusal is a permission problem, not a read that wrote.
    await expect(hiveProvider.execute(conn, 'UPDATE people SET a = 1', { signal: new AbortController().signal, debug: () => {} })).rejects.toMatchObject({ code: 'DATABASE' });
  });

  it('reports a read the server says changed rows for what it is: a write that happened', async () => {
    await start({ statements: { 'FROM a INSERT INTO b SELECT x': { modified: 3 } } });
    await expect(engineQuery(settings(), 'FROM a INSERT INTO b SELECT x')).rejects.toMatchObject({
      code: 'DATABASE',
      message: expect.stringContaining('changed 3 rows'),
      fix: expect.stringContaining('read-only account'),
    });
  });

  it("counts a write's changes: Hive's from its status, Impala's from CloseImpalaOperation", async () => {
    await start({
      statements: {
        "INSERT INTO teams VALUES (3, 'Ops')": { modified: 1 },
        'UPDATE people SET active = 0': { modified: 0, impala: { rowsModified: 3, rowsDeleted: 3 } },
        'DELETE FROM people WHERE id = 4': { modified: 0, impala: { rowsDeleted: 1 } },
      },
    });
    expect((await run(executeCmd, { sql: "INSERT INTO teams VALUES (3, 'Ops')", allowWrite: true }, { writes: true })).data).toEqual({ changes: 1 });
    expect(methods()).toContain('CloseOperation');
    const impala = settings('impala');
    expect((await run(executeCmd, { sql: 'UPDATE people SET active = 0', allowWrite: true }, { settings: impala, writes: true })).data).toEqual({ changes: 3 });
    expect((await run(executeCmd, { sql: 'DELETE FROM people WHERE id = 4', allowWrite: true }, { settings: impala, writes: true })).data).toEqual({ changes: 1 });
    expect(methods().filter((m) => m === 'CloseImpalaOperation')).toHaveLength(2);
  });

  it('stops a statement on cancel: CancelOperation on a second connection and its own, then closes the session', async () => {
    await start({ statements: { 'SELECT slow': { hang: true } } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const envelope = await run(query, { sql: 'SELECT slow' }, { signal: controller.signal });
    expect(envelope.error?.code).toBe('CANCELLED');
    await expect.poll(() => server!.cancelled).toEqual(expect.arrayContaining(['SELECT slow']));
    await expect.poll(() => server!.calls.filter((c) => c.method === 'CancelOperation').map((c) => c.connection).sort()).toEqual([1, 2]);
    await expect.poll(() => server!.calls.filter((c) => c.method === 'CloseSession' && c.connection === 1)).toHaveLength(1);
  });

  it('stops a statement at the time limit the same way', async () => {
    await start({ statements: { 'SELECT slow': { hang: true } } });
    const envelope = await run(query, { sql: 'SELECT slow' }, { timeoutMs: 300 });
    expect(envelope.error?.code).toBe('TIMEOUT');
    await expect.poll(() => server!.cancelled).toContain('SELECT slow');
  });

  it('lists schemas without the engine\'s own, and tables by exact schema though the protocol matches patterns', async () => {
    const schemas = { columns: [{ name: 'TABLE_SCHEM', type: 'STRING_TYPE' }, { name: 'TABLE_CATALOG', type: 'STRING_TYPE' }], rows: [['sales', ''], ['default', ''], ['sys', ''], ['sales_x', '']] };
    await start({
      catalog: {
        GetSchemas: schemas,
        GetTables: {
          columns: ['TABLE_CAT', 'TABLE_SCHEM', 'TABLE_NAME', 'TABLE_TYPE'].map((name) => ({ name, type: 'STRING_TYPE' })),
          rows: [['', 'sales', 'people', 'TABLE'], ['', 'sales', 'active', 'VIEW'], ['', 'salesx', 'other', 'TABLE'], ['', 'sales', 'mv', 'MATERIALIZED_VIEW']],
        },
      },
    });
    expect((await run(listSchemas, {})).data).toEqual({ schemas: [{ name: 'default' }, { name: 'sales' }, { name: 'sales_x' }] });
    expect((await run(listTables, { schema: 'Sales' })).data).toEqual({
      schema: 'Sales',
      tables: [
        { name: 'active', type: 'view' },
        { name: 'mv', type: 'view' },
        { name: 'people', type: 'table' },
      ],
    });
    expect(server!.calls.filter((c) => c.method === 'GetTables').at(-1)!.request).toMatchObject({ schemaName: 'sales', tableName: '%' });
    expect((await run(listTables, { schema: 'nope' })).error?.code).toBe('NOT_FOUND');
  });

  it('describes a table from the catalog calls: types with lengths, keys, foreign keys, and no indexes', async () => {
    const strings = (...names: string[]) => names.map((name) => ({ name, type: 'STRING_TYPE' }));
    await start({
      catalog: {
        GetSchemas: { columns: strings('TABLE_SCHEM'), rows: [['sales']] },
        GetTables: { columns: strings('TABLE_CAT', 'TABLE_SCHEM', 'TABLE_NAME', 'TABLE_TYPE'), rows: [['', 'sales', 'people', 'TABLE']] },
        GetColumns: {
          columns: [...strings('TABLE_SCHEM', 'TABLE_NAME', 'COLUMN_NAME', 'TYPE_NAME'), { name: 'COLUMN_SIZE', type: 'INT_TYPE' }, { name: 'DECIMAL_DIGITS', type: 'INT_TYPE' }, { name: 'NULLABLE', type: 'INT_TYPE' }, ...strings('COLUMN_DEF'), { name: 'ORDINAL_POSITION', type: 'INT_TYPE' }],
          rows: [
            ['sales', 'people', 'name', 'VARCHAR', 100, null, 1, null, 2],
            ['sales', 'people', 'id', 'INT', 10, 0, 0, null, 1],
            ['sales', 'people', 'pay', 'DECIMAL', 10, 2, 1, null, 3],
            ['sales', 'people', 'tags', 'array<string>', 0, null, 1, null, 4],
          ],
        },
        GetPrimaryKeys: { columns: [...strings('TABLE_NAME', 'COLUMN_NAME'), { name: 'KEQ_SEQ', type: 'INT_TYPE' }], rows: [['people', 'id', 1]] },
        GetCrossReference: {
          columns: [...strings('PKTABLE_SCHEM', 'PKTABLE_NAME', 'PKCOLUMN_NAME', 'FKTABLE_NAME', 'FKCOLUMN_NAME', 'FK_NAME'), { name: 'KEQ_SEQ', type: 'INT_TYPE' }],
          rows: [['sales', 'teams', 'id', 'people', 'team_id', 'fk_team', 1]],
        },
      },
    });
    expect((await run(describeTable, { table: 'People', schema: 'sales' })).data).toEqual({
      schema: 'sales',
      name: 'people',
      type: 'table',
      columns: [
        { name: 'id', type: 'INT', nullable: false, default: null, primaryKey: 1 },
        { name: 'name', type: 'VARCHAR(100)', nullable: true, default: null, primaryKey: null },
        { name: 'pay', type: 'DECIMAL(10,2)', nullable: true, default: null, primaryKey: null },
        { name: 'tags', type: 'array<string>', nullable: true, default: null, primaryKey: null },
      ],
      primaryKey: ['id'],
      indexes: [],
      foreignKeys: [{ columns: ['team_id'], references: { schema: 'sales', table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: null }],
    });
    expect((await run(describeTable, { table: 'nope', schema: 'sales' })).error?.code).toBe('NOT_FOUND');
  });

  it('previews with a LIMIT that covers the page, quoting the names the catalog returned', async () => {
    const strings = (...names: string[]) => names.map((name) => ({ name, type: 'STRING_TYPE' }));
    await start({
      catalog: {
        GetSchemas: { columns: strings('TABLE_SCHEM'), rows: [['sales']] },
        GetTables: { columns: strings('TABLE_SCHEM', 'TABLE_NAME', 'TABLE_TYPE'), rows: [['sales', 'odd`name', 'TABLE']] },
      },
      statements: { 'SELECT * FROM `sales`.`odd``name` LIMIT 3': { columns: [{ name: 'id', type: 'INT_TYPE' }], rows: [[1], [2], [3]] } },
    });
    const envelope = await run(previewTable, { table: 'odd`name', schema: 'sales', limit: 2 });
    expect(envelope.data).toEqual({ columns: [{ name: 'id', type: 'INT' }], rows: [[1], [2]] });
    expect(envelope.meta.page?.nextCursor).toEqual(expect.any(String));
  });

  it('refuses a server older than protocol V6, and a session the server refuses', async () => {
    await start({ protocol: 4 });
    expect((await run(listSchemas, {})).error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('too old') });
    await server!.close();
    await start({ openError: "Database 'sales' does not exist" });
    expect((await run(listSchemas, {}, { settings: settings('hive', { database: 'sales' }) })).error).toMatchObject({ code: 'NOT_FOUND', fix: expect.stringContaining('"database"') });
  });

  it('turns a refused sign-in into AUTH, and a Kerberos-only server into AUTH that says so', async () => {
    await start();
    const wrong = await run(listSchemas, {}, { settings: settings('hive', { password: 'nope' }) });
    expect(wrong.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining('Error validating the login') });
    await server!.close();
    await start({ sasl: { refuse: 'Unsupported mechanism type PLAIN' } });
    const kerberos = await run(listSchemas, {});
    expect(kerberos.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining("expects Kerberos, which toil doesn't support") });
  });

  it('turns an unreachable server into NETWORK, naming the default port', async () => {
    await start();
    const port = server!.port;
    await server!.close();
    server = undefined;
    const envelope = await run(listSchemas, {}, { settings: { engine: 'impala', host: '127.0.0.1', port, user: 'u', password: 'p' } });
    expect(envelope.error).toMatchObject({ code: 'NETWORK', fix: expect.stringContaining('21050') });
  });

  it('explains a connection that ends during sign-in, by which side of auth the connection is on', () => {
    const conn = (extra: Record<string, unknown>) => ({ engine: 'impala', host: 'impala.imagile.dev', name: 'lake', area: 'db', ...extra }) as unknown as DbConnection;
    const engine = (impalaProvider as unknown as { engine: string }).engine;
    expect(engine).toBe('impala');
    const err = new LinkFailed('No answer to the sign-in within 15s.', 'sign-in', 'ETIMEDOUT');
    const sasl = toToilError(err, { engine: 'impala', label: 'Impala', port: 21050 } as never, conn({ user: 'u' }), 'read') as ToilError;
    expect(sasl).toMatchObject({ code: 'NETWORK', fix: expect.stringContaining('"auth": "nosasl"') });
    const nosasl = toToilError(err, { engine: 'impala', label: 'Impala', port: 21050 } as never, conn({ auth: 'nosasl' }), 'read') as ToilError;
    expect(nosasl.fix).toMatch(/remove "auth"/);
    const cert = toToilError(new LinkFailed('self-signed', 'connect', 'SELF_SIGNED_CERT_IN_CHAIN'), { engine: 'hive', label: 'Hive', port: 10000 } as never, conn({}), 'read') as ToilError;
    expect(cert).toMatchObject({ code: 'NETWORK', message: expect.stringContaining('TLS certificate') });
  });

  it('reads the privilege out of Hive, Ranger and Impala refusals', () => {
    expect(refusedPrivilege('Permission denied: Principal [name=r, type=USER] does not have following privileges for operation DROPTABLE [[OBJECT OWNERSHIP] on Object [type=TABLE_OR_VIEW, name=s.t]]')).toBe('OBJECT OWNERSHIP');
    expect(refusedPrivilege('Permission denied: user [r] does not have [UPDATE] privilege on [s/t]')).toBe('UPDATE');
    expect(refusedPrivilege("AuthorizationException: User 'r' does not have privileges to execute 'INSERT' on: s.t")).toBe('INSERT');
    expect(refusedPrivilege('Table not found')).toBeUndefined();
  });

  it('checks the connection: a user unless nosasl, no password with nosasl, and no SQL Server auth', () => {
    for (const provider of [providerFor('hive'), providerFor('impala')]) {
      expect(provider.check!({ engine: provider.engine, host: 'h' })).toEqual([{ key: 'user', message: expect.stringContaining('read-only account') }]);
      expect(provider.check!({ engine: provider.engine, host: 'h', user: 'u' })).toEqual([]);
      expect(provider.check!({ engine: provider.engine, host: 'h', auth: 'nosasl' })).toEqual([]);
      expect(provider.check!({ engine: provider.engine, host: 'h', auth: 'nosasl', password: 'p' })).toEqual([{ key: 'password', message: expect.any(String) }]);
      expect(provider.check!({ engine: provider.engine, host: 'h', user: 'u', auth: 'windows' })).toEqual([{ key: 'auth', message: expect.stringContaining('SQL Server') }]);
      expect(provider.defaultSchema({ engine: provider.engine, name: 'db', area: 'db' } as DbConnection)).toBe('default');
      expect(provider.defaultSchema({ engine: provider.engine, name: 'db', area: 'db', database: 'Sales' } as DbConnection)).toBe('sales');
    }
    expect(providerFor('sqlserver').check!({ engine: 'sqlserver', host: 'h', auth: 'nosasl' })).toEqual([{ key: 'auth', message: expect.stringContaining('Hive and Impala') }]);
  });
});

const liveSkip = await hive.probe();

/**
 * Against the Hive the conformance target reaches (`TOIL_TEST_HIVE_URL`), and
 * skipped with it: how real values come back, and the known limit, pinned.
 */
describe.skipIf(liveSkip !== undefined)(`hive, live${liveSkip ? ` (skipped: ${liveSkip})` : ''}`, { timeout: 60_000 }, () => {
  let db: string;
  afterEach(async () => {
    if (db) await hive.dropDatabase(db);
  });

  it('returns real values in their JSON shapes', async () => {
    db = await hive.createDatabase();
    const sql =
      "SELECT CAST(9007199254740993 AS BIGINT) AS big, CAST(12.34 AS DECIMAL(10,2)) AS d, CAST('2026-01-02 03:04:05.123456' AS TIMESTAMP) AS ts, CAST('2026-01-02' AS DATE) AS dt, CAST('hi' AS BINARY) AS bin, array(1, 2) AS arr, CAST('ab' AS CHAR(3)) AS ch, true AS b, CAST(NULL AS INT) AS n";
    const { context } = testContext({ config: { db: hive.settings(db, hive.reader) } });
    const envelope = await execute(query, { sql, lint: false }, context);
    expect(envelope.error).toBeNull();
    expect(envelope.data).toEqual({
      columns: [
        { name: 'big', type: 'BIGINT' },
        { name: 'd', type: 'DECIMAL(10,2)' },
        { name: 'ts', type: 'TIMESTAMP' },
        { name: 'dt', type: 'DATE' },
        { name: 'bin', type: 'BINARY' },
        { name: 'arr', type: 'ARRAY' },
        { name: 'ch', type: 'CHAR(3)' },
        { name: 'b', type: 'BOOLEAN' },
        { name: 'n', type: 'INT' },
      ],
      rows: [['9007199254740993', '12.34', '2026-01-02 03:04:05.123456', '2026-01-02', 'aGk=', '[1,2]', 'ab ', true, null]],
    });
  });

  it("known limit: with an account that may write, a read's write happens, and toil can only report it", async () => {
    db = await hive.createDatabase();
    // The pre-flight lint would refuse this INSERT first; the provider is asked directly, as an agent's SQL the lint missed would reach it.
    await expect(engineQuery(hive.settings(db, hive.writer), `INSERT INTO ${db}.teams VALUES (3, 'Ops')`)).rejects.toMatchObject({
      code: 'DATABASE',
      message: expect.stringContaining('changed 1 row'),
    });
    expect(await hive.run(hive.writer, [`SELECT id FROM ${db}.teams WHERE id = 3`])).toEqual([{ id: 3 }]);
    // The read-only account the docs require is what stops it.
    await expect(engineQuery(hive.settings(db, hive.reader), `INSERT INTO ${db}.teams VALUES (4, 'Ops')`)).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
  });
});
