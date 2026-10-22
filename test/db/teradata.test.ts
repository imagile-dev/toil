import { describe, expect, it } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { encodeCursor, pageKey } from '../../src/core/db/paging.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import { declaredType, parseExactJson, teradataProvider } from '../../src/core/db/teradata/index.js';
import { scanSql } from '../../src/core/db/teradata/split.js';
import type { Envelope } from '../../src/core/envelope.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { neverAnswers, type CannedResponse, type RecordedRequest, type Route } from '../harness/fake-fetch.js';

/**
 * Teradata through the Query Service, against a stubbed fetch: there is no
 * Teradata to run in a container (Vantage Express is a virtual machine), so
 * this is the whole of its verification, and the provider ships at `unit`.
 *
 * Every response here is invented from Teradata's Query Service OpenAPI
 * specification and its "send queries using REST API" guide: the session and
 * query shapes (`sessionId`, `results[].resultSet`, `columns`, `data` as
 * arrays, `rowCount`), the error body (`{ error, message }`), and the
 * statuses it documents (404, 412, 420 Database Error, 429 Too Many
 * Sessions). None was captured from a live service; the request for one is
 * still awaiting a sponsor. The tests assert both
 * sides: the exact requests toil sent, and how each answer was reshaped.
 */

const BASE = 'https://teradata.imagile.dev:1443/api/query';
const SYSTEM = 'prod';
const SESSION = 1366010;
const SETTINGS: Settings = { engine: 'teradata', baseUrl: BASE, system: SYSTEM, user: 'toil_reader', password: 'pw', database: 'sales' };
const BASIC = `Basic ${Buffer.from('toil_reader:pw').toString('base64')}`;

const sessionsPath = `/api/query/systems/${SYSTEM}/sessions`;
const queriesPath = `/api/query/systems/${SYSTEM}/queries`;

/** Settings with some keys left out. */
const without = (settings: Settings, ...keys: string[]): Settings => Object.fromEntries(Object.entries(settings).filter(([k]) => !keys.includes(k))) as Settings;

type Answer = CannedResponse | ((body: Record<string, unknown>) => CannedResponse);

/** A result set, as the service sends one with `format: ARRAY` and `include_columns: true`. */
const rows = (columns: Array<[string, string]>, data: unknown[][]) => ({ json: { queueDuration: 3, queryDuration: 11, results: [{ resultSet: true, columns: columns.map(([name, type]) => ({ name, type })), data, rowCount: data.length, rowLimitExceeded: false }] } });
const updated = (...counts: number[]) => ({ json: { queueDuration: 1, queryDuration: 2, results: counts.map((rowCount) => ({ resultSet: false, rowCount })) } });

/**
 * A Query Service: one session, and a query endpoint that answers by the SQL
 * it was sent (first match wins). ROLLBACK and COMMIT always succeed, and the
 * session closes.
 */
function service(answers: Array<[RegExp, Answer]>, extra: Route[] = []): Route[] {
  return [
    { method: 'POST', path: sessionsPath, respond: { json: { sessionId: SESSION, system: SYSTEM, user: 'toil_reader', tdSessionNo: 1626922, createMode: 'EXPLICIT', state: 'LOGGINGON', autoCommit: false } } },
    {
      method: 'POST',
      path: queriesPath,
      respond: (req: RecordedRequest) => {
        const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
        const sql = String(body.query);
        if (sql === 'ROLLBACK' || sql === 'COMMIT') return updated(0);
        const found = answers.find(([pattern]) => pattern.test(sql));
        if (!found) return { status: 420, json: { error: '3807', message: `Object for "${sql}" does not exist in this test.` } };
        return typeof found[1] === 'function' ? found[1](body) : found[1];
      },
    },
    { method: 'DELETE', path: `${sessionsPath}/${SESSION}`, respond: { json: {} } },
    ...extra,
  ];
}

function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], settings: Settings = SETTINGS, extra: { verbose?: boolean } = {}) {
  const { context, http } = testContext({ config: { db: settings }, routes, ...extra });
  return { envelope: execute(def, input, context), http };
}

