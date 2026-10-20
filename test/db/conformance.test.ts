import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Settings } from '../../src/core/config.js';
import { encodeCursor, MAX_LIMIT, pageKey } from '../../src/core/db/paging.js';
import type { Envelope } from '../../src/core/envelope.js';
import { execute } from '../../src/core/run.js';
import { testContext } from '../harness/context.js';
import { PEOPLE } from '../harness/db.js';
import { targets, type TargetDatabase } from './targets.js';

/**
 * The behaviour every database provider owes the db area, run once per
 * engine in targets.ts: connections, schemas, describe, preview, query with
 * a row cap, paging and cancellation, and read-only enforcement. A provider
 * that passes this suite is interchangeable with the others as far as any
 * command can tell. Conformance is assessed annually, or here, on every run.
 */

type Row = unknown[];
type Data = { columns: Array<{ name: string; type: string | null }>; rows: Row[] };

for (const target of targets) {
  const skip = await target.skip?.();
  describe.skipIf(skip !== undefined)(`db conformance: ${target.name ?? target.engine}${skip ? ` (skipped: ${skip})` : ''}`, { timeout: target.timeout }, () => {
    let db: TargetDatabase;
    // MySQL's default schema is the connection's database, so it's known only once the database is.
    const schema = () => (db.schema ?? target.defaultSchema)!;
    beforeEach(async () => {
      db = await target.setup();
    }, target.timeout);
    afterEach(async () => {
      await db.cleanup();
    }, target.timeout);

    const run = (def: AnyCommand, input: Record<string, unknown>, opts: { writes?: boolean; settings?: Settings; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Envelope> => {
      const settings = { ...(opts.settings ?? db.settings), ...(opts.writes ? { writes: true } : {}) };
      const { context } = testContext({ config: { db: settings } });
      return execute(def, input, { ...context, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    };
    const data = (envelope: Envelope): Data => {
      expect(envelope.error, JSON.stringify(envelope.error)).toBeNull();
      return envelope.data as Data;
    };
    // Oracle stores an unquoted name in upper case, and reports it so.
    const n = target.stored ?? ((name: string) => name);
    const ids = async (sql = 'SELECT id FROM people ORDER BY id') => (await db.rows(sql)).map((r) => Number(Object.values(r as object)[0]));
    const activeOf = async (id: number) => Number(Object.values((await db.rows(`SELECT active FROM people WHERE id = ${id}`))[0] as object)[0]);

    describe('connections', () => {
      it(`refuses a connection without ${target.requiredKey}, naming the variable to set`, async () => {
        const settings = { ...db.settings };
        delete settings[target.requiredKey];
        const envelope = await run(listSchemas, {}, { settings });
        expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining(`TOIL_DB_${target.requiredKey.toUpperCase()}`) });
      });

      it('refuses an engine toil has no provider for', async () => {
        const envelope = await run(listSchemas, {}, { settings: { ...db.settings, engine: 'abacus' } });
        expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_ENGINE') });
      });
    });

    describe('schemas and tables', () => {
      it('lists the default schema', async () => {
        const { schemas } = (await run(listSchemas, {})).data as { schemas: Array<{ name: string }> };
        expect(schemas.map((s) => s.name)).toContain(schema());
      });

      it('lists tables and views in the default schema, and nothing internal', async () => {
        const result = (await run(listTables, {})).data as { schema: string; tables: Array<{ name: string; type: string }> };
        expect(result.schema).toBe(schema());
        expect(result.tables).toEqual([
          { name: n('active_people'), type: 'view' },
          { name: n('people'), type: 'table' },
          { name: n('teams'), type: 'table' },
        ]);
      });

      it('gives the same tables when the default schema is named', async () => {
        expect((await run(listTables, { schema: schema() })).data).toEqual((await run(listTables, {})).data);
      });

      it('answers an unknown schema with NOT_FOUND', async () => {
        expect((await run(listTables, { schema: 'no_such_schema' })).error?.code).toBe('NOT_FOUND');
      });
    });

    describe('table describe', () => {
      it('describes columns, primary key, indexes and foreign keys', async () => {
        const d = (await run(describeTable, { table: 'people' })).data as Record<string, unknown>;
        expect(d).toMatchObject({ schema: schema(), name: n('people'), type: 'table', primaryKey: [n('id')] });
        const columns = d.columns as Array<{ name: string; nullable: boolean; primaryKey: number | null; default: string | null; type: string | null }>;
        expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'team_id', 'active'].map(n));
        expect(columns.find((c) => c.name === n('id'))).toMatchObject({ nullable: false, primaryKey: 1 });
        expect(columns.find((c) => c.name === n('name'))).toMatchObject({ nullable: false, primaryKey: null });
        expect(columns.find((c) => c.name === n('team_id'))).toMatchObject({ nullable: true });
        expect(columns.find((c) => c.name === n('active'))?.default).toMatch(/1/);
        // VARCHAR(100) as declared (SQLite), its standard name (PostgreSQL's character varying(100)), or Oracle's VARCHAR2(100).
        expect(columns.find((c) => c.name === n('name'))?.type?.toUpperCase()).toMatch(/VARCHAR|CHARACTER VARYING/);
        expect(d.indexes).toContainEqual({ name: n('people_team'), columns: [n('team_id')], unique: false });
        expect(d.foreignKeys).toEqual([
          { columns: [n('team_id')], references: { schema: schema(), table: n('teams'), columns: [n('id')] }, onUpdate: null, onDelete: null },
        ]);
      });

      it('reports a unique constraint as a unique index', async () => {
        const d = (await run(describeTable, { table: 'teams' })).data as { indexes: Array<{ columns: string[]; unique: boolean }> };
        expect(d.indexes.find((i) => i.columns.join() === n('name'))?.unique).toBe(true);
      });

      it('describes a view', async () => {
        const d = (await run(describeTable, { table: 'active_people' })).data as { type: string; columns: Array<{ name: string }> };
        expect(d.type).toBe('view');
        expect(d.columns.map((c) => c.name)).toEqual([n('id'), n('name')]);
      });

      it('answers an unknown table with NOT_FOUND', async () => {
        expect((await run(describeTable, { table: 'no_such_table' })).error?.code).toBe('NOT_FOUND');
      });
    });

    describe('table preview', () => {
      it('returns columns and rows as arrays, every row with no cursor when they fit', async () => {
        const envelope = await run(previewTable, { table: 'teams' });
        expect(data(envelope)).toEqual({
          columns: [
            { name: n('id'), type: expect.any(String) },
            { name: n('name'), type: expect.any(String) },
          ],
          rows: [
            [1, 'Platform'],
            [2, 'Data'],
          ],
        });
        expect(envelope.meta.page).toEqual({ nextCursor: null, limit: 100 });
      });

      it('pages through a table with cursors, every row exactly once', async () => {
        const seen: unknown[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const envelope = await run(previewTable, { table: 'people', limit: 5, ...(cursor ? { cursor } : {}) });
          const page = data(envelope);
          expect(page.rows.length).toBeLessThanOrEqual(5);
          seen.push(...page.rows.map((r) => r[0]));
          cursor = envelope.meta.page?.nextCursor ?? undefined;
          pages++;
        } while (cursor && pages < 10);
        expect(pages).toBe(Math.ceil(PEOPLE.length / 5));
        expect([...seen].sort((a, b) => Number(a) - Number(b))).toEqual(await ids());
      });

      it('previews a view', async () => {
        expect(data(await run(previewTable, { table: 'active_people', limit: 1 })).rows).toHaveLength(1);
      });

      it('answers an unknown table with NOT_FOUND', async () => {
        expect((await run(previewTable, { table: 'no_such_table' })).error?.code).toBe('NOT_FOUND');
      });
    });

    describe('query', () => {
      it('returns columns and rows', async () => {
        const result = data(await run(query, { sql: 'SELECT id, name FROM people WHERE id <= 2 ORDER BY id' }));
        expect(result.columns.map((c) => c.name)).toEqual([n('id'), n('name')]);
        expect(result.rows).toEqual([
          [1, 'Ada'],
          [2, 'Grace'],
        ]);
      });

      it('keeps two result columns with the same name', async () => {
        const result = data(await run(query, { sql: 'SELECT p.id, t.id FROM people p JOIN teams t ON t.id = p.team_id WHERE p.id = 1' }));
        expect(result.columns.map((c) => c.name)).toEqual([n('id'), n('id')]);
        expect(result.rows).toEqual([[1, 1]]);
      });

      it('caps rows at 100 by default and says where the next page starts', async () => {
        const envelope = await run(query, { sql: target.sql.series(150) });
        expect(data(envelope).rows).toHaveLength(100);
        expect(envelope.meta.page).toEqual({ nextCursor: expect.any(String), limit: 100 });
        const next = await run(query, { sql: target.sql.series(150), cursor: envelope.meta.page!.nextCursor });
        expect(data(next).rows.map((r) => r[0])).toEqual(Array.from({ length: 50 }, (_, i) => i + 101));
        expect(next.meta.page?.nextCursor).toBeNull();
      });

      it('honours --limit, up to the maximum', async () => {
        expect(data(await run(query, { sql: target.sql.series(20), limit: 7 })).rows).toHaveLength(7);
        expect((await run(query, { sql: target.sql.series(20), limit: MAX_LIMIT + 1 })).error?.code).toBe('INVALID_INPUT');
        expect((await run(query, { sql: target.sql.series(20), limit: 0 })).error?.code).toBe('INVALID_INPUT');
      });

      it('refuses a cursor from a different query, and one toil never issued', async () => {
        const foreign = encodeCursor(5, pageKey('db query', 'SELECT 1'));
        expect((await run(query, { sql: target.sql.series(20), cursor: foreign })).error?.code).toBe('INVALID_INPUT');
        expect((await run(query, { sql: target.sql.series(20), cursor: 'not-a-cursor' })).error?.code).toBe('INVALID_INPUT');
      });

      it('reports bad SQL as a DATABASE error', async () => {
        expect((await run(query, { sql: 'SELECT * FROM no_such_table' })).error?.code).toBe('DATABASE');
      });

      it('refuses more than one statement rather than running only the first', async () => {
        expect((await run(query, { sql: 'SELECT 1; SELECT 2' })).error?.code).toBe('INVALID_INPUT');
        expect(data(await run(query, { sql: 'SELECT 1 AS one; -- trailing comment' })).rows).toEqual([[1]]);
        expect(data(await run(query, { sql: 'SELECT 1 AS one; /* trailing */ /* comments */' })).rows).toEqual([[1]]);
        // A statement between two block comments is still a second statement.
        expect((await run(query, { sql: 'SELECT 1; /* a */ SELECT 2 /* b */' })).error?.code).toBe('INVALID_INPUT');
        expect((await run(query, { sql: 'SELECT 1; /* a */ SELECT 2' })).error?.code).toBe('INVALID_INPUT');
      });

      it('stops on cancel, and the connection works afterwards', async () => {
        const controller = new AbortController();
        const { sql, cursor } = target.sql.slow();
        const started = Date.now();
        setTimeout(() => controller.abort(), 300);
        const envelope = await run(query, { sql, ...(cursor ? { cursor } : {}) }, { signal: controller.signal });
        expect(envelope.error?.code).toBe('CANCELLED');
        expect(Date.now() - started).toBeLessThan(5000);
        // A server engine stops the statement on the server, not just toil's wait for it.
        if (db.running) await expect.poll(db.running, { timeout: 5000 }).toBe(0);
        expect(data(await run(query, { sql: 'SELECT 1 AS one' })).rows).toEqual([[1]]);
      });

      it('stops at the time limit', async () => {
        const { sql, cursor } = target.sql.slow();
        const envelope = await run(query, { sql, ...(cursor ? { cursor } : {}) }, { timeoutMs: 300 });
        expect(envelope.error?.code).toBe('TIMEOUT');
        if (db.running) await expect.poll(db.running, { timeout: 5000 }).toBe(0);
      });
    });

    describe('errors', () => {
      // An agent follows `fix` literally. A hint naming a command that was
      // renamed, or that another engine never had, sends it to INVALID_INPUT.
      it('every fix names only registered commands', async () => {
        const settings = { ...db.settings };
        delete settings[target.requiredKey];
        const failures = await Promise.all([
          run(listTables, { schema: 'no_such_schema' }),
          run(describeTable, { table: 'no_such_table' }),
          run(describeTable, { table: 'people', schema: 'no_such_schema' }),
          run(previewTable, { table: 'no_such_table' }),
          run(query, { sql: 'SELECT * FROM no_such_table' }),
          run(query, { sql: 'UPDATE people SET active = 0' }),
          run(query, { sql: 'SELECT 1; SELECT 2' }),
          run(query, { sql: 'VACUUM' }),
          run(query, { sql: target.sql.series(5), cursor: 'not-a-cursor' }),
          run(query, { sql: target.sql.series(5), cursor: encodeCursor(1, pageKey('db query', 'SELECT 1')) }),
          run(executeCmd, { sql: 'UPDATE people SET active = 0', allowWrite: true }),
          run(executeCmd, { sql: 'UPDATE people SET active = 0' }, { writes: true }),
          run(executeCmd, { sql: 'COMMIT', allowWrite: true }, { writes: true }),
          run(executeCmd, { sql: 'INSERT INTO teams (id, name) VALUES (1, \'Duplicate\')', allowWrite: true }, { writes: true }),
          run(listSchemas, {}, { settings }),
          run(listSchemas, {}, { settings: { ...db.settings, engine: 'abacus' } }),
        ]);
        const fixes = failures.map((e) => {
          expect(e.ok, JSON.stringify(e.data)).toBe(false);
          return e.error?.fix ?? '';
        });
        const registered = new Set(commands.map((c) => c.path.join(' ')));
        // A command is one word after db (`db query`) or two (`db table list`), so the words after it may be prose.
        const named = fixes.flatMap((f) => [...f.matchAll(/toil (db(?: [a-z][a-z-]*){1,2})/g)].map((m) => m[1]!));
        expect(named.length, 'the hints name at least some commands').toBeGreaterThan(3);
        expect(named.filter((n) => !registered.has(n) && !registered.has(n.split(' ').slice(0, 2).join(' ')))).toEqual([]);
      });
    });

    describe('read-only enforcement', () => {
      it('db query refuses a write at the engine, even on a connection with writes on', async () => {
        for (const writes of [false, true]) {
          const envelope = await run(query, { sql: 'UPDATE people SET active = 0 WHERE id = 1' }, { writes });
          expect(envelope.error?.code, `writes: ${writes}`).toBe('WRITE_DISABLED');
          expect(envelope.error?.fix).toContain('db execute');
        }
        const insert = await run(query, { sql: "INSERT INTO teams (id, name) VALUES (3, 'Ops')" }, { writes: true });
        expect(insert.error?.code).toBe('WRITE_DISABLED');
        expect(await activeOf(1)).toBe(1);
        expect(await ids('SELECT id FROM teams ORDER BY id')).toEqual([1, 2]);
      });

      it('db query refuses DDL', async () => {
        expect((await run(query, { sql: 'DROP TABLE people' }, { writes: true })).error?.code).toBe('WRITE_DISABLED');
        expect(await ids()).toHaveLength(PEOPLE.length);
      });

      it('db execute is refused without writes on the connection, even with allowWrite', async () => {
        const envelope = await run(executeCmd, { sql: 'UPDATE people SET active = 0 WHERE id = 1', allowWrite: true });
        expect(envelope.error).toMatchObject({ code: 'WRITE_DISABLED', message: expect.stringContaining('connection db') });
        expect(await activeOf(1)).toBe(1);
      });

      it('db execute is refused without allowWrite, even with writes on', async () => {
        const envelope = await run(executeCmd, { sql: 'UPDATE people SET active = 0 WHERE id = 1' }, { writes: true });
        expect(envelope.error).toMatchObject({ code: 'WRITE_DISABLED', fix: expect.stringContaining('--allow-write') });
        expect(await activeOf(1)).toBe(1);
      });

      it('db execute writes with both, and reports the rows changed', async () => {
        const envelope = await run(executeCmd, { sql: 'UPDATE people SET active = 0 WHERE id IN (1, 2)', allowWrite: true }, { writes: true });
        expect(envelope.data).toEqual({ changes: 2 });
        expect(await activeOf(1)).toBe(0);
        expect(await activeOf(2)).toBe(0);
      });

      it('db execute runs several statements as one transaction, all or nothing', async () => {
        const ok = await run(executeCmd, { sql: "INSERT INTO teams (id, name) VALUES (3, 'Ops'); UPDATE people SET team_id = 3 WHERE id = 1", allowWrite: true }, { writes: true });
        expect(ok.data).toEqual({ changes: 2 });

        const failed = await run(executeCmd, { sql: "UPDATE people SET active = 0 WHERE id = 4; INSERT INTO teams (id, name) VALUES (3, 'Duplicate')", allowWrite: true }, { writes: true });
        expect(failed.error?.code).toBe('DATABASE');
        expect(await activeOf(4)).toBe(1);
      });

      it('db execute runs DDL and the statements that depend on it in one script', async () => {
        const envelope = await run(executeCmd, { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body VARCHAR(20)); INSERT INTO notes (id, body) VALUES (1, \'a\'), (2, \'b\')', allowWrite: true }, { writes: true });
        expect(envelope.data).toEqual({ changes: 2 });
        expect(await ids('SELECT id FROM notes ORDER BY id')).toEqual([1, 2]);
      });

      it('db execute runs every statement, whatever comments sit between them', async () => {
        const sql = 'UPDATE people SET active = 0 WHERE id = 1; /* c */ UPDATE people SET active = 0 WHERE id = 2; /* d */ -- e\n UPDATE people SET active = 0 WHERE id = 4 /* f */';
        const envelope = await run(executeCmd, { sql, allowWrite: true }, { writes: true });
        expect(envelope.data).toEqual({ changes: 3 });
        expect([await activeOf(1), await activeOf(2), await activeOf(4)]).toEqual([0, 0, 0]);
      });

      it("db execute refuses a script that ends the transaction itself, before running any of it", async () => {
        for (const control of target.sql.transactionControl ?? ['COMMIT', 'ROLLBACK', 'BEGIN', 'END']) {
          const sql = `UPDATE people SET active = 0 WHERE id = 1; ${control}; UPDATE people SET active = 0 WHERE id = 2; SELECT * FROM no_such_table`;
          const envelope = await run(executeCmd, { sql, allowWrite: true }, { writes: true });
          expect(envelope.error?.code, control).toBe('INVALID_INPUT');
          expect(await activeOf(1), control).toBe(1);
          expect(await activeOf(2), control).toBe(1);
        }
      });
    });
  });
}
