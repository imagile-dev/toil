import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execute as executeCmd, listTables, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import { loadConfig, type Settings } from '../../src/core/config.js';
import { assertNodeSupportsSqlite } from '../../src/core/db/sqlite/index.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { CLEANUP, createSqliteFile, sqliteRows, type TempSqlite } from '../harness/db.js';

/**
 * What only SQLite does, beyond the shared conformance suite: how its values
 * become JSON, what happens around the file itself, and configuration from
 * env vars alone.
 */
let db: TempSqlite;
beforeEach(() => {
  db = createSqliteFile();
});
afterEach(() => db.cleanup());

const run = (def: AnyCommand, input: Record<string, unknown>, settings: Settings = { engine: 'sqlite', path: db.path }, debug: (m: string) => void = () => {}) => {
  const { context } = testContext({ config: { db: settings } });
  return execute(def, input, { ...context, debug });
};

describe('sqlite values', () => {
  it('turns integers, reals, text, null and blobs into JSON without losing anything', async () => {
    const envelope = await run(query, { sql: "SELECT 42 AS i, 9007199254740993 AS big, -9007199254740993 AS neg, 1.5 AS r, 'x' AS t, NULL AS n, x'0102ff' AS b" });
    expect(envelope.data).toEqual({
      columns: ['i', 'big', 'neg', 'r', 't', 'n', 'b'].map((name) => ({ name, type: null })),
      rows: [[42, '9007199254740993', '-9007199254740993', 1.5, 'x', null, 'AQL/']],
    });
  });

  it("reports a table column's declared type", async () => {
    const envelope = await run(query, { sql: 'SELECT id, name FROM people LIMIT 1' });
    expect((envelope.data as { columns: unknown }).columns).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'VARCHAR(100)' },
    ]);
  });
});

describe('sqlite file handling', () => {
  it('refuses a missing file and never creates one, for reads and writes', async () => {
    const missing = join(db.dir, 'missing.db');
    for (const [def, input] of [
      [query, { sql: 'SELECT 1' }],
      [executeCmd, { sql: 'CREATE TABLE t (x)', allowWrite: true }],
    ] as const) {
      const envelope = await run(def, input, { engine: 'sqlite', path: missing, writes: true });
      expect(envelope.error?.code).toBe('NOT_FOUND');
      expect(existsSync(missing)).toBe(false);
    }
  });

  it('refuses a relative path, naming the variable', async () => {
    const envelope = await run(listTables, {}, { engine: 'sqlite', path: 'data/app.db' });
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_PATH') });
  });

  it("says when the file isn't a SQLite database", async () => {
    const junk = join(db.dir, 'junk.db');
    writeFileSync(junk, 'this is a spreadsheet of record, not a database'.repeat(100));
    expect((await run(listTables, {}, { engine: 'sqlite', path: junk })).error?.code).toBe('CONFIG_INVALID');
  });

  it("can't create a database by attaching one from a read-only query", async () => {
    const attached = join(db.dir, 'attached.db').replace(/'/g, "''");
    const envelope = await run(query, { sql: `ATTACH DATABASE '${attached}' AS other` }, { engine: 'sqlite', path: db.path, writes: true });
    expect(envelope.ok).toBe(false);
    expect(existsSync(join(db.dir, 'attached.db'))).toBe(false);
  });

  // VACUUM INTO creates its target file before SQLite notices the connection
  // is read-only, so reads refuse VACUUM before it reaches the engine.
  it('refuses VACUUM on reads before SQLite sees it, and creates no file', async () => {
    const target = (name: string) => join(db.dir, name).replace(/'/g, "''");
    for (const sql of [
      `VACUUM INTO '${target('copy.db')}'`,
      `  /* note */ -- line\n vacuum into '${target('copy.db')}'`,
      'VACUUM',
    ]) {
      const envelope = await run(query, { sql }, { engine: 'sqlite', path: db.path, writes: true });
      expect(envelope.error, sql).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('db execute') });
    }
    expect(readdirSync(db.dir)).toEqual(['test.db']);
  });

  it('runs VACUUM INTO through db execute with both gates open', async () => {
    const copy = join(db.dir, 'copy.db');
    const envelope = await run(executeCmd, { sql: `VACUUM INTO '${copy.replace(/'/g, "''")}'`, allowWrite: true }, { engine: 'sqlite', path: db.path, writes: true });
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
    expect(existsSync(copy)).toBe(true);
    expect(sqliteRows(copy, 'SELECT count(*) AS n FROM people')).toEqual([{ n: 12 }]);
  });

  it('refuses VACUUM mixed into a script, changing nothing', async () => {
    const envelope = await run(executeCmd, { sql: 'VACUUM; UPDATE people SET active = 0 WHERE id = 1', allowWrite: true }, { engine: 'sqlite', path: db.path, writes: true });
    expect(envelope.error?.code).toBe('DATABASE');
    expect(sqliteRows(db.path, 'SELECT active FROM people WHERE id = 1')).toEqual([{ active: 1 }]);
  });

  it('logs the connection name under --debug, never the path', async () => {
    const lines: string[] = [];
    await run(listTables, {}, { engine: 'sqlite', path: db.path }, (m) => lines.push(m));
    expect(lines.join('\n')).toContain('connection db');
    expect(lines.join('\n')).not.toContain(db.dir);
  });
});

describe('sqlite configured from env vars alone', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'toil-home-'));
  });
  afterEach(() => rmSync(home, CLEANUP));

  it('TOIL_DB_ENGINE and TOIL_DB_PATH make a working connection with no config file', async () => {
    const config = loadConfig({ env: { TOIL_DB_ENGINE: 'sqlite', TOIL_DB_PATH: db.path }, cwd: home, home, areas: [{ name: 'db' }] });
    const { context } = testContext();
    const envelope = await execute(listTables, {}, { ...context, config });
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
  });

  it('TOIL_CONN_<NAME>_* defines a named connection, with writes from TOIL_CONN_<NAME>_WRITES', async () => {
    const env = { TOIL_CONN_SCRATCH_AREA: 'db', TOIL_CONN_SCRATCH_ENGINE: 'sqlite', TOIL_CONN_SCRATCH_PATH: db.path, TOIL_CONN_SCRATCH_WRITES: 'true' };
    const config = loadConfig({ env, cwd: home, home, areas: [{ name: 'db' }] });
    const { context } = testContext();
    const envelope = await execute(executeCmd, { sql: 'UPDATE people SET active = 1 WHERE id = 1', allowWrite: true, connection: 'scratch' }, { ...context, config });
    expect(envelope.data).toEqual({ changes: 1 });
  });
});

describe('sqlite on an older Node', () => {
  it('names the Node version it needs instead of failing obscurely', () => {
    expect(() => assertNodeSupportsSqlite('22.12.0')).toThrow(/needs Node 22\.16 or later, and this is Node 22\.12\.0/);
    expect(() => assertNodeSupportsSqlite('22.16.0')).not.toThrow();
    expect(() => assertNodeSupportsSqlite('24.0.0')).not.toThrow();
  });
});