/** The bodies of the queries sent, in order. */
const sent = (calls: RecordedRequest[]) => calls.filter((c) => c.url.endsWith('/queries') && c.method === 'POST').map((c) => JSON.parse(c.body!) as Record<string, unknown>);
const trail = (calls: RecordedRequest[]) => calls.map((c) => `${c.method} ${new URL(c.url).pathname}${c.method === 'POST' && c.url.endsWith('/queries') ? ` ${String((JSON.parse(c.body!) as { query: string }).query).split(' ')[0]}` : ''}`);

const dataOf = (envelope: Envelope) => {
  expect(envelope.error, JSON.stringify(envelope.error)).toBeNull();
  return envelope.data as Record<string, unknown>;
};

describe('teradata: sessions, auth and request shape', () => {
  it('opens an ANSI session with auto-commit off, reads in it, rolls back and closes it', async () => {
    const { envelope, http } = run(listSchemas, {}, service([[/DBC\.DatabasesV/, rows([['DatabaseName', 'VARCHAR']], [['finance'], ['sales']])]]));
    expect(dataOf(await envelope)).toEqual({ schemas: [{ name: 'finance' }, { name: 'sales' }] });
    expect(trail(http.calls)).toEqual([`POST ${sessionsPath}`, `POST ${queriesPath} SELECT`, `POST ${queriesPath} ROLLBACK`, `DELETE ${sessionsPath}/${SESSION}`]);

    const [open, list] = http.calls;
    expect(open!.url).toBe(`${BASE}/systems/${SYSTEM}/sessions`);
    expect(open!.headers).toMatchObject({ accept: 'application/vnd.com.teradata.rest-v1.0+json', authorization: BASIC, 'content-type': 'application/json' });
    expect(JSON.parse(open!.body!)).toEqual({ transaction_mode: 'ANSI', auto_commit: false, default_database: 'sales' });
    const body = JSON.parse(list!.body!) as Record<string, unknown>;
    expect(body).toMatchObject({ format: 'ARRAY', include_columns: true, session: SESSION, row_limit: 0 });
    // The built-in databases are bound parameters, never spliced into the SQL.
    expect(String(body.query)).toMatch(/^SELECT DatabaseName FROM DBC\.DatabasesV WHERE UPPER\(DatabaseName\) NOT IN \(\?(, \?)+\) ORDER BY DatabaseName$/);
    expect((body.params as string[][])[0]).toContain('DBC');
  });

  it('sends a token as a bearer token, and the logon mechanism the connection names', async () => {
    const settings: Settings = { engine: 'teradata', baseUrl: BASE, system: SYSTEM, token: 'abc12345-token', database: 'sales', logMech: 'JWT' };
    const { envelope, http } = run(listSchemas, {}, service([[/DBC\.DatabasesV/, rows([['DatabaseName', 'VARCHAR']], [])]]), settings);
    expect(dataOf(await envelope)).toEqual({ schemas: [] });
    for (const call of http.calls) expect(call.headers.authorization).toBe('Bearer abc12345-token');
    expect(JSON.parse(http.calls[0]!.body!)).toEqual({ transaction_mode: 'ANSI', auto_commit: false, default_database: 'sales', log_mech: 'JWT' });
  });

  it('records every request for --verbose, ROLLBACK and the session close included, with no credential', async () => {
    const { envelope } = run(listSchemas, {}, service([[/DBC\.DatabasesV/, rows([['DatabaseName', 'VARCHAR']], [])]]), SETTINGS, { verbose: true });
    const requests = (await envelope).meta.requests!;
    expect(requests.map((r) => `${r.method} ${r.url} ${r.status}`)).toEqual([
      `POST ${BASE}/systems/prod/sessions 200`,
      `POST ${BASE}/systems/prod/queries 200`,
      `POST ${BASE}/systems/prod/queries 200`,
      `DELETE ${BASE}/systems/prod/sessions/${SESSION} 200`,
    ]);
    expect(JSON.stringify(requests)).not.toContain('pw');
  });

  it('closes the session even when the read fails', async () => {
    const { envelope, http } = run(query, { sql: 'SELECT x FROM nowhere' }, service([]));
    expect((await envelope).error).toMatchObject({ code: 'DATABASE', message: expect.stringContaining('3807') });
    expect(trail(http.calls).slice(-2)).toEqual([`POST ${queriesPath} ROLLBACK`, `DELETE ${sessionsPath}/${SESSION}`]);
  });
});

