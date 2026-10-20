import { randomBytes } from 'node:crypto';
import pg from 'pg';
import ConnectionParameters from 'pg/lib/connection-parameters.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { clientConfig, toToilError } from '../../src/core/db/postgres/index.js';
import { controlsTransaction, splitStatements } from '../../src/core/db/postgres/split.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import type { NetworkApis } from '../../src/core/network.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { engineQuery } from '../harness/db.js';
import { targets, type TargetDatabase } from './targets.js';

/**
 * What only PostgreSQL does, beyond the shared conformance suite: splitting
 * a script for db execute, keeping pg away from the PG* env vars, how values
 * become JSON, and the statements that get around a read-only transaction.
 * The splitter and config tests run offline; the rest need the server the
 * conformance target reaches, and skip with it. Each test gets its own
 * database, provisioned faster than any request for one has ever been.
 */

const words = (sql: string) => splitStatements(sql).map((s) => s.words[0]);

describe('postgres script splitting', () => {
  it('splits on semicolons outside quotes, comments and dollar-quoted bodies', () => {
    const sql = [
      "INSERT INTO t VALUES ('a;b', 'it''s; fine')",
      'UPDATE "we;ird" SET x = 1',
      "SELECT E'back\\'slash; still' AS s",
      'CREATE FUNCTION f() RETURNS int AS $body$ BEGIN; RETURN 1; END $body$ LANGUAGE plpgsql',
      'DO $$ BEGIN PERFORM 1; END $$',
      '/* outer /* inner; */ still; comment */ DELETE FROM t',
      '-- line; comment\nSELECT 1',
    ].join(';\n');
    expect(words(sql)).toEqual(['INSERT', 'UPDATE', 'SELECT', 'CREATE', 'DO', 'DELETE', 'SELECT']);
  });

  it('drops empty statements and comment-only tails', () => {
    expect(splitStatements(';; -- nothing\n /* here */ ;')).toEqual([]);
    expect(words('SELECT 1; /* trailing */')).toEqual(['SELECT']);
  });

  it("keeps a $n parameter and an identifier with $ from opening a dollar quote", () => {
    expect(words('SELECT $1; SELECT a$b$ FROM t; SELECT 2')).toEqual(['SELECT', 'SELECT', 'SELECT']);
  });

  // PostgreSQL ends a -- comment at \r as well as \n. Reading past a lone \r
  // would report the words after the next \n instead of the real first ones.
  it('ends a line comment at a carriage return, as the server does', () => {
    expect(splitStatements("-- x\rCOPY (SELECT 1) TO '/tmp/f'\nCSV")[0]!.words[0]).toBe('COPY');
    expect(splitStatements('-- x\rDO $$BEGIN NULL; END$$\nLANGUAGE plpgsql')[0]!.words[0]).toBe('DO');
    const script = splitStatements('UPDATE t SET a=1; -- x\rCOMMIT\nAND NO CHAIN; UPDATE t SET a=2');
    expect(script.map((s) => s.words[0])).toEqual(['UPDATE', 'COMMIT', 'UPDATE']);
    expect(script.some(controlsTransaction)).toBe(true);
  });

  it('finds transaction control after leading and nested comments', () => {
    for (const sql of ['COMMIT', '  /* a /* b */ c */ commit', '-- x\nROLLBACK', 'BEGIN', 'START TRANSACTION', 'END', 'ABORT', 'SAVEPOINT s', 'RELEASE s', 'PREPARE TRANSACTION \'x\'', 'PREPARE /* c */ TRANSACTION \'x\'']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(true);
    }
    for (const sql of ['PREPARE q AS SELECT 1', 'SELECT 1 AS commit', "SELECT 'COMMIT'", 'UPDATE t SET "begin" = 1']) {
      expect(splitStatements(sql).some(controlsTransaction), sql).toBe(false);
    }
  });
});

