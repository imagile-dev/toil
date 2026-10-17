import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeTable, execute as executeCmd, listSchemas, listTables, previewTable, query } from '../../src/areas/db/index.js';
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
  const skip = target.skip?.();
  describe.skipIf(skip !== undefined)(`db conformance: ${target.engine}${skip ? ` (skipped: ${skip})` : ''}`, () => {
    let db: TargetDatabase;
    beforeEach(async () => {
      db = await target.setup();
    });
    afterEach(async () => {
      await db.cleanup();
    });

    const run = (def: AnyCommand, input: Record<string, unknown>, opts: { writes?: boolean; settings?: Settings; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Envelope> => {
      const settings = { ...(opts.settings ?? db.settings), ...(opts.writes ? { writes: true } : {}) };
      const { context } = testContext({ config: { db: settings } });
      return execute(def, input, { ...context, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    };
    const data = (envelope: Envelope): Data => {
      expect(envelope.error, JSON.stringify(envelope.error)).toBeNull();
      return envelope.data as Data;
    };
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
        expect(schemas.map((s) => s.name)).toContain(target.defaultSchema);
      });

      it('lists tables and views in the default schema, and nothing internal', async () => {
        const result = (await run(listTables, {})).data as { schema: string; tables: Array<{ name: string; type: string }> };
        expect(result.schema).toBe(target.defaultSchema);
        expect(result.tables).toEqual([
          { name: 'active_people', type: 'view' },
          { name: 'people', type: 'table' },
          { name: 'teams', type: 'table' },
        ]);
      });

      it('gives the same tables when the default schema is named', async () => {
        expect((await run(listTables, { schema: target.defaultSchema })).data).toEqual((await run(listTables, {})).data);
      });

      it('answers an unknown schema with NOT_FOUND', async () => {
        expect((await run(listTables, { schema: 'no_such_schema' })).error?.code).toBe('NOT_FOUND');
      });
    });

    describe('describe-table', () => {
      it('describes columns, primary key, indexes and foreign keys', async () => {
        const d = (await run(describeTable, { table: 'people' })).data as Record<string, unknown>;
        expect(d).toMatchObject({ schema: target.defaultSchema, name: 'people', type: 'table', primaryKey: ['id'] });
        const columns = d.columns as Array<{ name: string; nullable: boolean; primaryKey: number | null; default: string | null; type: string | null }>;
        expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'team_id', 'active']);
        expect(columns.find((c) => c.name === 'id')).toMatchObject({ nullable: false, primaryKey: 1 });
        expect(columns.find((c) => c.name === 'name')).toMatchObject({ nullable: false, primaryKey: null });
        expect(columns.find((c) => c.name === 'team_id')).toMatchObject({ nullable: true });
        expect(columns.find((c) => c.name === 'active')?.default).toMatch(/1/);
        expect(columns.find((c) => c.name === 'name')?.type?.toUpperCase()).toContain('VARCHAR');
        expect(d.indexes).toContainEqual({ name: 'people_team', columns: ['team_id'], unique: false });
        expect(d.foreignKeys).toEqual([
          { columns: ['team_id'], references: { schema: target.defaultSchema, table: 'teams', columns: ['id'] }, onUpdate: null, onDelete: null },
        ]);
      });

      it('reports a unique constraint as a unique index', async () => {
        const d = (await run(describeTable, { table: 'teams' })).data as { indexes: Array<{ columns: string[]; unique: boolean }> };
        expect(d.indexes.find((i) => i.columns.join() === 'name')?.unique).toBe(true);
      });

      it('describes a view', async () => {
        const d = (await run(describeTable, { table: 'active_people' })).data as { type: string; columns: Array<{ name: string }> };
        expect(d.type).toBe('view');
        expect(d.columns.map((c) => c.name)).toEqual(['id', 'name']);
      });

      it('answers an unknown table with NOT_FOUND', async () => {
        expect((await run(describeTable, { table: 'no_such_table' })).error?.code).toBe('NOT_FOUND');
      });
    });

    describe('preview-table', () => {
      it('returns columns and rows as arrays, every row with no cursor when they fit', async () => {
        const envelope = await run(previewTable, { table: 'teams' });
        expect(data(envelope)).toEqual({
          columns: [
            { name: 'id', type: expect.any(String) },
            { name: 'name', type: expect.any(String) },
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
        expect(result.columns.map((c) => c.name)).toEqual(['id', 'name']);
        expect(result.rows).toEqual([
          [1, 'Ada'],
          [2, 'Grace'],
        ]);
      });

      it('keeps two result columns with the same name', async () => {
        const result = data(await run(query, { sql: 'SELECT p.id, t.id FROM people p JOIN teams t ON t.id = p.team_id WHERE p.id = 1' }));
        expect(result.columns.map((c) => c.name)).toEqual(['id', 'id']);
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
      });

      it('stops on cancel, and the connection works afterwards', async () => {
        const controller = new AbortController();
        const { sql, cursor } = target.sql.slow();
        const started = Date.now();
        setTimeout(() => controller.abort(), 300);
        const envelope = await run(query, { sql, ...(cursor ? { cursor } : {}) }, { signal: controller.signal });
        expect(envelope.error?.code).toBe('CANCELLED');
        expect(Date.now() - started).toBeLessThan(5000);
        expect(data(await run(query, { sql: 'SELECT 1 AS one' })).rows).toEqual([[1]]);
      });

      it('stops at the time limit', async () => {
        const { sql, cursor } = target.sql.slow();
        const envelope = await run(query, { sql, ...(cursor ? { cursor } : {}) }, { timeoutMs: 300 });
        expect(envelope.error?.code).toBe('TIMEOUT');
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
    });
  });
}