describe('teradata: connection settings', () => {
  const missing = async (settings: Settings) => (await run(listSchemas, {}, [], settings).envelope).error;

  it('needs baseUrl and system, naming their env vars', async () => {
    expect(await missing(without(SETTINGS, 'system'))).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_SYSTEM') });
    expect(await missing(without(SETTINGS, 'baseUrl'))).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_BASE_URL') });
  });

  it('needs user and password or a token, not both and not neither', async () => {
    const anonymous = without(SETTINGS, 'user', 'password');
    const said = (text: string) => ({ code: 'CONFIG_INVALID', details: [expect.objectContaining({ message: expect.stringContaining(text) })] });
    expect(await missing(anonymous)).toMatchObject(said('or token'));
    expect(await missing({ ...SETTINGS, token: 't' })).toMatchObject(said('not both'));
    const tokenOnly: Settings = { engine: 'teradata', baseUrl: BASE, system: SYSTEM, token: 't' };
    expect(await missing(tokenOnly)).toMatchObject(said('need database'));
  });

  it('refuses a base URL that is not http(s)', async () => {
    expect(await missing({ ...SETTINGS, baseUrl: 'ftp://teradata.imagile.dev/' })).toMatchObject({ code: 'CONFIG_INVALID', details: [expect.objectContaining({ message: expect.stringContaining('http(s) URL') })] });
  });

  it("defaults to the connection's database, else the user's own", () => {
    const conn = (s: Settings) => ({ ...s, name: 'db', area: 'db' }) as DbConnection;
    expect(teradataProvider.defaultSchema(conn(SETTINGS))).toBe('sales');
    expect(teradataProvider.defaultSchema(conn(without(SETTINGS, 'database')))).toBe('toil_reader');
  });
});