describe('postgres connection settings', () => {
  const conn = { name: 'db', area: 'db', engine: 'postgres', host: 'db.imagile.dev', database: 'app', user: 'reader', password: 'from-toil' } as unknown as DbConnection;

  // pg reads PGHOST, PGPASSWORD, ~/.pgpass and friends for anything left unset. None of it may leak in.
  it('takes nothing from the PG* env vars or ~/.pgpass', async () => {
    for (const [key, value] of Object.entries({
      PGHOST: 'elsewhere.imagile.dev', PGPORT: '6543', PGUSER: 'root', PGDATABASE: 'other', PGPASSWORD: 'leaked',
      PGPASSFILE: '/nonexistent/.pgpass', PGSSLMODE: 'no-verify', PGOPTIONS: '-c default_transaction_read_only=off',
      PGAPPNAME: 'other', PGCLIENT_ENCODING: 'LATIN1', PGREPLICATION: 'database', PGSSLNEGOTIATION: 'direct', PGCONNECT_TIMEOUT: '999',
    })) vi.stubEnv(key, value);
    try {
      const params = new ConnectionParameters(clientConfig(conn)) as unknown as Record<string, unknown>;
      expect(params).toMatchObject({
        host: 'db.imagile.dev', port: 5432, user: 'reader', database: 'app', ssl: false,
        options: '-c application_name=toil', application_name: 'toil', client_encoding: 'UTF8', replication: 'false', sslnegotiation: 'postgres', connect_timeout: 15,
      });
      expect(typeof params.password).toBe('function');
      expect(await (params.password as () => Promise<string> | string)()).toBe('from-toil');
      // With no password configured, still none from the environment.
      const none = new ConnectionParameters(clientConfig({ ...conn, password: undefined } as DbConnection)) as unknown as { password: () => string };
      expect(none.password()).toBe('');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // pg opens its own socket, so core's HTTP setup never loads the OS store for it.
  const caApis = (system: string[] | Error): NetworkApis => ({
    getCACertificates: ((type?: string) => {
      if (system instanceof Error) throw system;
      return type === 'system' ? system : ['BUNDLED-1'];
    }) as NetworkApis['getCACertificates'],
    setDefaultCACertificates: () => {},
    setGlobalProxyFromEnv: () => () => {},
  });

  it("verifies TLS against Node's CAs plus the OS store when ssl is on", () => {
    const config = clientConfig({ ...conn, ssl: true } as DbConnection, () => {}, caApis(['CORP-ROOT']));
    expect(config.ssl).toEqual({ ca: ['BUNDLED-1', 'CORP-ROOT'] });
    // And pg carries it through to the socket's TLS options unchanged.
    expect((new ConnectionParameters(config) as unknown as { ssl: unknown }).ssl).toEqual({ ca: ['BUNDLED-1', 'CORP-ROOT'] });
  });

  // Node's certificate failures carry these codes on the socket error pg rejects with.
  it('answers an untrusted or mismatched server certificate with NETWORK, naming the code', () => {
    const tlsConn = { ...conn, ssl: true } as DbConnection;
    for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
      const err = Object.assign(new Error('unable to verify the first certificate'), { code });
      expect(toToilError(err, tlsConn, 'read'), code).toMatchObject({
        code: 'NETWORK',
        message: expect.stringContaining(`(${code})`),
        fix: expect.stringContaining('NODE_EXTRA_CA_CERTS'),
      });
    }
  });

  it("keeps Node's own CAs when the OS store can't be read, and reads nothing without ssl", () => {
    const debug = vi.fn();
    expect(clientConfig({ ...conn, ssl: true } as DbConnection, debug, caApis(new Error('keychain locked'))).ssl).toBe(true);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('keychain locked'));
    const unread = caApis(new Error('must not be read'));
    expect(clientConfig(conn, () => {}, unread).ssl).toBe(false);
  });
});

const target = targets.find((t) => t.engine === 'postgres')!;
const skip = await target.skip?.();

describe.skipIf(skip !== undefined)(`postgres server${skip ? ` (skipped: ${skip})` : ''}`, () => {
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
  const direct = async (sql: string) => {
    const s = db.settings as Record<string, string | number>;
    const client = new pg.Client({ host: String(s.host), port: Number(s.port), user: String(s.user), password: String(s.password), database: String(s.database) });
    await client.connect();
    try {
      return await client.query(sql);
    } finally {
      await client.end();
    }
  };

  it('turns PostgreSQL values into JSON without losing or shifting anything', async () => {
    const envelope = await run(query, {
      sql: `SELECT 42 AS i, 9007199254740993::int8 AS big, 7::int8 AS small, 1.50::numeric AS num, 2.5::float8 AS f, true AS b, 'x' AS t, NULL::text AS n,
              '\\x0102ff'::bytea AS bin, '{"a": [1]}'::jsonb AS j, ARRAY[1, 2] AS arr,
              '2026-01-02'::date AS d, '2026-01-02 03:04:05'::timestamp AS ts, '2026-01-02 03:04:05+00'::timestamptz AS tstz, '1 day 02:00'::interval AS iv`,
    });
    expect(envelope.error).toBeNull();
    const data = envelope.data as { columns: Array<{ name: string; type: string }>; rows: unknown[][] };
    expect(data.columns.map((c) => c.type)).toEqual([
      'integer', 'bigint', 'bigint', 'numeric', 'double precision', 'boolean', 'text', 'text',
      'bytea', 'jsonb', 'integer[]', 'date', 'timestamp without time zone', 'timestamp with time zone', 'interval',
    ]);
    const [row] = data.rows;
    expect(row!.slice(0, 11)).toEqual([42, '9007199254740993', 7, '1.50', 2.5, true, 'x', null, 'AQL/', { a: [1] }, [1, 2]]);
    // As the server wrote them: no Date in the local zone of whoever ran toil.
    expect(row!.slice(11)).toEqual(['2026-01-02', '2026-01-02 03:04:05', expect.stringMatching(/^2026-01-02 03:04:05\+00/), '1 day 02:00:00']);
  });

  it("reports a table column's type with its length", async () => {
    const envelope = await run(query, { sql: 'SELECT id, name FROM people LIMIT 1' });
    expect((envelope.data as { columns: unknown }).columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'character varying(100)' },
    ]);
  });

  it('refuses nextval and a data-modifying CTE as writes', async () => {
    await direct('CREATE SEQUENCE s');
    expect((await run(query, { sql: "SELECT nextval('s')" })).error?.code).toBe('WRITE_DISABLED');
    expect((await run(query, { sql: 'WITH d AS (DELETE FROM people RETURNING id) SELECT count(*) FROM d' })).error?.code).toBe('WRITE_DISABLED');
    // The pre-flight lint refuses that CTE by its DELETE; the read-only transaction must refuse it without the lint.
    await expect(engineQuery(db.settings, 'WITH d AS (DELETE FROM people RETURNING id) SELECT count(*) FROM d')).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
    expect((await direct('SELECT count(*)::int AS n FROM people')).rows[0].n).toBe(12);
  });

  it('keeps a read read-only even when the statement asks for read-write', async () => {
    // The only statement in the transaction, then rolled back: nothing can follow it.
    const envelope = await run(query, { sql: 'SET TRANSACTION READ WRITE' });
    expect(envelope.ok).toBe(true);
    expect((await run(query, { sql: 'UPDATE people SET active = 0' })).error?.code).toBe('WRITE_DISABLED');
  });

  // The escape that makes the deny necessary: in a read-only transaction a
  // superuser's COPY ... TO still writes a file on the server, directly or
  // from a DO block.
  it('refuses COPY and DO on reads, because COPY ... TO writes server files even in a read-only transaction', async () => {
    const file = `/tmp/toil-copy-${randomBytes(4).toString('hex')}`;
    await direct(`BEGIN; SET TRANSACTION READ ONLY; COPY (SELECT 1) TO '${file}'; ROLLBACK`);
    expect((await direct(`SELECT (pg_stat_file('${file}')).size::int AS size`)).rows[0].size).toBeGreaterThan(0);
    await direct(`BEGIN; SET TRANSACTION READ ONLY; DO $$ BEGIN EXECUTE 'COPY (SELECT 1) TO ''${file}-do'''; END $$; ROLLBACK`);
    expect((await direct(`SELECT (pg_stat_file('${file}-do')).size::int AS size`)).rows[0].size).toBeGreaterThan(0);

    for (const sql of [
      `COPY (SELECT 1) TO '${file}-toil'`,
      `/* c */ copy people TO PROGRAM 'true'`,
      'COPY people TO STDOUT',
      `DO $$ BEGIN EXECUTE 'COPY (SELECT 1) TO ''${file}-toil'''; END $$`,
      `-- x\rCOPY (SELECT 1) TO '${file}-toil'\nCSV`,
      '-- x\rDO $$BEGIN NULL; END$$\nLANGUAGE plpgsql',
    ]) {
      const envelope = await run(query, { sql });
      expect(envelope.error, sql).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
    }
    expect((await direct(`SELECT pg_stat_file('${file}-toil', true) IS NULL AS missing`)).rows[0].missing).toBe(true);
  });

  // Known limit, documented in skills/toil/db.md: functions with server-side
  // effects run in a read-only transaction for a role allowed to call them.
  // They can't be refused by name, so the fix is a role that can't.
  it('known limit: a superuser can still call lo_export from a read', async () => {
    await direct("SELECT lo_from_bytea(0, 'x')");
    const envelope = await run(query, { sql: `SELECT lo_export((SELECT max(oid) FROM pg_largeobject_metadata), '/tmp/toil-lo-${randomBytes(4).toString('hex')}') AS n` });
    expect(envelope.data).toMatchObject({ rows: [[1]] });
  });

  it('refuses SQL that holds no statement', async () => {
    expect((await run(query, { sql: '-- only a comment' })).error?.code).toBe('INVALID_INPUT');
  });

  it('runs a function body holding semicolons through db execute', async () => {
    const sql = 'CREATE FUNCTION two() RETURNS int AS $$ BEGIN RETURN 2; END $$ LANGUAGE plpgsql; UPDATE people SET active = two() WHERE id = 1';
    expect((await run(executeCmd, { sql, allowWrite: true }, { ...db.settings, writes: true })).data).toEqual({ changes: 1 });
  });

  it('refuses a COMMIT after a carriage-return comment, before running any of it', async () => {
    const sql = 'UPDATE people SET active = 0 WHERE id = 1; -- x\rCOMMIT\nAND NO CHAIN; SELECT * FROM no_such_table';
    const envelope = await run(executeCmd, { sql, allowWrite: true }, { ...db.settings, writes: true });
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect((await direct('SELECT active FROM people WHERE id = 1')).rows[0].active).toBe(1);
  });

  it('refuses PREPARE TRANSACTION in a script before running any of it', async () => {
    const envelope = await run(executeCmd, { sql: "UPDATE people SET active = 0 WHERE id = 1; PREPARE /* x */ TRANSACTION 'p'", allowWrite: true }, { ...db.settings, writes: true });
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect((await direct('SELECT active FROM people WHERE id = 1')).rows[0].active).toBe(1);
  });

  it('describes a table in another schema, with a composite key and actions on its foreign key', async () => {
    await direct(`CREATE SCHEMA hr; CREATE TABLE hr.badges (team_id int NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE, seq int NOT NULL, code text, PRIMARY KEY (team_id, seq));
      CREATE INDEX badges_lower ON hr.badges (lower(code))`);
    expect(((await run(listSchemas, {})).data as { schemas: Array<{ name: string }> }).schemas.map((s) => s.name)).toEqual(['hr', 'public']);
    const d = (await run(describeTable, { table: 'badges', schema: 'hr' })).data as Record<string, unknown>;
    expect(d).toMatchObject({ schema: 'hr', name: 'badges', primaryKey: ['team_id', 'seq'] });
    expect(d.foreignKeys).toEqual([{ columns: ['team_id'], references: { schema: 'public', table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: 'CASCADE' }]);
    expect(d.indexes).toContainEqual({ name: 'badges_lower', columns: ['<expression>'], unique: false });
    expect(d.indexes).toContainEqual({ name: 'badges_pkey', columns: ['team_id', 'seq'], unique: true });
  });

  it('answers a missing database with NOT_FOUND and a wrong password with AUTH, never echoing the password', async () => {
    const missing = await run(listSchemas, {}, { ...db.settings, database: 'no_such_database' });
    expect(missing.error?.code).toBe('NOT_FOUND');
    const debug: string[] = [];
    const wrong = await run(listSchemas, {}, { ...db.settings, password: 'not-the-password-123' }, (m) => debug.push(m));
    expect(wrong.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('connections login db') });
    expect(JSON.stringify(wrong) + debug.join('\n')).not.toContain('not-the-password-123');
    expect(debug.join('\n')).toContain('connection db');
  });

  it('answers a closed port with NETWORK', async () => {
    const envelope = await run(listSchemas, {}, { ...db.settings, host: '127.0.0.1', port: 1 });
    expect(envelope.error?.code).toBe('NETWORK');
  });
});