describe('teradata: listings and describe from the DBC views', () => {
  const sales = (name = 'sales') => [/FROM DBC\.DatabasesV WHERE UPPER\(DatabaseName\) = UPPER/, rows([['DatabaseName', 'VARCHAR']], [[name]])] as [RegExp, Answer];
  const people: [RegExp, Answer] = [/FROM DBC\.TablesV WHERE UPPER/, rows([['DatabaseName', 'VARCHAR'], ['TableName', 'VARCHAR'], ['TableKind', 'CHAR']], [['sales', 'people', 'T']])];

  it('lists tables and views, with the catalog name for a schema typed in another case', async () => {
    const { envelope, http } = run(
      listTables,
      { schema: 'SALES' },
      service([sales(), [/FROM DBC\.TablesV WHERE DatabaseName/, rows([['TableName', 'VARCHAR'], ['TableKind', 'CHAR']], [['active_people', 'V'], ['people', 'T'], ['queue', 'Q']])]]),
    );
    expect(dataOf(await envelope)).toEqual({ schema: 'SALES', tables: [{ name: 'active_people', type: 'view' }, { name: 'people', type: 'table' }, { name: 'queue', type: 'table' }] });
    expect(sent(http.calls)[0]!.params).toEqual([['SALES']]);
    expect(sent(http.calls)[1]!.params).toEqual([['sales']]);
  });

  it('answers an unknown schema with NOT_FOUND, and still closes the session', async () => {
    const { envelope, http } = run(listTables, { schema: 'nope' }, service([[/DBC\.DatabasesV/, rows([['DatabaseName', 'VARCHAR']], [])]]));
    expect((await envelope).error).toMatchObject({ code: 'NOT_FOUND', fix: 'Run toil db schema list to see the databases it has.' });
    expect(trail(http.calls).at(-1)).toBe(`DELETE ${sessionsPath}/${SESSION}`);
  });

  it('describes columns, the primary key from a unique primary index, indexes and foreign keys', async () => {
    const { envelope } = run(
      describeTable,
      { table: 'PEOPLE' },
      service([
        sales(),
        people,
        [
          /FROM DBC\.ColumnsV/,
          rows(
            [['ColumnName', 'VARCHAR'], ['ColumnType', 'CHAR'], ['ColumnLength', 'INTEGER'], ['DecimalTotalDigits', 'SMALLINT'], ['DecimalFractionalDigits', 'SMALLINT'], ['CharType', 'SMALLINT'], ['Nullable', 'CHAR'], ['DefaultValue', 'VARCHAR']],
            [
              ['id', 'I', 4, null, null, 0, 'N', null],
              ['name', 'CV', 200, null, null, 2, 'N', null],
              ['team_id', 'I', 4, null, null, 0, 'Y', null],
              ['salary', 'D', 8, 10, 2, 0, 'Y', null],
              ['active', 'I', 4, null, null, 0, 'N', '1'],
              ['hired', 'TS', 26, null, 6, 0, 'Y', null],
            ],
          ),
        ],
        [
          /FROM DBC\.IndicesV/,
          rows([['IndexNumber', 'SMALLINT'], ['IndexType', 'CHAR'], ['UniqueFlag', 'CHAR'], ['IndexName', 'VARCHAR'], ['ColumnName', 'VARCHAR']], [
            [1, 'P', 'Y', null, 'id'],
            [4, 'S', 'N', 'people_team', 'team_id'],
          ]),
        ],
        [/FROM DBC\.All_RI_ChildrenV/, rows([['IndexID', 'SMALLINT'], ['IndexName', 'VARCHAR'], ['ChildKeyColumn', 'VARCHAR'], ['ParentDB', 'VARCHAR'], ['ParentTable', 'VARCHAR'], ['ParentKeyColumn', 'VARCHAR']], [[0, null, 'team_id', 'sales', 'teams', 'id']])],
      ]),
    );
    expect(dataOf(await envelope)).toEqual({
      schema: 'sales',
      name: 'people',
      type: 'table',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, default: null, primaryKey: 1 },
        { name: 'name', type: 'VARCHAR(100)', nullable: false, default: null, primaryKey: null },
        { name: 'team_id', type: 'INTEGER', nullable: true, default: null, primaryKey: null },
        { name: 'salary', type: 'DECIMAL(10,2)', nullable: true, default: null, primaryKey: null },
        { name: 'active', type: 'INTEGER', nullable: false, default: '1', primaryKey: null },
        { name: 'hired', type: 'TIMESTAMP(6)', nullable: true, default: null, primaryKey: null },
      ],
      primaryKey: ['id'],
      indexes: [
        { name: 'primary index', columns: ['id'], unique: true },
        { name: 'people_team', columns: ['team_id'], unique: false },
      ],
      foreignKeys: [{ columns: ['team_id'], references: { schema: 'sales', table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: null }],
    });
  });

  it('prefers a PRIMARY KEY constraint over a non-unique primary index', async () => {
    const { envelope } = run(
      describeTable,
      { table: 'people' },
      service([
        sales(),
        people,
        [/FROM DBC\.ColumnsV/, rows([['ColumnName', 'VARCHAR'], ['ColumnType', 'CHAR']], [['id', 'I', 4, null, null, 0, 'N', null], ['team_id', 'I', 4, null, null, 0, 'Y', null]])],
        [/FROM DBC\.IndicesV/, rows([['IndexNumber', 'SMALLINT'], ['IndexType', 'CHAR']], [[1, 'P', 'N', null, 'team_id'], [2, 'K', 'Y', 'people_pk', 'id']])],
        [/FROM DBC\.All_RI_ChildrenV/, rows([['IndexID', 'SMALLINT']], [])],
      ]),
    );
    const data = dataOf(await envelope);
    expect(data.primaryKey).toEqual(['id']);
    expect(data.indexes).toEqual([{ name: 'primary index', columns: ['team_id'], unique: false }, { name: 'people_pk', columns: ['id'], unique: true }]);
  });

  it('describes a view without asking for indexes or keys', async () => {
    const { envelope, http } = run(
      describeTable,
      { table: 'active_people' },
      service([sales(), [/FROM DBC\.TablesV WHERE UPPER/, rows([['DatabaseName', 'VARCHAR']], [['sales', 'active_people', 'V']])], [/FROM DBC\.ColumnsV/, rows([['ColumnName', 'VARCHAR']], [['id', null, null, null, null, null, 'Y', null]])]]),
    );
    expect(dataOf(await envelope)).toMatchObject({ type: 'view', columns: [{ name: 'id', type: null, nullable: true }], primaryKey: [], indexes: [], foreignKeys: [] });
    expect(sent(http.calls).map((b) => b.query).join(' ')).not.toMatch(/IndicesV|RI_Children/);
  });

  it('answers an unknown table with NOT_FOUND', async () => {
    const { envelope } = run(describeTable, { table: 'ghost' }, service([sales(), [/FROM DBC\.TablesV/, rows([['DatabaseName', 'VARCHAR']], [])]]));
    expect((await envelope).error).toMatchObject({ code: 'NOT_FOUND', fix: 'Run toil db table list --schema sales to see what it has.' });
  });

  it('reads type codes as DDL types', () => {
    expect(declaredType('CF', 20, null, null, 1)).toBe('CHAR(20)');
    expect(declaredType('CV', 200, null, null, 2)).toBe('VARCHAR(100)');
    expect(declaredType('N ', 22, -128, -128, 0)).toBe('NUMBER');
    expect(declaredType('N', 22, 12, 4, 0)).toBe('NUMBER(12,4)');
    expect(declaredType('SZ', 32, null, 3, 0)).toBe('TIMESTAMP(3) WITH TIME ZONE');
    expect(declaredType('DS', 0, null, null, 0)).toBe('INTERVAL DAY TO SECOND');
    expect(declaredType('ZZ', 0, null, null, 0)).toBe('ZZ');
    expect(declaredType(null, null, null, null, null)).toBeNull();
  });
});

describe('teradata: preview and query, paged by the service', () => {
  const sales: [RegExp, Answer] = [/FROM DBC\.DatabasesV WHERE UPPER/, rows([['DatabaseName', 'VARCHAR']], [['sales']])];
  const people: [RegExp, Answer] = [/FROM DBC\.TablesV WHERE UPPER/, rows([['DatabaseName', 'VARCHAR']], [['sales', 'people', 'T']])];
  const pi: [RegExp, Answer] = [/FROM DBC\.IndicesV/, rows([['IndexNumber', 'SMALLINT']], [[1, 'P', 'Y', null, 'id']])];

  it('previews a table in primary-key order, asking the service for the window', async () => {
    const cursor = encodeCursor(2, pageKey('db table preview', 'sales', 'people'));
    const { envelope, http } = run(previewTable, { table: 'people', limit: 2, cursor }, service([sales, people, pi, [/^SELECT \* FROM/, rows([['id', 'INTEGER'], ['name', 'VARCHAR']], [[3, 'Edsger'], [4, 'Barbara'], [5, 'Donald']])]]));
    const result = await envelope;
    expect(dataOf(result)).toEqual({ columns: [{ name: 'id', type: 'INTEGER' }, { name: 'name', type: 'VARCHAR' }], rows: [[3, 'Edsger'], [4, 'Barbara']] });
    expect(result.meta.page).toEqual({ nextCursor: encodeCursor(4, pageKey('db table preview', 'sales', 'people')), limit: 2 });
    expect(sent(http.calls).at(-2)).toMatchObject({ query: 'SELECT * FROM "sales"."people" ORDER BY "id"', row_offset: 2, row_limit: 3 });
  });

  it('runs one statement with the row cap and offset, rows as arrays', async () => {
    const sql = 'SELECT id, name FROM people ORDER BY id';
    const { envelope, http } = run(query, { sql, limit: 2 }, service([[/^SELECT id/, rows([['id', 'INTEGER'], ['name', 'VARCHAR']], [[1, 'Ada'], [2, 'Grace'], [3, 'Edsger']])]]));
    const result = await envelope;
    expect(dataOf(result)).toEqual({ columns: [{ name: 'id', type: 'INTEGER' }, { name: 'name', type: 'VARCHAR' }], rows: [[1, 'Ada'], [2, 'Grace']] });
    expect(result.meta.page?.nextCursor).toBe(encodeCursor(2, pageKey('db query', sql)));
    const [body] = sent(http.calls);
    expect(body).toEqual({ query: sql, format: 'ARRAY', include_columns: true, session: SESSION, row_limit: 3 });
  });

  it('keeps BIGINT and long DECIMAL values exact', async () => {
    const text = '{"results":[{"resultSet":true,"columns":[{"name":"big","type":"BIGINT"},{"name":"amount","type":"DECIMAL"},{"name":"small","type":"DECIMAL"}],"data":[[9223372036854775807,12345678901234567.89,1.5]],"rowCount":1}]}';
    const { envelope } = run(query, { sql: 'SELECT big, amount, small FROM t' }, service([[/^SELECT big/, { text, headers: { 'content-type': 'application/json' } }]]));
    expect(dataOf(await envelope).rows).toEqual([['9223372036854775807', '12345678901234567.89', 1.5]]);
  });

  it('refuses a write as WRITE_DISABLED when the service reports an update count, and rolls it back', async () => {
    // Past db query's lint, as an engine test must be: the provider is what's being proved.
    const { context, http } = testContext({ routes: service([[/^MERGE|^CALL/, updated(3)]]) });
    const conn = { ...SETTINGS, name: 'db', area: 'db' } as DbConnection;
    const call = { signal: new AbortController().signal, debug: () => {}, fetch: context.fetch, cleanupFetch: context.fetch };
    await expect(teradataProvider.query(conn, 'CALL sales.archive_people()', { offset: 0, max: 101 }, call)).rejects.toMatchObject({ code: 'WRITE_DISABLED', message: expect.stringContaining('rolled back') });
    expect(trail(http.calls).slice(-2)).toEqual([`POST ${queriesPath} ROLLBACK`, `DELETE ${sessionsPath}/${SESSION}`]);
  });

  it("maps a read-only user's refused write to WRITE_DISABLED, and other refusals to DATABASE", async () => {
    const refused = (message: string, error = '3523'): Answer => ({ status: 420, json: { error, message } });
    const { context } = testContext({
      routes: service([
        [/^INS/, refused('The user does not have INSERT access to sales.people.')],
        [/^SELECT secret/, refused('The user does not have SELECT access to hr.pay.')],
        [/^SELECT locked/, refused('Transaction ABORTed due to deadlock.', '2631')],
      ]),
    });
    const conn = { ...SETTINGS, name: 'db', area: 'db' } as DbConnection;
    const call = { signal: new AbortController().signal, debug: () => {}, fetch: context.fetch, cleanupFetch: context.fetch };
    const window = { offset: 0, max: 101 };
    await expect(teradataProvider.query(conn, "INS INTO people VALUES (99, 'x', 1, 1)", window, call)).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
    await expect(teradataProvider.query(conn, 'SELECT secret FROM hr.pay', window, call)).rejects.toMatchObject({ code: 'DATABASE', message: 'Teradata: 3523 The user does not have SELECT access to hr.pay.', fix: expect.stringContaining('lacks that access right') });
    await expect(teradataProvider.query(conn, 'SELECT locked FROM t', window, call)).rejects.toMatchObject({ code: 'DATABASE', fix: expect.stringContaining('deadlock') });
  });

  it('refuses several statements and transaction control before opening a session', async () => {
    for (const [sql, message] of [
      ['SELECT 1; SELECT 2', 'exactly one statement'],
      ['SELECT 1 FROM t WHERE x = 1 COMMIT', 'COMMIT is refused'],
      ['  ', 'no statement'],
    ] as const) {
      const { context, http } = testContext({ routes: [] });
      const conn = { ...SETTINGS, name: 'db', area: 'db' } as DbConnection;
      await expect(teradataProvider.query(conn, sql, { offset: 0, max: 101 }, { signal: new AbortController().signal, debug: () => {}, fetch: context.fetch, cleanupFetch: context.fetch }), sql).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(message) });
      expect(http.calls, sql).toEqual([]);
    }
  });

  it('refuses SQL that returns more than one result', async () => {
    const two = { json: { results: [rows([['x', 'INTEGER']], [[1]]).json.results[0], rows([['y', 'INTEGER']], [[2]]).json.results[0]] } };
    const { context } = testContext({ routes: service([[/^EXEC/, two]]) });
    const conn = { ...SETTINGS, name: 'db', area: 'db' } as DbConnection;
    await expect(teradataProvider.query(conn, 'EXEC sales.two_reports', { offset: 0, max: 101 }, { signal: new AbortController().signal, debug: () => {}, fetch: context.fetch, cleanupFetch: context.fetch })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('exactly one statement') });
  });

  it('reports an error sent after a 200 as DATABASE', async () => {
    const { envelope } = run(query, { sql: 'SELECT x FROM t' }, service([[/^SELECT x/, { json: { results: [], responseError: { error: '2646', message: 'No more spool space.' } } }]]));
    expect((await envelope).error).toMatchObject({ code: 'DATABASE', message: 'Teradata: 2646 No more spool space.' });
  });
});

describe('teradata: errors from the service', () => {
  it('reports 429 Too Many Sessions plainly, as retryable, without retrying', async () => {
    const { envelope, http } = run(listSchemas, {}, [{ method: 'POST', path: sessionsPath, respond: { status: 429, json: { message: 'The user has reached the session limit.' } } }]);
    expect((await envelope).error).toMatchObject({
      code: 'HTTP',
      message: expect.stringContaining('HTTP 429 Too Many Sessions'),
      fix: expect.stringContaining('session limit'),
      details: { status: 429, retryable: true },
    });
    expect(http.calls).toHaveLength(1);
  });

  it('reports a system the service has no alias for as NOT_FOUND', async () => {
    const { envelope } = run(listSchemas, {}, [{ method: 'POST', path: sessionsPath, respond: { status: 404, json: { message: 'System prod not found.' } } }]);
    expect((await envelope).error).toMatchObject({ code: 'NOT_FOUND', fix: expect.stringContaining('"system"') });
  });

  it('reports a refused login as AUTH, with what to check', async () => {
    const { envelope } = run(listSchemas, {}, [{ method: 'POST', path: sessionsPath, respond: { status: 401, json: { message: 'Invalid credentials.' } } }]);
    expect((await envelope).error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('logMech') });
    const token: Settings = { engine: 'teradata', baseUrl: BASE, system: SYSTEM, token: 't', database: 'sales' };
    const expired = await run(listSchemas, {}, [{ method: 'POST', path: sessionsPath, respond: { status: 401, json: { message: 'Token expired.' } } }], token).envelope;
    expect(expired.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('may have expired') });
  });

  it('reports a busy service (412) as retryable', async () => {
    const { envelope } = run(query, { sql: 'SELECT x FROM t' }, service([[/^SELECT x/, { status: 412, json: { message: 'Queue timeout exceeded.' } }]]));
    expect((await envelope).error).toMatchObject({ code: 'HTTP', details: { status: 412, retryable: true } });
  });

  it('reports a page that is not JSON plainly', async () => {
    const { envelope } = run(listSchemas, {}, [{ method: 'POST', path: sessionsPath, respond: { text: '<html>Sign in</html>' } }]);
    expect((await envelope).error).toMatchObject({ code: 'HTTP', message: expect.stringContaining("isn't JSON") });
  });
});

describe('teradata: execute', () => {
  const write = (sql: string, routes: Route[]) => run(executeCmd, { sql, allowWrite: true }, routes, { ...SETTINGS, writes: true });

  it('runs the script in the session and commits, counting the rows changed', async () => {
    const { envelope, http } = write("UPDATE people SET active = 0 WHERE id = 1; INSERT INTO teams VALUES (3, 'Ops')", service([[/^UPDATE/, updated(1, 1)]]));
    expect(dataOf(await envelope)).toEqual({ changes: 2 });
    expect(trail(http.calls)).toEqual([`POST ${sessionsPath}`, `POST ${queriesPath} UPDATE`, `POST ${queriesPath} COMMIT`, `DELETE ${sessionsPath}/${SESSION}`]);
  });

  it('rolls back and does not commit when a statement fails', async () => {
    const { envelope, http } = write('UPDATE people SET active = 0 WHERE id = 1', service([[/^UPDATE/, { status: 420, json: { error: '2801', message: 'Duplicate unique prime key error.' } }]]));
    expect((await envelope).error).toMatchObject({ code: 'DATABASE', message: 'Teradata: 2801 Duplicate unique prime key error.' });
    expect(trail(http.calls)).not.toContain(`POST ${queriesPath} COMMIT`);
    expect(trail(http.calls).slice(-2)).toEqual([`POST ${queriesPath} ROLLBACK`, `DELETE ${sessionsPath}/${SESSION}`]);
  });

  it('refuses a script that controls its own transaction, before sending anything', async () => {
    for (const control of ['BT', 'ET', 'COMMIT WORK', 'ROLLBACK', 'ABORT', 'BEGIN TRANSACTION', 'END TRANSACTION']) {
      const { envelope, http } = write(`UPDATE people SET active = 0 WHERE id = 1; ${control}; UPDATE people SET active = 0 WHERE id = 2`, []);
      expect((await envelope).error?.code, control).toBe('INVALID_INPUT');
      expect(http.calls, control).toEqual([]);
    }
  });
});

describe('teradata: cancelling', () => {
  it("asks the service to abort the session's queries, then closes the session", async () => {
    const routes = service([], [
      { method: 'GET', path: queriesPath, query: { session: String(SESSION) }, respond: { json: [{ queryId: 1366025, session: SESSION, queryState: 'SUBMITTED' }] } },
      { method: 'DELETE', path: `${queriesPath}/1366025`, respond: { json: {} } },
    ]);
    const { context, http } = testContext({ config: { db: SETTINGS }, routes });
    // The slow query never answers; everything else goes to the stub.
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'POST' && request.url.endsWith('/queries') && (await request.clone().text()).includes('slow')) return neverAnswers(request);
      return context.fetch(request);
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const pending = execute(query, { sql: 'SELECT slow FROM t' }, { ...context, fetch, signal: controller.signal });
    await expect.poll(() => http.calls.length).toBe(1);
    // The session POST is recorded by the stub; the slow query by nobody, so wait for it to be in flight.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    expect((await pending).error?.code).toBe('CANCELLED');
    await expect.poll(() => trail(http.calls)).toEqual([`POST ${sessionsPath}`, `GET ${queriesPath}`, `DELETE ${queriesPath}/1366025`, `DELETE ${sessionsPath}/${SESSION}`]);
  });
});

describe('teradata: reading SQL and JSON', () => {
  it('counts statements outside strings, names and comments', () => {
    expect(scanSql("SELECT ';' AS s, \"a;b\" FROM t -- ; \n /* ; */").statements).toBe(1);
    expect(scanSql('SELECT 1; SELECT 2;').statements).toBe(2);
    expect(scanSql(' ; -- nothing\n ;').empty).toBe(true);
  });

  it('finds transaction control anywhere, and leaves look-alikes alone', () => {
    for (const [sql, word] of [
      ['COMMIT', 'COMMIT'],
      ['bt; update t set x = 1; et', 'BT'],
      ['UPDATE t SET x = 1; ABORT', 'ABORT'],
      ['begin transaction', 'BEGIN TRANSACTION'],
      ['UPDATE t SET x = 1; END  TRANSACTION', 'END TRANSACTION'],
      ['ROLLBACK WORK', 'ROLLBACK'],
    ] as const) {
      expect(scanSql(sql).transactionControl, sql).toBe(word);
    }
    for (const sql of ["SELECT 'COMMIT', \"rollback\" FROM t", '-- BT\nSELECT 1 /* ET */', 'BEGIN QUERY LOGGING ON sales', 'CREATE VOLATILE TABLE t (id INTEGER) ON COMMIT PRESERVE ROWS; INSERT INTO t VALUES (1);', 'CREATE MULTISET VOLATILE TABLE t AS (SELECT 1 AS x) WITH DATA ON COMMIT DELETE ROWS', 'SELECT commit_date, bt_id FROM t', 'SELECT transaction FROM begin_end']) {
      expect(scanSql(sql).transactionControl, sql).toBeUndefined();
    }
  });

  it('keeps integers past 2^53 and decimals past 15 digits exact, and the rest as numbers', () => {
    expect(parseExactJson('[9007199254740993, -9007199254740993, 42, 0.1, 1e300, 123456789.123456789, -0.000000000000000012345678901234567]')).toEqual([
      9007199254740993n,
      -9007199254740993n,
      42,
      0.1,
      1e300,
      '123456789.123456789',
      '-0.000000000000000012345678901234567',
    ]);
  });
});
